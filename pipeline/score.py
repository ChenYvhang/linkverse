"""Stage4 — 匹配层潜力分 P：双头模型（排序头 + 校准概率头）+ conformal 区间 + 分层回测。

See REFACTOR_PLAN.md for the full design rationale. Summary of what changed
from the original single-classifier design and why:

- Evaluation snapshot (one row per channel, T=60d fixed) is now separate from
  training rows (five rows per channel, T in {30,60,90,120,150}d, "sliding T"
  to multiply usable training samples). Mixing them would let the same
  channel appear multiple times in a Top-K leaderboard.
- A random 15% of channels ("auxiliary_holdout", stratified by subscriber
  tier) never enters training or the eval snapshot. It carries three jobs
  that all boil down to "needs data that hasn't been used for training or
  scoring": (a) leak-free season coefficient estimation, (b) Platt/sigmoid
  calibration of the regression head, (c) conformal residual quantiles.
  Splitting these into three separate holdouts would fragment an already
  small channel pool for no added rigor — all three only require
  "independent of train/eval", which one split satisfies.
- Untestable rows (post-T window < 5 videos) are DROPPED, never labeled 0 —
  labeling them 0 would inject "we don't know" as "definitely didn't
  accelerate", which is a fabricated negative, not an observed one.
- Acceleration label is tightened to require BOTH a >=1.5x median-velocity
  jump AND that >=50% of post-T videos individually beat the pre-T median —
  a single viral fluke shouldn't count as "the channel is accelerating".
- season_adjusted_relative_velocity_mean is a new feature (previously the
  season coefficient was computed but never fed into the GBDT at all, so
  the documented "season leakage" had nothing to leak into — see
  REFACTOR_PLAN.md section 0). Adding it is what makes the leaky-vs-fixed
  season coefficient comparison in validate.py meaningful.

Resonance score (R, cosine similarity against product vectors) is untouched
— see compute_resonance_scores below, moved verbatim from the prior version.

Run:
    python -m pipeline.score
Reads pipeline/artifacts/features.json + pipeline/cache/vision/*.json,
writes pipeline/artifacts/scores.json.
"""
import json
import math
import statistics
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

warnings.filterwarnings("ignore", message="X does not have valid feature names")
warnings.filterwarnings("ignore", message="Found 'eval_at' in params")

import lightgbm as lgb
import numpy as np
import yaml
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, KFold, train_test_split
from sklearn.metrics import accuracy_score, brier_score_loss

from pipeline.common.logging import get_logger

logger = get_logger("score")

ROOT = Path(__file__).resolve().parent
FEATURES_PATH = ROOT / "artifacts" / "features.json"
VISION_CACHE_DIR = ROOT / "cache" / "vision"
DIMENSIONS_PATH = ROOT / "config" / "dimensions.yaml"
PRODUCTS_PATH = ROOT / "config" / "products.yaml"
SCORES_OUT_PATH = ROOT / "artifacts" / "scores.json"

# ---------------------------------------------------------------------------
# §1 evaluation protocol constants (REFACTOR_PLAN.md §3)
# ---------------------------------------------------------------------------
T_LEVELS_DAYS = [30, 60, 90, 120, 150]   # sliding T for training rows
EVAL_T_DAYS = 60                          # fixed T for the eval snapshot
MIN_POST_VIDEOS = 5                       # §1.2 untestable gate (post-T side)
MIN_PRE_VIDEOS = 3                        # floor for pre-T feature extraction
MIN_VIDEOS_FOR_WINDOW_SPLIT = 4           # for window_momentum_acceleration

AMPLITUDE_THRESHOLD_DEFAULT = 1.5         # §1.3 tightened label, amplitude leg
AMPLITUDE_THRESHOLD_FALLBACK = 1.3        # auto-relax if positive rate < 5%
MIN_POSITIVE_RATE_BEFORE_RELAX = 0.05
PERSISTENCE_RATIO = 0.5                   # >=50% of post-T videos must individually beat pre-T median
OLD_AMPLITUDE_THRESHOLD = 1.2             # original (pre-refactor) loose label, kept for before/after comparisons

MIN_GBDT_SAMPLES = 100
TOP_K_LIST = [10, 20, 50, 100]
PRIMARY_TOP_K = 20

SUBSCRIBER_TIERS = [
    ("1K-10K", 1_000, 10_000),
    ("10K-50K", 10_000, 50_000),
    ("50K-200K", 50_000, 200_000),
    ("200K-1M", 200_000, 1_000_000),
    ("1M+", 1_000_000, None),
]
TIER_MIN_CANDIDATES = 40
TIER_MIN_POSITIVES = 8

AUX_HOLDOUT_FRACTION = 0.15
GROUP_KFOLD_SPLITS = 5
RANDOM_SEED = 42
CONFORMAL_ALPHA = 0.10  # 90% target coverage

FEATURE_NAMES = [
    "video_count_in_window",
    "publish_interval_mean_days",
    "publish_interval_std_days",
    "engagement_like_ratio_mean",
    "engagement_comment_ratio_mean",
    "relative_velocity_mean",
    "relative_velocity_std",
    "channel_age_days_at_window_end",
    "window_momentum_acceleration",
    "season_adjusted_relative_velocity_mean",
]
# subscriber_count / view_count_total are deliberately excluded: they're
# current-snapshot totals (single-crawl design has no as-of-T values), so
# using them as "pre-T" features leaks post-T growth straight into the inputs.
#
# season_adjusted_relative_velocity_mean is NEW in this refactor: divide each
# pre-T video's relative_velocity by its (vertical, month) season coefficient
# before averaging. Which season-coefficient table gets used ("leaky",
# estimated from all channels including post-T videos, vs "fixed", estimated
# only from auxiliary_holdout) is the whole point of the §2.2 gate in
# validate.py — this feature has to exist for that comparison to mean anything.


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


# ---------------------------------------------------------------------------
# Channel split: main_pool (train + eval) vs auxiliary_holdout (season coef /
# isotonic calibration / conformal quantiles). Stratified by subscriber tier
# so each tier keeps roughly the same holdout proportion.
# ---------------------------------------------------------------------------

def _tier_for(subscriber_count: int | None) -> str:
    sc = subscriber_count or 0
    for name, lo, hi in SUBSCRIBER_TIERS:
        if sc >= lo and (hi is None or sc < hi):
            return name
    return "<1K"  # excluded from stratified reporting per REFACTOR_PLAN.md §2 decision 5


def split_main_and_auxiliary(channels: list[dict], frac: float = AUX_HOLDOUT_FRACTION, seed: int = RANDOM_SEED):
    rng = np.random.default_rng(seed)
    by_tier: dict[str, list[dict]] = {}
    for ch in channels:
        by_tier.setdefault(_tier_for(ch.get("subscriber_count")), []).append(ch)

    aux_ids, main_ids = set(), set()
    for tier, chs in by_tier.items():
        ids = [c["channel_id"] for c in chs]
        rng.shuffle(ids)
        n_aux = round(len(ids) * frac)
        aux_ids.update(ids[:n_aux])
        main_ids.update(ids[n_aux:])

    main_pool = [c for c in channels if c["channel_id"] in main_ids]
    aux_holdout = [c for c in channels if c["channel_id"] in aux_ids]
    logger.info(
        "channel split: main_pool=%d auxiliary_holdout=%d (target fraction=%.2f)",
        len(main_pool), len(aux_holdout), frac,
    )
    return main_pool, aux_holdout


# ---------------------------------------------------------------------------
# Season coefficients — two versions, both computed the same way, just fed
# different channel sets. "leaky" == old features.py behavior (all channels,
# including videos published after any T cutoff). "fixed" == only
# auxiliary_holdout's videos, which never enter training or the eval snapshot.
# ---------------------------------------------------------------------------
SEASON_MONTH_MIN_SAMPLE = 10


def compute_season_coefs(channels: list[dict]) -> dict:
    by_vertical_month: dict[str, dict[int, list[float]]] = {}
    for ch in channels:
        vertical = ch.get("vertical", "未分类")
        for v in ch["videos"]:
            if v.get("relative_velocity") is None:
                continue
            month = _parse_iso(v["published_at"]).month
            by_vertical_month.setdefault(vertical, {}).setdefault(month, []).append(v["relative_velocity"])

    season_coefs = {}
    for vertical, month_map in by_vertical_month.items():
        raw_month_median = {
            m: statistics.median(vals) for m, vals in month_map.items() if len(vals) >= SEASON_MONTH_MIN_SAMPLE
        }
        if not raw_month_median:
            season_coefs[vertical] = {"coefs": [1.0] * 12, "insufficient_sample": True}
            continue
        annual_median = statistics.median(raw_month_median.values())
        coefs = [
            (raw_month_median[m] / annual_median) if m in raw_month_median and annual_median else 1.0
            for m in range(1, 13)
        ]
        season_coefs[vertical] = {"coefs": coefs, "insufficient_sample": len(raw_month_median) < 12}
    return season_coefs


def season_coef_for(season_coefs: dict, vertical: str, month: int) -> float:
    return season_coefs.get(vertical, {}).get("coefs", [1.0] * 12)[month - 1] or 1.0


# ---------------------------------------------------------------------------
# Row construction: one row = one (channel, T-cutoff) pair.
# ---------------------------------------------------------------------------

def extract_window_features(channel: dict, videos_subset: list[dict], window_end: datetime, season_coefs: dict) -> list[float]:
    n = len(videos_subset)
    if n == 0:
        return [math.nan] * len(FEATURE_NAMES)

    sorted_v = sorted(videos_subset, key=lambda v: v["published_at"])
    published_dt = [_parse_iso(v["published_at"]) for v in sorted_v]
    intervals = [(b - a).total_seconds() / 86400 for a, b in zip(published_dt, published_dt[1:])]
    interval_mean = sum(intervals) / len(intervals) if intervals else math.nan
    interval_std = statistics.stdev(intervals) if len(intervals) >= 2 else math.nan

    like_ratios = [v["like_count"] / v["view_count"] for v in videos_subset if v.get("like_count") is not None and v["view_count"] > 0]
    comment_ratios = [v["comment_count"] / v["view_count"] for v in videos_subset if v.get("comment_count") is not None and v["view_count"] > 0]
    like_mean = sum(like_ratios) / len(like_ratios) if like_ratios else math.nan
    comment_mean = sum(comment_ratios) / len(comment_ratios) if comment_ratios else math.nan

    rv = [v["relative_velocity"] for v in videos_subset if v.get("relative_velocity") is not None]
    rv_mean = sum(rv) / len(rv) if rv else math.nan
    rv_std = statistics.stdev(rv) if len(rv) >= 2 else math.nan

    if n >= MIN_VIDEOS_FOR_WINDOW_SPLIT:
        mid = n // 2
        early_rv = [v["relative_velocity"] for v in sorted_v[:mid] if v.get("relative_velocity") is not None]
        late_rv = [v["relative_velocity"] for v in sorted_v[mid:] if v.get("relative_velocity") is not None]
        window_momentum = (sum(late_rv) / len(late_rv)) - (sum(early_rv) / len(early_rv)) if early_rv and late_rv else math.nan
    else:
        window_momentum = math.nan

    vertical = channel.get("vertical", "未分类")
    season_adj = [
        v["relative_velocity"] / season_coef_for(season_coefs, vertical, _parse_iso(v["published_at"]).month)
        for v in videos_subset
        if v.get("relative_velocity") is not None
    ]
    season_adj_mean = sum(season_adj) / len(season_adj) if season_adj else math.nan

    channel_created = _parse_iso(channel["published_at"]) if channel.get("published_at") else None
    age_at_window_end = (window_end - channel_created).days if channel_created else math.nan

    return [
        n, interval_mean, interval_std, like_mean, comment_mean,
        rv_mean, rv_std, age_at_window_end, window_momentum, season_adj_mean,
    ]


def _split_pre_post(videos: list[dict], t_cutoff: datetime):
    pre = [v for v in videos if _parse_iso(v["published_at"]) < t_cutoff]
    post = [v for v in videos if _parse_iso(v["published_at"]) >= t_cutoff]
    return pre, post


def build_row(channel: dict, t_cutoff: datetime, season_coefs: dict) -> dict | None:
    """One row for (channel, t_cutoff), or None if it fails the §1.2 untestable gate."""
    pre, post = _split_pre_post(channel["videos"], t_cutoff)
    pre_rv = [v["relative_velocity"] for v in pre if v.get("relative_velocity") is not None]
    post_rv = [v["relative_velocity"] for v in post if v.get("relative_velocity") is not None]

    if len(pre_rv) < MIN_PRE_VIDEOS or len(post_rv) < MIN_POST_VIDEOS:
        return None  # untestable — dropped, not labeled 0 (REFACTOR_PLAN.md §1.2)

    pre_median = statistics.median(pre_rv)
    post_median = statistics.median(post_rv)
    features = extract_window_features(channel, pre, t_cutoff, season_coefs)

    return {
        "channel_id": channel["channel_id"],
        "t_cutoff_days": (datetime.now(timezone.utc) - t_cutoff).days,  # for grouping ranker query groups
        "features": features,
        "pre_median": pre_median,
        "post_median": post_median,
        "pre_rv": pre_rv,
        "post_rv": post_rv,
        "subscriber_count": channel.get("subscriber_count") or 0,
        "tier": _tier_for(channel.get("subscriber_count")),
    }


def build_training_rows(main_pool: list[dict], fetched_at: datetime, season_coefs: dict) -> list[dict]:
    rows = []
    dropped = {d: 0 for d in T_LEVELS_DAYS}
    kept = {d: 0 for d in T_LEVELS_DAYS}
    for days in T_LEVELS_DAYS:
        t_cutoff = fetched_at - timedelta(days=days)
        for ch in main_pool:
            row = build_row(ch, t_cutoff, season_coefs)
            if row is None:
                dropped[days] += 1
                continue
            row["t_level_days"] = days
            rows.append(row)
            kept[days] += 1
    logger.info("training rows built (sliding T=%s): kept=%s dropped(untestable)=%s", T_LEVELS_DAYS, kept, dropped)
    return rows


def build_eval_rows(main_pool: list[dict], fetched_at: datetime, season_coefs: dict) -> list[dict]:
    t_cutoff = fetched_at - timedelta(days=EVAL_T_DAYS)
    rows, dropped = [], 0
    for ch in main_pool:
        row = build_row(ch, t_cutoff, season_coefs)
        if row is None:
            dropped += 1
            continue
        row["t_level_days"] = EVAL_T_DAYS
        rows.append(row)
    logger.info("eval snapshot rows built (fixed T=%dd): kept=%d dropped(untestable)=%d", EVAL_T_DAYS, len(rows), dropped)
    return rows


# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------

def label_old_loose(row: dict) -> int:
    """Original (pre-refactor) label: post_median > pre_median * 1.2. Kept only
    for before/after comparisons in validate.py (season-leak gate, label
    tightening report) — not used for the production model."""
    return 1 if (row["pre_median"] > 0 and row["post_median"] > row["pre_median"] * OLD_AMPLITUDE_THRESHOLD) else 0


def label_tightened(row: dict, amplitude_threshold: float = AMPLITUDE_THRESHOLD_DEFAULT) -> int:
    """§1.3: amplitude AND persistence must both hold."""
    if row["pre_median"] <= 0:
        return 0
    amplitude_ok = row["post_median"] > row["pre_median"] * amplitude_threshold
    if not amplitude_ok:
        return 0
    beating = sum(1 for rv in row["post_rv"] if rv > row["pre_median"])
    persistence_ok = (beating / len(row["post_rv"])) >= PERSISTENCE_RATIO
    return 1 if persistence_ok else 0


def label_continuous(row: dict) -> float | None:
    """Regression target for the probability head: log(post_median/pre_median)."""
    if row["pre_median"] <= 0 or row["post_median"] <= 0:
        return None
    return math.log(row["post_median"] / row["pre_median"])


def resolve_tightened_threshold(rows: list[dict]) -> tuple[float, dict]:
    """Try AMPLITUDE_THRESHOLD_DEFAULT; auto-relax to FALLBACK if positive rate < 5%.
    Returns (threshold_used, stats) — stats always reports both thresholds tried."""
    labels_default = [label_tightened(r, AMPLITUDE_THRESHOLD_DEFAULT) for r in rows]
    rate_default = sum(labels_default) / len(labels_default) if labels_default else 0.0
    if rate_default >= MIN_POSITIVE_RATE_BEFORE_RELAX:
        return AMPLITUDE_THRESHOLD_DEFAULT, {
            "threshold_used": AMPLITUDE_THRESHOLD_DEFAULT, "positive_rate": rate_default, "relaxed": False,
        }
    labels_fallback = [label_tightened(r, AMPLITUDE_THRESHOLD_FALLBACK) for r in rows]
    rate_fallback = sum(labels_fallback) / len(labels_fallback) if labels_fallback else 0.0
    logger.warning(
        "tightened label positive rate %.3f < %.2f threshold at amplitude=%.1f — relaxing to amplitude=%.1f (positive rate now %.3f)",
        rate_default, MIN_POSITIVE_RATE_BEFORE_RELAX, AMPLITUDE_THRESHOLD_DEFAULT, AMPLITUDE_THRESHOLD_FALLBACK, rate_fallback,
    )
    return AMPLITUDE_THRESHOLD_FALLBACK, {
        "threshold_used": AMPLITUDE_THRESHOLD_FALLBACK, "positive_rate": rate_fallback, "relaxed": True,
        "positive_rate_at_default_threshold": rate_default,
    }


def heuristic_potential_score(features: dict) -> float:
    """Transparent weighted heuristic, used only when training_sample_count <
    MIN_GBDT_SAMPLES. Unchanged from the pre-refactor version — this fallback
    path isn't part of what's being redesigned. Each raw signal is squashed
    into [0,1] (sigmoid for unbounded signals, clip for ones with a natural
    ceiling), then combined with fixed weights. Missing signals default to
    0.5 (neutral) rather than 0, so sparse data isn't automatically penalized.
    """
    def sigmoid(x):
        return 1 / (1 + math.exp(-x))

    accel = features.get("momentum_acceleration")
    accel_c = sigmoid(accel) if accel is not None else 0.5

    rv = features.get("recent_relative_velocity_mean")
    velocity_c = sigmoid(math.log(rv)) if rv is not None and rv > 0 else 0.5

    trend = features.get("engagement_trend")
    trend_c = sigmoid(trend * 1000) if trend is not None else 0.5

    cadence = features.get("publish_cadence_30d")
    cadence_c = min(cadence / 10, 1.0) if cadence is not None else 0.5

    return 100 * (0.4 * accel_c + 0.3 * velocity_c + 0.15 * trend_c + 0.15 * cadence_c)


# ---------------------------------------------------------------------------
# §4 dual-head model: LGBMRanker (排序头, for the leaderboard) + LGBMRegressor
# (概率头, for the calibrated "acceleration probability" shown per creator).
# See REFACTOR_PLAN.md §4/§5. Both heads share the same FEATURE_NAMES input.
# ---------------------------------------------------------------------------
RANKING_QUANTILE_CUTS = [0.25, 0.5, 0.75]  # -> 4 grades (0..3)


def compute_graded_labels(rows: list[dict]) -> tuple[list[int], list[float]]:
    """Ordinal 0-3 relevance grade for the ranker, cut from the training
    pool's own distribution of continuous log-ratio labels (quantile-based,
    not fixed thresholds — the cut points are printed so they're inspectable,
    not a hidden magic number)."""
    continuous = [label_continuous(r) for r in rows]
    valid = [c for c in continuous if c is not None]
    if not valid:
        return [0] * len(rows), [math.nan] * len(RANKING_QUANTILE_CUTS)
    cuts = np.quantile(valid, RANKING_QUANTILE_CUTS).tolist()
    grades = []
    for c in continuous:
        if c is None:
            grades.append(0)
            continue
        grade = 0
        for cut in cuts:
            if c > cut:
                grade += 1
        grades.append(grade)
    return grades, cuts


def _sort_rows_by_t_level(rows: list[dict], *arrays: np.ndarray):
    """LGBMRanker needs rows contiguous by query group; a training row's
    "query" is its T-level snapshot (REFACTOR_PLAN.md §4.1 — ranking within
    the same point in time is what's operationally meaningful, ranking across
    different T levels isn't). Returns sorted rows/arrays plus the group-size
    list lightgbm expects."""
    order = sorted(range(len(rows)), key=lambda i: rows[i]["t_level_days"])
    sorted_rows = [rows[i] for i in order]
    sorted_arrays = [arr[order] for arr in arrays]
    group_sizes, current, count = [], None, 0
    for r in sorted_rows:
        if r["t_level_days"] != current:
            if count:
                group_sizes.append(count)
            current, count = r["t_level_days"], 1
        else:
            count += 1
    if count:
        group_sizes.append(count)
    return sorted_rows, sorted_arrays, group_sizes


def train_ranker(rows: list[dict], grades: list[int], random_state: int = RANDOM_SEED) -> lgb.LGBMRanker:
    X = np.array([r["features"] for r in rows], dtype=float)
    y = np.array(grades, dtype=int)
    _, (X_sorted, y_sorted), group_sizes = _sort_rows_by_t_level(rows, X, y)
    model = lgb.LGBMRanker(
        objective="lambdarank", metric="ndcg", eval_at=[10, 20, 50, 100],
        random_state=random_state, verbosity=-1, n_estimators=200,
    )
    model.fit(X_sorted, y_sorted, group=group_sizes)
    return model


def train_regressor(rows: list[dict], random_state: int = RANDOM_SEED) -> lgb.LGBMRegressor:
    labeled = [(r, label_continuous(r)) for r in rows]
    labeled = [(r, y) for r, y in labeled if y is not None]
    X = np.array([r["features"] for r, _ in labeled], dtype=float)
    y = np.array([y for _, y in labeled], dtype=float)
    model = lgb.LGBMRegressor(random_state=random_state, verbosity=-1, n_estimators=200)
    model.fit(X, y)
    return model


def train_dual_head_oof(training_rows: list[dict], eval_rows: list[dict],
                         n_splits: int = GROUP_KFOLD_SPLITS, random_state: int = RANDOM_SEED) -> dict:
    """GroupKFold(groups=channel_id) out-of-fold predictions for both heads on
    the eval snapshot — same leak-safety pattern as the diagnostic gates in
    validate.py, just with the production dual-head model instead of the
    single HistGradientBoostingClassifier used there."""
    channel_ids = np.array([r["channel_id"] for r in training_rows])
    grades, grade_cuts = compute_graded_labels(training_rows)
    eval_by_channel = {r["channel_id"]: r for r in eval_rows}

    n_splits_eff = min(n_splits, len(set(channel_ids)))
    gkf = GroupKFold(n_splits=n_splits_eff)
    rank_oof: dict[str, float] = {}
    reg_oof: dict[str, float] = {}
    ranker_gain_sum = np.zeros(len(FEATURE_NAMES))
    regressor_gain_sum = np.zeros(len(FEATURE_NAMES))
    n_folds = 0

    dummy_X = np.zeros((len(training_rows), 1))  # GroupKFold only needs len(X) and groups
    for train_idx, test_idx in gkf.split(dummy_X, groups=channel_ids):
        fold_rows = [training_rows[i] for i in train_idx]
        fold_grades = [grades[i] for i in train_idx]
        held_out_channels = set(channel_ids[test_idx])

        ranker = train_ranker(fold_rows, fold_grades, random_state)
        regressor = train_regressor(fold_rows, random_state)
        ranker_gain_sum += ranker.booster_.feature_importance(importance_type="gain")
        regressor_gain_sum += regressor.booster_.feature_importance(importance_type="gain")
        n_folds += 1

        for cid in held_out_channels:
            if cid in eval_by_channel and cid not in rank_oof:
                feats = np.array([eval_by_channel[cid]["features"]])
                rank_oof[cid] = float(ranker.predict(feats)[0])
                reg_oof[cid] = float(regressor.predict(feats)[0])

    def _importance_table(gain_sum: np.ndarray) -> list[dict]:
        total = gain_sum.sum()
        pct = (gain_sum / total * 100) if total > 0 else gain_sum
        return sorted(
            [{"feature": name, "importance": float(p)} for name, p in zip(FEATURE_NAMES, pct)],
            key=lambda d: -d["importance"],
        )

    feature_importance = {
        "ranker": _importance_table(ranker_gain_sum / max(n_folds, 1)),
        "regressor": _importance_table(regressor_gain_sum / max(n_folds, 1)),
        "method": "基于 LightGBM 内置增益重要性（gain importance），取 GroupKFold 各折平均。"
                  "注意这不是 permutation importance——是训练阶段的分裂增益，不是留出集扰动测试，"
                  "可能偏向取值更分散的特征，仅供参考排序，不作为唯一依据。",
    }
    return {
        "rank_oof": rank_oof, "reg_oof": reg_oof, "grade_cuts": grade_cuts,
        "feature_importance": feature_importance,
    }


def compute_permutation_importance(ranker: lgb.LGBMRanker, regressor: lgb.LGBMRegressor,
                                    aux_holdout: list[dict], fetched_at: datetime, season_coefs: dict,
                                    n_repeats: int = 20, random_state: int = RANDOM_SEED) -> dict | None:
    """Real permutation importance (sklearn.inspection), as opposed to the
    LightGBM training-time gain importance in train_dual_head_oof above.
    Computed on auxiliary_holdout's eval-snapshot rows — the same independent
    channels used for calibration/conformal (PLAN.md §8.1.4): shuffle one
    feature column at a time on data neither head trained on, and measure how
    much the score degrades. LGBMRanker has no continuous label to score MAE
    against, so its scorer is the Spearman rank-correlation between predicted
    scores and the continuous acceleration label; the regressor uses negative
    MAE. Returns None if there aren't enough labeled holdout rows to trust it."""
    aux_eval_rows = build_eval_rows(aux_holdout, fetched_at, season_coefs)
    labeled = [(r, label_continuous(r)) for r in aux_eval_rows]
    labeled = [(r, y) for r, y in labeled if y is not None]
    if len(labeled) < 10:
        logger.warning("aux eval rows too few (%d) for permutation importance — skipping", len(labeled))
        return None

    X = np.array([r["features"] for r, _ in labeled], dtype=float)
    y = np.array([y for _, y in labeled], dtype=float)

    def _rank_scorer(estimator, X_, y_) -> float:
        preds = estimator.predict(X_)
        corr, _ = spearmanr(preds, y_)
        return 0.0 if np.isnan(corr) else float(corr)

    def _table(importances_mean: np.ndarray) -> list[dict]:
        clipped = np.clip(importances_mean, 0, None)
        total = clipped.sum()
        pct = (clipped / total * 100) if total > 0 else clipped
        return sorted(
            [{"feature": name, "importance": float(p)} for name, p in zip(FEATURE_NAMES, pct)],
            key=lambda d: -d["importance"],
        )

    ranker_result = permutation_importance(
        ranker, X, y, scoring=_rank_scorer, n_repeats=n_repeats, random_state=random_state,
    )
    regressor_result = permutation_importance(
        regressor, X, y, scoring="neg_mean_absolute_error", n_repeats=n_repeats, random_state=random_state,
    )

    return {
        "ranker": _table(ranker_result.importances_mean),
        "regressor": _table(regressor_result.importances_mean),
        "method": "sklearn.inspection.permutation_importance：在 auxiliary_holdout 独立留出频道上逐列打乱特征、"
                  "测量指标下降幅度（排序头用预测值与真实标签的Spearman相关系数下降，概率头用负MAE下降），"
                  f"n_repeats={n_repeats}，负值（打乱后指标反而变好，视为噪声）截断为0后按占比换算。"
                  "与上面 feature_importance（训练期分裂增益）互补——这个是留出集扰动测试，更贴近真实泛化重要性。",
        "n_eval_rows": len(labeled),
    }


def calibrate_and_conformalize(reg_model: lgb.LGBMRegressor, aux_holdout: list[dict], fetched_at: datetime,
                                season_coefs: dict, label_fn, conformal_alpha: float = CONFORMAL_ALPHA) -> dict:
    """§4.2 probability calibration + §5 conformal interval, both fit on
    auxiliary_holdout's own eval-snapshot rows (T=60d) — data the production
    regressor never trained on.

    Uses Platt/sigmoid scaling (1-D logistic regression on the raw regressor
    score), not isotonic regression. Isotonic was the original design (see
    REFACTOR_PLAN.md §4.2) but with only ~90 calibration rows and ~6 positives
    it collapsed to 4 output plateaus (0%/3.2%/9.1%/100%) — confirmed by
    inspecting IsotonicRegression's y_thresholds_ directly. Applied to 2000+
    channels that meant ~92% of them landed on just 3 of those 4 values,
    showing up as dense vertical stripes on the P-vs-R scatter plot. Platt
    scaling fits a smooth 2-parameter sigmoid instead of a step function, so
    it doesn't need nearly as many calibration points to stay continuous —
    the standard reason isotonic is usually reserved for larger calibration
    sets. Reports the same Brier/coverage diagnostics either way.

    Returns the fitted calibrator plus the conformal residual quantile, and
    actual coverage on this same holdout (should sit close to the nominal
    1-alpha, not exactly, since this is a finite calibration set)."""
    aux_eval_rows = build_eval_rows(aux_holdout, fetched_at, season_coefs)
    labeled = [(r, label_continuous(r)) for r in aux_eval_rows]
    labeled = [(r, y) for r, y in labeled if y is not None]
    if len(labeled) < 10:
        logger.warning("auxiliary_holdout eval rows too few (%d) for reliable calibration/conformal", len(labeled))

    X = np.array([r["features"] for r, _ in labeled], dtype=float)
    y_true_continuous = np.array([y for _, y in labeled], dtype=float)
    y_true_binary = np.array([label_fn(r) for r, _ in labeled], dtype=int)
    raw_pred = reg_model.predict(X)

    calibrator = LogisticRegression()
    calibrator.fit(raw_pred.reshape(-1, 1), y_true_binary)
    calibrated_prob = calibrator.predict_proba(raw_pred.reshape(-1, 1))[:, 1]

    brier = brier_score_loss(y_true_binary, calibrated_prob)
    calibration_curve = _calibration_bins(calibrated_prob, y_true_binary, n_bins=10)

    residuals = np.abs(y_true_continuous - raw_pred)
    conformal_quantile = float(np.quantile(residuals, 1 - conformal_alpha)) if len(residuals) else 0.0

    covered = np.abs(y_true_continuous - raw_pred) <= conformal_quantile
    actual_coverage = float(covered.mean()) if len(covered) else None

    logger.info(
        "calibration/conformal on auxiliary_holdout (n=%d): Brier=%.4f conformal_quantile(log-ratio)=%.4f "
        "target_coverage=%.2f actual_coverage=%s",
        len(labeled), brier, conformal_quantile, 1 - conformal_alpha, actual_coverage,
    )
    return {
        "calibrator": calibrator,
        "conformal_quantile": conformal_quantile,
        "brier_score": brier,
        "calibration_curve": calibration_curve,
        "target_coverage": 1 - conformal_alpha,
        "actual_coverage": actual_coverage,
        "n_calibration_rows": len(labeled),
    }


def _predict_calibrated(calibrator: LogisticRegression, raw_values: np.ndarray) -> np.ndarray:
    return calibrator.predict_proba(raw_values.reshape(-1, 1))[:, 1]


def topk_hit_rate(rows_with_score: list[tuple[dict, float]], label_fn, k: int) -> tuple[float, int]:
    ranked = sorted(rows_with_score, key=lambda pair: -pair[1])[:k]
    labels = [label_fn(r) for r, _ in ranked]
    return (sum(labels) / len(labels) if labels else 0.0), len(ranked)


def stratified_topk_report(eval_rows: list[dict], rank_scores: dict[str, float], label_fn,
                             k_values: list[int] = TOP_K_LIST, primary_k: int = PRIMARY_TOP_K) -> dict:
    """§1.4: global + per-subscriber-tier Top-K lift table. <1K-subscriber
    channels are excluded from the per-tier breakdown (REFACTOR_PLAN.md §2
    decision 5 — the 5 tiers given start at 1K) but counted in the global
    row and reported by name so nothing silently vanishes."""

    def build_row_for(rows_subset: list[dict]) -> dict:
        scored = [(r, rank_scores[r["channel_id"]]) for r in rows_subset if r["channel_id"] in rank_scores]
        baseline_scored = [(r, r["subscriber_count"]) for r in rows_subset]
        n_candidates = len(rows_subset)
        n_positive = sum(label_fn(r) for r in rows_subset)
        per_k = {}
        for k in k_values:
            model_hit, model_n = topk_hit_rate(scored, label_fn, k)
            baseline_hit, baseline_n = topk_hit_rate(baseline_scored, label_fn, k)
            lift = (model_hit / baseline_hit) if baseline_hit > 0 else None
            per_k[k] = {
                "baseline_hit_rate": baseline_hit, "model_hit_rate": model_hit, "lift": lift,
                "scored_n": model_n,
            }
        return {
            "n_candidates": n_candidates, "n_positive": n_positive,
            "insufficient_sample": n_candidates < TIER_MIN_CANDIDATES or n_positive < TIER_MIN_POSITIVES,
            "per_k": per_k,
        }

    report = {"global": build_row_for(eval_rows), "primary_k": primary_k}
    for tier_name, _, _ in SUBSCRIBER_TIERS:
        tier_rows = [r for r in eval_rows if r["tier"] == tier_name]
        report[tier_name] = build_row_for(tier_rows)
    report["excluded_below_1k"] = {"count": sum(1 for r in eval_rows if r["tier"] == "<1K")}
    return report


def _calibration_bins(pred_prob: np.ndarray, y_true: np.ndarray, n_bins: int = 10) -> list[dict]:
    edges = np.linspace(0, 1, n_bins + 1)
    bins = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (pred_prob >= lo) & (pred_prob < hi if hi < 1 else pred_prob <= hi)
        n = int(mask.sum())
        bins.append({
            "bin_lo": float(lo), "bin_hi": float(hi), "n": n,
            "mean_predicted": float(pred_prob[mask].mean()) if n else None,
            "observed_frequency": float(y_true[mask].mean()) if n else None,
        })
    return bins


# ---------------------------------------------------------------------------
# Resonance score (R) — untouched from the prior version.
# ---------------------------------------------------------------------------

def load_dimensions_index() -> dict:
    with open(DIMENSIONS_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return {d["key"]: d["index"] for d in data["dimensions"]}


def load_products() -> list[dict]:
    with open(PRODUCTS_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)["products"]


def load_vision_cache() -> dict:
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in VISION_CACHE_DIR.glob("*.json")}


def cosine_similarity_with_contributions(content_vec: list[float], product_vec: list[float]) -> tuple[float, list[float]]:
    c = np.array(content_vec, dtype=float)
    p = np.array(product_vec, dtype=float)
    norm_c, norm_p = np.linalg.norm(c), np.linalg.norm(p)
    if norm_c == 0 or norm_p == 0:
        return 0.0, [0.0] * len(content_vec)
    denom = norm_c * norm_p
    per_dim_contribution = (c * p) / denom
    return float(per_dim_contribution.sum()), per_dim_contribution.tolist()


def compute_resonance_scores(channels: list[dict], vision_cache: dict, products: list[dict], dim_index: dict) -> dict:
    resonance = {}
    analyzed = 0
    for ch in channels:
        vision = vision_cache.get(ch["channel_id"])
        if vision is None:
            resonance[ch["channel_id"]] = None
            continue
        analyzed += 1
        content_vec = vision["content_vector"]
        by_product = {}
        for prod in products:
            cosine, contributions = cosine_similarity_with_contributions(content_vec, prod["vector"])
            feature_breakdown = {}
            for feat_name, weight_info in prod["feature_weights"].items():
                dims = weight_info["dims"]
                idxs = [dim_index[d] for d in dims]
                prod_weight_sum = sum(prod["vector"][i] for i in idxs)
                feature_breakdown[feat_name] = (
                    100 * sum(content_vec[i] * prod["vector"][i] for i in idxs) / prod_weight_sum if prod_weight_sum > 0 else 0.0
                )
            by_product[prod["id"]] = {
                "value": cosine * 100,
                "contributions": [{"dim": k, "contribution": contributions[i] * 100} for k, i in dim_index.items()],
                "feature_breakdown": feature_breakdown,
            }
        resonance[ch["channel_id"]] = by_product
    logger.info("resonance computed for %d/%d channels (rest awaiting vision analysis)", analyzed, len(channels))
    return resonance


def run() -> dict:
    data = json.loads(FEATURES_PATH.read_text(encoding="utf-8"))
    channels = data["channels"]
    fetched_at = _parse_iso(data["fetched_at"])

    main_pool, aux_holdout = split_main_and_auxiliary(channels)
    season_coefs = compute_season_coefs(aux_holdout)  # leak-free version — see REFACTOR_PLAN.md §2.2
    training_rows = build_training_rows(main_pool, fetched_at, season_coefs)
    eval_rows = build_eval_rows(main_pool, fetched_at, season_coefs)
    n_samples = len(training_rows)

    threshold_used, threshold_stats = resolve_tightened_threshold(training_rows)
    label_fn = lambda r: label_tightened(r, threshold_used)  # noqa: E731

    logger.info(
        "potential-score training set: %d rows from %d main_pool channels (T levels=%s), "
        "tightened-label threshold=%.1f (%s)",
        n_samples, len(main_pool), T_LEVELS_DAYS, threshold_used,
        "auto-relaxed from 1.5" if threshold_stats["relaxed"] else "default",
    )

    potential_meta = {
        "method": None,
        "training_sample_count": n_samples,
        "positive_label_rate": None,
        "threshold_stats": threshold_stats,
        "grade_cuts": None,
        "calibration": None,
        "backtest_stratified": None,
        "feature_importance": None,
        "permutation_importance": None,
    }
    potential_scores: dict[str, dict] = {}

    if n_samples >= MIN_GBDT_SAMPLES:
        potential_meta["method"] = "dual_head_gbdt"
        train_labels = [label_fn(r) for r in training_rows]
        potential_meta["positive_label_rate"] = sum(train_labels) / len(train_labels) if train_labels else None

        oof = train_dual_head_oof(training_rows, eval_rows)
        potential_meta["grade_cuts"] = oof["grade_cuts"]
        potential_meta["feature_importance"] = oof["feature_importance"]
        stratified = stratified_topk_report(eval_rows, oof["rank_oof"], label_fn)
        potential_meta["backtest_stratified"] = stratified
        logger.info(
            "backtest (global, Top-%d): baseline_hit=%.3f model_hit=%.3f lift=%s (n_candidates=%d n_positive=%d)",
            PRIMARY_TOP_K, stratified["global"]["per_k"][PRIMARY_TOP_K]["baseline_hit_rate"],
            stratified["global"]["per_k"][PRIMARY_TOP_K]["model_hit_rate"],
            stratified["global"]["per_k"][PRIMARY_TOP_K]["lift"],
            stratified["global"]["n_candidates"], stratified["global"]["n_positive"],
        )

        # Final production models: refit on ALL main_pool training rows (not
        # folded) — this is what actually scores every channel below.
        grades, _ = compute_graded_labels(training_rows)
        final_ranker = train_ranker(training_rows, grades)
        final_regressor = train_regressor(training_rows)
        calib = calibrate_and_conformalize(final_regressor, aux_holdout, fetched_at, season_coefs, label_fn)
        potential_meta["calibration"] = {
            k: v for k, v in calib.items() if k != "calibrator"  # sklearn model itself isn't JSON-serializable
        }
        potential_meta["permutation_importance"] = compute_permutation_importance(
            final_ranker, final_regressor, aux_holdout, fetched_at, season_coefs,
        )

        # Two passes: calibrated probability naturally clusters near the ~7%
        # base rate for most channels (that's what "calibrated" means when
        # most channels aren't strongly differentiated) — on a fixed 0-100
        # scale that reads as "every score looks the same". Min-max stretch
        # the OBSERVED probability range to fill 0-100: this keeps "value"
        # meaning "calibrated acceleration probability" (unlike a percentile
        # rank, which would silently redefine it as "rank among peers") and
        # doesn't flatten the underlying skew — it only rescales linearly,
        # so relative spacing between channels is preserved exactly.
        raw_by_channel = {}
        for ch in channels:
            feats = extract_window_features(ch, ch["videos"], fetched_at, season_coefs)
            feats_arr = np.array([feats])
            rank_score = float(final_ranker.predict(feats_arr)[0])
            raw_reg = float(final_regressor.predict(feats_arr)[0])
            p = float(_predict_calibrated(calib["calibrator"], np.array([raw_reg]))[0])
            p_lo = float(_predict_calibrated(calib["calibrator"], np.array([raw_reg - calib["conformal_quantile"]]))[0])
            p_hi = float(_predict_calibrated(calib["calibrator"], np.array([raw_reg + calib["conformal_quantile"]]))[0])
            raw_by_channel[ch["channel_id"]] = {
                "p": p, "p_lo": min(p_lo, p_hi), "p_hi": max(p_lo, p_hi), "rank_score": rank_score,
            }

        all_p = [v["p"] for v in raw_by_channel.values()]
        p_min, p_max = min(all_p), max(all_p)
        p_span = p_max - p_min

        def _stretch(x: float) -> float:
            return ((x - p_min) / p_span * 100) if p_span > 0 else x * 100

        for cid, v in raw_by_channel.items():
            potential_scores[cid] = {
                "value": _stretch(v["p"]),      # calibrated acceleration probability, min-max stretched to use the
                                                  # full 0-100 display range (still `value` for frontend compatibility)
                "value_lo": _stretch(v["p_lo"]),
                "value_hi": _stretch(v["p_hi"]),
                "rank_score": v["rank_score"],
            }
        logger.info(
            "potential value min-max stretch: raw calibrated probability observed range=[%.4f, %.4f] -> display [0,100]",
            p_min, p_max,
        )
    else:
        potential_meta["method"] = "heuristic"
        logger.warning(
            "only %d qualifying training rows (<%d) — falling back to heuristic potential score, "
            "NOT a trained model", n_samples, MIN_GBDT_SAMPLES,
        )
        for ch in channels:
            potential_scores[ch["channel_id"]] = {"value": heuristic_potential_score(ch["features"])}

    dim_index = load_dimensions_index()
    products = load_products()
    vision_cache = load_vision_cache()
    resonance = compute_resonance_scores(channels, vision_cache, products, dim_index)

    out = {
        "fetched_at": data["fetched_at"],
        "channel_split": {"main_pool": len(main_pool), "auxiliary_holdout": len(aux_holdout)},
        "potential": potential_meta,
        "scores": {
            cid: {"potential": potential_scores.get(cid), "resonance": resonance.get(cid)}
            for cid in [c["channel_id"] for c in channels]
        },
    }
    SCORES_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCORES_OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("wrote %s", SCORES_OUT_PATH)
    return {
        "method": potential_meta["method"],
        "training_sample_count": n_samples,
        "resonance_analyzed_count": sum(1 for v in resonance.values() if v is not None),
    }


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
