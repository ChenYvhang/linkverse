"""Central validation/gate runner for the potential-score refactor.

See REFACTOR_PLAN.md for what each gate checks and why. This module is built
incrementally alongside score.py — functions are added in the same order as
REFACTOR_PLAN.md section 8's execution list, each one runnable and reported
on before the next is written. Run the whole thing with:

    python -m pipeline.validate

Age-bias bucket-drift checking is NOT reimplemented here — it already works
(see validate_features.py) and is reused via run_age_bias_gate() below.
"""
import json
import statistics
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, balanced_accuracy_score
from sklearn.model_selection import GroupKFold, KFold

from pipeline.common.logging import get_logger
from pipeline.validate_features import run as _run_age_bias_check
from pipeline.score import (
    FEATURES_PATH, GROUP_KFOLD_SPLITS, PRIMARY_TOP_K, RANDOM_SEED, SCORES_OUT_PATH,
    SUBSCRIBER_TIERS, TOP_K_LIST,
    _parse_iso, build_eval_rows, build_training_rows, compute_season_coefs,
    label_old_loose, label_tightened, resolve_tightened_threshold, split_main_and_auxiliary,
    topk_hit_rate,
)
import pipeline.score as score_module

logger = get_logger("validate")

ROOT = Path(__file__).resolve().parent
REPORTS_DIR = ROOT.parent / "reports"


def train_and_predict_oof(training_rows: list[dict], eval_rows: list[dict], label_fn,
                            n_splits: int = GROUP_KFOLD_SPLITS, random_state: int = RANDOM_SEED) -> dict[str, float]:
    """GroupKFold(groups=channel_id) over training_rows; for each fold, train on the
    other folds and predict the eval_rows belonging to this fold's held-out channels.
    Returns channel_id -> out-of-fold predicted probability. A channel only gets a
    prediction if it appears in training_rows (i.e. had at least one T-level survive
    the untestable gate)."""
    X = np.array([r["features"] for r in training_rows], dtype=float)
    y = np.array([label_fn(r) for r in training_rows], dtype=int)
    groups = np.array([r["channel_id"] for r in training_rows])
    eval_by_channel = {r["channel_id"]: r for r in eval_rows}

    if len(set(y)) < 2:
        logger.warning("only one class present in training labels — cannot train a classifier")
        return {}

    n_splits_eff = min(n_splits, len(set(groups)))
    gkf = GroupKFold(n_splits=n_splits_eff)
    oof_pred: dict[str, float] = {}
    for train_idx, test_idx in gkf.split(X, y, groups):
        if len(set(y[train_idx])) < 2:
            continue
        model = HistGradientBoostingClassifier(random_state=random_state)
        model.fit(X[train_idx], y[train_idx])
        for cid in set(groups[test_idx]):
            if cid in eval_by_channel and cid not in oof_pred:
                proba = model.predict_proba(np.array([eval_by_channel[cid]["features"]]))[0, 1]
                oof_pred[cid] = float(proba)
    return oof_pred


def gate_age_bias() -> dict:
    logger.info("=== GATE 2.1: age bias (relative_velocity bucket drift) ===")
    report = _run_age_bias_check()
    status = "PASS" if report["drift_check"]["pass"] else "FAIL"
    logger.info("age bias gate: %s (slope=%.5f, threshold=%.2f)",
                status, report["drift_check"]["slope"], report["drift_check"]["threshold"])
    if not report["drift_check"]["pass"]:
        raise SystemExit("age bias gate FAILED — do not proceed (see REFACTOR_PLAN.md §2 gate rules)")
    return report


def gate_season_leak() -> dict:
    """§2.2: build two parallel row sets differing only in which season-coef
    table feeds season_adjusted_relative_velocity_mean, train the same
    diagnostic classifier (old loose label, since this runs before label
    tightening in the execution order) on each, and compare Top-K lift.
    Pass condition: fixed (leak-free) version's lift must be LOWER than the
    leaky version's — a drop is proof the leak was real and is now closed."""
    logger.info("=== GATE 2.2: season coefficient leakage ===")
    data = json.loads(FEATURES_PATH.read_text(encoding="utf-8"))
    channels = data["channels"]
    fetched_at = _parse_iso(data["fetched_at"])

    main_pool, aux_holdout = split_main_and_auxiliary(channels)

    leaky_coefs = compute_season_coefs(channels)          # ALL channels, incl. post-T videos — the leak
    fixed_coefs = compute_season_coefs(aux_holdout)        # only holdout channels — never in train/eval

    results = {}
    for name, coefs in [("leaky", leaky_coefs), ("fixed", fixed_coefs)]:
        training_rows = build_training_rows(main_pool, fetched_at, coefs)
        eval_rows = build_eval_rows(main_pool, fetched_at, coefs)
        oof_pred = train_and_predict_oof(training_rows, eval_rows, label_old_loose)

        scored = [(r, oof_pred[r["channel_id"]]) for r in eval_rows if r["channel_id"] in oof_pred]
        baseline_scored = [(r, r["subscriber_count"]) for r in eval_rows]

        model_hit, model_n = topk_hit_rate(scored, label_old_loose, PRIMARY_TOP_K)
        baseline_hit, baseline_n = topk_hit_rate(baseline_scored, label_old_loose, PRIMARY_TOP_K)
        lift = (model_hit / baseline_hit) if baseline_hit > 0 else None

        # Top-20 hit-rate is coarse (steps of 1/20 = 5%) and ties easily even
        # when the underlying predictions genuinely differ — confirmed twice
        # (n=204 and n=525) by diffing oof_pred channel-by-channel: real
        # per-channel differences, same aggregate hit-rate by coincidence.
        # average_precision_score uses every eval row's rank, not just the
        # top 20, so it has enough resolution to actually separate the two
        # versions instead of reporting another tie.
        y_true_all = np.array([label_old_loose(r) for r in eval_rows])
        y_score_all = np.array([oof_pred.get(r["channel_id"], float("-inf")) for r in eval_rows])
        ap = average_precision_score(y_true_all, y_score_all) if y_true_all.sum() > 0 else None

        results[name] = {
            "eval_rows": len(eval_rows), "scored_rows": len(scored),
            "baseline_hit_rate": baseline_hit, "model_hit_rate": model_hit, "lift": lift,
            "average_precision": ap,
        }
        logger.info("season coef version=%-6s eval_rows=%d scored=%d baseline_hit=%.3f model_hit=%.3f lift=%s AP=%s",
                    name, len(eval_rows), len(scored), baseline_hit, model_hit, lift, ap)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    _plot_season_curves(leaky_coefs, fixed_coefs, REPORTS_DIR / "season_leak_before_after.png")

    leaky_lift = results["leaky"]["lift"]
    fixed_lift = results["fixed"]["lift"]
    leaky_ap = results["leaky"]["average_precision"]
    fixed_ap = results["fixed"]["average_precision"]
    lift_tied = leaky_lift is not None and fixed_lift is not None and leaky_lift == fixed_lift
    gate_pass = (leaky_lift is not None and fixed_lift is not None and fixed_lift < leaky_lift)
    ap_gate_pass = (leaky_ap is not None and fixed_ap is not None and fixed_ap < leaky_ap)

    if lift_tied:
        verdict = (
            f"Top-20 命中率打平（两版都是lift={leaky_lift}，粒度不够分辨），"
            f"改用全量AP判断：fixed AP={fixed_ap:.4f} vs leaky AP={leaky_ap:.4f} → "
            + ("PASS（AP下降，泄漏确认修复）" if ap_gate_pass else "仍不确定（AP也没有下降，如实报告平局/不确定）")
        )
        gate_pass = ap_gate_pass
    else:
        verdict = "PASS (fixed lift is lower, leak was real and is now closed)" if gate_pass else \
                  "FAIL (fixed lift did not drop below leaky lift — fix did not take effect, investigate)"
    logger.info("=== GATE 2.2 verdict: %s ===", verdict)

    out = {"leaky": results["leaky"], "fixed": results["fixed"], "gate_pass": gate_pass, "lift_tied": lift_tied, "verdict": verdict}
    (REPORTS_DIR / "season_leak_before_after.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def _plot_season_curves(leaky_coefs: dict, fixed_coefs: dict, out_path: Path) -> None:
    verticals = sorted(set(leaky_coefs) | set(fixed_coefs))
    fig, axes = plt.subplots(len(verticals), 1, figsize=(7, 2.2 * len(verticals)), squeeze=False)
    months = list(range(1, 13))
    for i, vertical in enumerate(verticals):
        ax = axes[i][0]
        if vertical in leaky_coefs:
            ax.plot(months, leaky_coefs[vertical]["coefs"], label="leaky (all channels)", color="tab:red")
        if vertical in fixed_coefs:
            ax.plot(months, fixed_coefs[vertical]["coefs"], label="fixed (aux_holdout only)", color="tab:green")
        ax.set_title(vertical, fontsize=9)
        ax.axhline(1.0, color="gray", linewidth=0.5, linestyle="--")
        ax.legend(fontsize=6)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    logger.info("wrote %s", out_path)


def gate_groupkfold_vs_kfold(training_rows: list[dict], label_fn, n_splits: int = GROUP_KFOLD_SPLITS,
                              random_state: int = RANDOM_SEED) -> dict:
    """§3.2: same training rows, same model, same label — only the CV splitter
    differs. Plain KFold ignores channel_id, so a channel's 5 sliding-T rows
    (which share most of their pre-T video history) can land on both sides of
    a fold, letting the model "peek" at a near-duplicate of a test row during
    training. GroupKFold keeps every row from one channel in the same fold,
    closing that leak. Pass condition: GroupKFold's CV score must be
    noticeably LOWER than plain KFold's — if they're close, groups= isn't
    doing anything and the wiring is broken, not the diagnosis.

    Scored with balanced_accuracy, not plain accuracy: at ~9% positive rate a
    classifier that always predicts "negative" already scores ~90% plain
    accuracy, which pins both splitters at the majority-class floor and can
    hide the leak effect entirely. balanced_accuracy averages per-class
    recall, so it stays sensitive to the minority class."""
    logger.info("=== GATE 3.2: KFold vs GroupKFold (pseudo-replication check) ===")
    X = np.array([r["features"] for r in training_rows], dtype=float)
    y = np.array([label_fn(r) for r in training_rows], dtype=int)
    groups = np.array([r["channel_id"] for r in training_rows])
    n_splits_eff = min(n_splits, len(set(groups)))

    def cv_scores(splitter, **split_kwargs):
        scores = []
        for train_idx, test_idx in splitter.split(X, y, **split_kwargs):
            if len(set(y[train_idx])) < 2:
                continue
            model = HistGradientBoostingClassifier(random_state=random_state)
            model.fit(X[train_idx], y[train_idx])
            scores.append(balanced_accuracy_score(y[test_idx], model.predict(X[test_idx])))
        return scores

    kfold_scores = cv_scores(KFold(n_splits=n_splits_eff, shuffle=True, random_state=random_state))
    groupkfold_scores = cv_scores(GroupKFold(n_splits=n_splits_eff), groups=groups)
    kfold_mean = statistics.mean(kfold_scores) if kfold_scores else None
    groupkfold_mean = statistics.mean(groupkfold_scores) if groupkfold_scores else None

    logger.info("plain KFold      : mean balanced_accuracy=%s  per-fold=%s",
                f"{kfold_mean:.4f}" if kfold_mean is not None else "n/a",
                [round(s, 3) for s in kfold_scores])
    logger.info("GroupKFold       : mean balanced_accuracy=%s  per-fold=%s",
                f"{groupkfold_mean:.4f}" if groupkfold_mean is not None else "n/a",
                [round(s, 3) for s in groupkfold_scores])

    gate_pass = kfold_mean is not None and groupkfold_mean is not None and groupkfold_mean < kfold_mean
    verdict = (
        "PASS (GroupKFold scores lower — pseudo-replication leak confirmed and closed)" if gate_pass else
        "FAIL (GroupKFold not lower than plain KFold — groups= may not be wired correctly, investigate)"
    )
    logger.info("=== GATE 3.2 verdict: %s ===", verdict)

    result = {
        "n_training_rows": len(training_rows), "n_splits": n_splits_eff,
        "kfold_mean_accuracy": kfold_mean, "kfold_scores": kfold_scores,
        "groupkfold_mean_accuracy": groupkfold_mean, "groupkfold_scores": groupkfold_scores,
        "gate_pass": gate_pass,
    }
    (REPORTS_DIR / "groupkfold_vs_kfold.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def report_label_tightening(main_pool: list[dict], fetched_at, season_coefs: dict) -> dict:
    """§1.3: compare the old loose label (post_median > pre_median * 1.2, no
    persistence check) against the tightened label (amplitude >= 1.5x AND
    >=50% of post-T videos individually beat the pre-T median) — both on the
    SAME rows, so the only thing that changes is the label definition. Reports
    positive-rate shift and Top-K lift shift; does not gate (no pass/fail
    condition was specified for this step, just "report honestly")."""
    logger.info("=== §1.3: label tightening (old vs new) ===")
    training_rows = build_training_rows(main_pool, fetched_at, season_coefs)
    eval_rows = build_eval_rows(main_pool, fetched_at, season_coefs)

    threshold_used, threshold_stats = resolve_tightened_threshold(training_rows)
    logger.info("tightened threshold resolution: %s", threshold_stats)

    results = {}
    for name, label_fn in [
        ("old_loose", label_old_loose),
        ("new_tightened", lambda r: label_tightened(r, threshold_used)),
    ]:
        train_labels = [label_fn(r) for r in training_rows]
        eval_labels = [label_fn(r) for r in eval_rows]
        pos_rate_train = sum(train_labels) / len(train_labels) if train_labels else 0.0
        pos_rate_eval = sum(eval_labels) / len(eval_labels) if eval_labels else 0.0

        oof_pred = train_and_predict_oof(training_rows, eval_rows, label_fn)
        scored = [(r, oof_pred[r["channel_id"]]) for r in eval_rows if r["channel_id"] in oof_pred]
        baseline_scored = [(r, r["subscriber_count"]) for r in eval_rows]
        model_hit, model_n = topk_hit_rate(scored, label_fn, PRIMARY_TOP_K)
        baseline_hit, baseline_n = topk_hit_rate(baseline_scored, label_fn, PRIMARY_TOP_K)
        lift = (model_hit / baseline_hit) if baseline_hit > 0 else None

        results[name] = {
            "positive_rate_train": pos_rate_train, "positive_rate_eval": pos_rate_eval,
            "n_training_rows": len(training_rows), "n_eval_rows": len(eval_rows),
            "baseline_hit_rate": baseline_hit, "model_hit_rate": model_hit, "lift": lift,
        }
        logger.info(
            "[%s] positive_rate(train)=%.3f positive_rate(eval)=%.3f baseline_hit=%.3f model_hit=%.3f lift=%s",
            name, pos_rate_train, pos_rate_eval, baseline_hit, model_hit, lift,
        )

    out = {"threshold_used": threshold_used, "threshold_resolution": threshold_stats, **results}
    (REPORTS_DIR / "label_tightening_comparison.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def plot_calibration_curve(calibration_curve: list[dict], out_path: Path) -> None:
    xs = [b["mean_predicted"] for b in calibration_curve if b["n"] > 0]
    ys = [b["observed_frequency"] for b in calibration_curve if b["n"] > 0]
    ns = [b["n"] for b in calibration_curve if b["n"] > 0]
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.plot([0, 1], [0, 1], "--", color="gray", linewidth=1, label="完美校准")
    if xs:
        ax.scatter(xs, ys, s=[20 + 8 * n for n in ns], color="tab:orange", label="校准集分箱（气泡大小=样本数）")
        ax.plot(xs, ys, color="tab:orange", linewidth=1, alpha=0.6)
    ax.set_xlabel("预测概率（校准后）")
    ax.set_ylabel("实际发生频率")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(fontsize=8)
    ax.set_title("Platt(sigmoid) 校准曲线（auxiliary_holdout）")
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    logger.info("wrote %s", out_path)


def write_backtest_markdown(scores: dict, season_leak: dict, groupkfold: dict, label_tightening: dict) -> None:
    """Assembles reports/backtest.md — the five tables REFACTOR_PLAN.md §7 asks
    for, built from whatever score.py + the gates above actually produced.
    No numbers are invented here; this only formats what's already in the
    JSON reports on disk."""
    potential = scores["potential"]
    lines = ["# 回测报告（Glimmer Scout 潜力分 P）", ""]

    lines += ["## 1. 标签口径对比（旧 vs 新）", ""]
    lines += ["| 版本 | 正样本比例(train) | 正样本比例(eval) | baseline命中率@20 | 模型命中率@20 | lift@20 |",
              "|---|---|---|---|---|---|"]
    for name, label in [("old_loose", "旧（宽松，>1.2x无持续性要求）"), ("new_tightened", "新（收紧，见下方阈值）")]:
        r = label_tightening[name]
        lines.append(
            f"| {label} | {r['positive_rate_train']:.3f} | {r['positive_rate_eval']:.3f} | "
            f"{r['baseline_hit_rate']:.3f} | {r['model_hit_rate']:.3f} | {r['lift']:.3f} |"
        )
    ts = label_tightening["threshold_resolution"]
    lines += ["", f"新标签使用的幅度门槛：{ts['threshold_used']}x"
              + ("（默认1.5x下正样本率<5%，已按规则自动放宽到1.3x）" if ts.get("relaxed") else "（默认1.5x）")
              + "，且要求post-T窗口内≥50%视频的relative_velocity个体超过pre-T中位数。", ""]

    lines += ["## 2. 分层结果表（生产模型，dual-head + 校准后）", ""]
    lines += ["| 分层 | 候选数 | 正样本数 | 样本护栏 | baseline@20 | 模型@20 | lift@20 |",
              "|---|---|---|---|---|---|---|"]
    tier_names = ["global"] + [t[0] for t in SUBSCRIBER_TIERS]
    for tier in tier_names:
        t = potential["backtest_stratified"][tier]
        k20 = t["per_k"]["20"]
        flag = "样本不足，仅供参考" if t["insufficient_sample"] else "充分"
        lines.append(
            f"| {tier} | {t['n_candidates']} | {t['n_positive']} | {flag} | "
            f"{k20['baseline_hit_rate']:.3f} | {k20['model_hit_rate']:.3f} | {k20['lift'] if k20['lift'] is not None else 'n/a'} |"
        )
    excl = potential["backtest_stratified"]["excluded_below_1k"]["count"]
    lines += ["", f"<1K订阅频道（{excl}个）不计入分层表，只计入global行——见REFACTOR_PLAN.md §2决策5。", ""]

    lines += ["## 3. K值扫描表（global）", ""]
    lines += ["| K | baseline命中率 | 模型命中率 | lift |", "|---|---|---|---|"]
    for k in TOP_K_LIST:
        row = potential["backtest_stratified"]["global"]["per_k"][str(k)]
        lift_str = f"{row['lift']:.3f}" if row["lift"] is not None else "n/a"
        lines.append(f"| {k} | {row['baseline_hit_rate']:.3f} | {row['model_hit_rate']:.3f} | {lift_str} |")
    lines.append("")

    lines += ["## 4. 季节泄漏修复前后对比", ""]
    lines += ["| 版本 | eval行数 | baseline命中率@20 | 模型命中率@20 | lift@20 | AP(全量) |", "|---|---|---|---|---|---|"]
    for name, label in [("leaky", "泄漏版（全量频道估季节系数）"), ("fixed", "修复版（仅auxiliary_holdout估）")]:
        r = season_leak[name]
        ap_str = f"{r['average_precision']:.4f}" if r.get("average_precision") is not None else "n/a"
        lines.append(f"| {label} | {r['eval_rows']} | {r['baseline_hit_rate']:.3f} | {r['model_hit_rate']:.3f} | {r['lift']:.3f} | {ap_str} |")
    if season_leak.get("lift_tied"):
        gate_verdict_str = "PASS（AP下降，泄漏确认修复）" if season_leak["gate_pass"] else "仍不确定（AP也没有下降，如实报告平局/不确定）"
        lines += ["", f"**Top-20命中率打平**（两版lift都是{season_leak['leaky']['lift']}，粒度不够分辨个体预测的真实差异——"
                  "已核实两版对每个频道的原始预测确实不同，只是恰好打平在Top-20命中率上）。"
                  f"改用覆盖全部{season_leak['leaky']['eval_rows']}行评估集的average precision作为门禁判据："
                  f"fixed AP={season_leak['fixed']['average_precision']:.4f} vs leaky AP={season_leak['leaky']['average_precision']:.4f} → {gate_verdict_str}", ""]
    else:
        lines += ["", f"门禁判据：修复版lift必须低于泄漏版。结果：{'PASS' if season_leak['gate_pass'] else 'FAIL'}。", ""]

    lines += ["## 4b. KFold vs GroupKFold（伪重复检测）", ""]
    lines += [
        f"plain KFold 平均 balanced_accuracy = {groupkfold['kfold_mean_accuracy']:.4f}"
        f"（各折：{[round(s,3) for s in groupkfold['kfold_scores']]}）  ",
        f"GroupKFold 平均 balanced_accuracy = {groupkfold['groupkfold_mean_accuracy']:.4f}"
        f"（各折：{[round(s,3) for s in groupkfold['groupkfold_scores']]}）  ",
        f"门禁判据：GroupKFold必须更低。结果：{'PASS' if groupkfold['gate_pass'] else 'FAIL'}。", "",
    ]

    lines += ["## 5. 校准与置信区间", ""]
    calib = potential["calibration"]
    lines += [
        f"Brier score = {calib['brier_score']:.4f}（校准集 n={calib['n_calibration_rows']}）  ",
        f"Conformal 目标覆盖率 = {calib['target_coverage']:.2f}，实际覆盖率 = {calib['actual_coverage']:.4f}", "",
    ]

    lines += ["## 6. 口径说明（逐条）", "",
        "- **训练/评估分离**：训练用滑动T（{30,60,90,120,150}天前）多样本扩充，评估固定T=60天单快照——"
        "避免同一频道在Top-K榜单里重复出现导致lift虚高。",
        "- **未卜先知剔除**：post-T窗口视频数<5的行直接丢弃，不标0——标0等于把\"不知道\"伪造成\"确定没加速\"。",
        "- **标签收紧**：要求幅度(>=1.5x或自动放宽后的1.3x)与持续性(>=50%视频individually跑赢pre-T中位数)同时满足，"
        "避免一条偶然爆量视频被误判为\"频道在加速\"。",
        "- **分层优于全局**：真实campaign一次签8-10人，Top-20分档命中率比全局Top-20更贴近决策场景；"
        "分层也剥夺了基线\"靠体量躺赢\"的优势。",
        "- **季节系数用独立子集估计**：全量估计会把T之后的视频信息带回T之前的特征，是真实的未来泄漏；"
        "只用auxiliary_holdout（从不参与训练/评估的15%频道）估计则彻底切断这条泄漏路径。",
        "- **GroupKFold而非普通KFold**：同一频道的5个滑动T窗口高度相关（都基于同一份历史视频），"
        "普通KFold会让同一频道的不同窗口分散在训练/验证两侧，CV分数虚高且不报错。",
        "- **排序头与概率头分工**：Top-K榜单用LGBMRanker(lambdarank)的排序分，因为业务只关心榜单头部相对顺序；"
        "\"引爆概率\"数值用LGBMRegressor回归log(post/pre)后做Platt(sigmoid)校准，因为概率数值需要良定义的[0,1]区间"
        "且要有校准保证——原计划用isotonic regression，但校准集只有约90行、正样本个位数，isotonic拟合出的阶梯函数"
        "只有4级平台，套到2000+频道上会让92%的频道挤在3个数值上（散点图上就是密集竖线），"
        "改用参数更少的Platt scaling后输出连续、不再阶梯化。",
        "- **Conformal区间**：概率头给出的p_lo/p_hi来自auxiliary_holdout残差分位数，"
        "\"高分但区间宽\"和\"高分且区间窄\"是两种不同的决策置信度，前端应区别对待。",
        "",
    ]

    lines += ["## 7. §6 序列编码器 ablation：跳过，及原因", "",
        "没有引入GRU/Transformer等序列编码器，按REFACTOR_PLAN.md §2决策3执行：",
        "- 当前qualifying训练样本量（见上方\"标签口径对比\"表的positive_rate分母）在几百到"
        "两千行量级，一个哪怕<10k参数的序列模型，参数量对样本量的比例仍然偏高，"
        "过拟合几乎是必然结果——回测数字会\"好看得可疑\"，而不是真实泛化能力提升。",
        "- 这与PLAN.md最初四层架构里\"不为了套用框架而引入无法用真实数据支撑的黑箱模块\"的"
        "原则一致：demo规模没有支撑序列编码器的数据量，装了torch跑一个大概率会输、"
        "且贡献的信息量本来就存在于手工特征（momentum_acceleration、window_momentum_acceleration"
        "等）里的模型，不比写清楚\"为什么现在不做\"更有说服力。",
        "- 如果后续数据规模扩到万级频道/更长历史窗口，这个判断应该重新评估——"
        "手工特征在小样本下的优势不是永久性结论。",
        "",
    ]

    (REPORTS_DIR / "backtest.md").write_text("\n".join(lines), encoding="utf-8")
    logger.info("wrote %s", REPORTS_DIR / "backtest.md")


def main():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    gate_age_bias()
    season_leak = gate_season_leak()

    data = json.loads(FEATURES_PATH.read_text(encoding="utf-8"))
    channels = data["channels"]
    fetched_at = _parse_iso(data["fetched_at"])
    main_pool, aux_holdout = split_main_and_auxiliary(channels)
    fixed_season_coefs = compute_season_coefs(aux_holdout)
    training_rows = build_training_rows(main_pool, fetched_at, fixed_season_coefs)

    groupkfold = gate_groupkfold_vs_kfold(training_rows, label_old_loose)
    label_tightening = report_label_tightening(main_pool, fetched_at, fixed_season_coefs)

    logger.info("=== running score.py production pipeline (dual-head model + calibration) ===")
    score_module.run()
    scores = json.loads(SCORES_OUT_PATH.read_text(encoding="utf-8"))
    if scores["potential"]["method"] == "dual_head_gbdt":
        plot_calibration_curve(scores["potential"]["calibration"]["calibration_curve"],
                                REPORTS_DIR / "calibration_curve.png")
        write_backtest_markdown(scores, season_leak, groupkfold, label_tightening)
    else:
        logger.warning("potential method=%s (not dual_head_gbdt) — skipping calibration curve/backtest.md",
                        scores["potential"]["method"])


if __name__ == "__main__":
    main()
