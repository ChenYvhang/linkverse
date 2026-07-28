import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import clsx from "clsx";
import { useDataset } from "../lib/useDataset";
import { Loading } from "../components/Loading";
import type { BacktestTier, TopKResult } from "../lib/schema";
import { useLocale, type TranslationKey } from "../lib/i18n";

// 网页只展示 Top-20 与 Top-100 两档（K=10/50 仍在 dataset.json 里，供之后需要时取用）
const DISPLAY_K: Array<"20" | "100"> = ["20", "100"];

// score.py FEATURE_NAMES 的展示翻译键，仅用于展示——数据里的字段名保持英文不变，
// 避免图表标签换行/截断，同时不引入"中英文字段名两套真相"的维护负担。
const FEATURE_KEYS: Record<string, TranslationKey> = {
  video_count_in_window: "feature.video_count_in_window",
  publish_interval_mean_days: "feature.publish_interval_mean_days",
  publish_interval_std_days: "feature.publish_interval_std_days",
  engagement_like_ratio_mean: "feature.engagement_like_ratio_mean",
  engagement_comment_ratio_mean: "feature.engagement_comment_ratio_mean",
  relative_velocity_mean: "feature.relative_velocity_mean",
  relative_velocity_std: "feature.relative_velocity_std",
  channel_age_days_at_window_end: "feature.channel_age_days_at_window_end",
  window_momentum_acceleration: "feature.window_momentum_acceleration",
  season_adjusted_relative_velocity_mean: "feature.season_adjusted_relative_velocity_mean",
};

// potential_model.{feature_importance,permutation_importance}.method is a fixed
// methodology caption written once by score.py (not per-creator content), so it
// gets the same known-value-lookup + raw-fallback translation as the architecture
// layer notes on the status page, rather than being left as raw pipeline text.
const FEATURE_IMPORTANCE_METHOD_LABELS: Record<string, TranslationKey> = {
  "基于 LightGBM 内置增益重要性（gain importance），取 GroupKFold 各折平均。注意这不是 permutation importance——是训练阶段的分裂增益，不是留出集扰动测试，可能偏向取值更分散的特征，仅供参考排序，不作为唯一依据。":
    "backtest.featureImportanceMethodGain",
};

const PERMUTATION_IMPORTANCE_METHOD_LABELS: Record<string, TranslationKey> = {
  "sklearn.inspection.permutation_importance：在 auxiliary_holdout 独立留出频道上逐列打乱特征、测量指标下降幅度（排序头用预测值与真实标签的Spearman相关系数下降，概率头用负MAE下降），n_repeats=20，负值（打乱后指标反而变好，视为噪声）截断为0后按占比换算。与上面 feature_importance（训练期分裂增益）互补——这个是留出集扰动测试，更贴近真实泛化重要性。":
    "backtest.permutationImportanceMethodSklearn",
};

export default function BacktestPage() {
  const { t } = useLocale();
  const { data, loading } = useDataset();
  if (loading || !data) return <Loading />;

  const { backtest, potential_model } = data;
  const global = backtest.tiers.find((t) => t.tier === "global")!;
  const tiers = backtest.tiers.filter((t) => t.tier !== "global");

  const kScanData = DISPLAY_K.map((k) => ({
    k: `Top-${k}`,
    baseline: global.per_k[k].baseline_hit_rate * 100,
    model: global.per_k[k].model_hit_rate * 100,
  }));

  const calibrationPoints =
    potential_model.calibration?.calibration_curve
      .filter((b) => b.n > 0)
      .map((b) => ({ x: b.mean_predicted! * 100, y: b.observed_frequency! * 100, n: b.n })) ?? [];

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-[32px] font-bold text-ink-100 mb-1">{t("backtest.title")}</h1>
        <p className="text-sm text-ink-400">
          {t("backtest.subtitle", { threshold: potential_model.label_threshold.threshold_used })}
        </p>
      </div>

      <section>
        <h2 className="text-xl font-medium text-ink-100 mb-3">
          {t("backtest.tierTitle")}
        </h2>
        <div className="border border-white/10 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-ink-400 text-xs">
              <tr>
                <th rowSpan={2} className="text-left px-3 py-2 align-bottom">{t("backtest.colTier")}</th>
                <th rowSpan={2} className="text-right px-3 py-2 align-bottom">{t("backtest.colCandidates")}</th>
                <th rowSpan={2} className="text-right px-3 py-2 align-bottom">{t("backtest.colPositives")}</th>
                <th colSpan={3} className="text-center px-3 py-1 border-l border-white/5">Top-20</th>
                <th colSpan={3} className="text-center px-3 py-1 border-l border-white/5">Top-100</th>
              </tr>
              <tr>
                <th className="text-right px-3 py-1 border-l border-white/5">{t("backtest.colBaseline")}</th>
                <th className="text-right px-3 py-1">{t("backtest.colModel")}</th>
                <th className="text-right px-3 py-1">{t("backtest.colLift")}</th>
                <th className="text-right px-3 py-1 border-l border-white/5">{t("backtest.colBaseline")}</th>
                <th className="text-right px-3 py-1">{t("backtest.colModel")}</th>
                <th className="text-right px-3 py-1">{t("backtest.colLift")}</th>
              </tr>
            </thead>
            <tbody>
              <TierRow tier={global} highlight />
              {tiers.map((tr) => (
                <TierRow key={tr.tier} tier={tr} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-600 mt-2">
          {t("backtest.tierFootnote", { n: backtest.excluded_below_1k_count })}
        </p>
      </section>

      <section>
        <h2 className="text-xl font-medium text-ink-100 mb-3">{t("backtest.kScanTitle")}</h2>
        <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] transition-colors duration-300 hover:border-accent/25">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={kScanData} margin={{ left: 0, right: 20, top: 10 }}>
                <CartesianGrid stroke="#262c42" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="k" tick={{ fontSize: 12, fill: "#8b8f9c" }} />
                <YAxis tick={{ fontSize: 11, fill: "#8b8f9c" }} label={{ value: t("backtest.axisHitRate"), angle: -90, position: "insideLeft", fill: "#6b7280", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#111763", border: "1px solid #242a8a", fontSize: 12 }} formatter={(v) => `${Number(v).toFixed(1)}%`} />
                <Bar dataKey="baseline" name={t("backtest.colBaseline")} fill="#4b5563" radius={[4, 4, 0, 0]} />
                <Bar dataKey="model" name={t("backtest.colModel")} fill="#ff8b26" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-medium text-ink-100 mb-3">
          {t("backtest.calibrationTitle", {
            method: potential_model.method === "dual_head_gbdt" ? t("backtest.methodDualHead") : t("backtest.methodHeuristic"),
          })}
        </h2>
        <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] space-y-4 transition-colors duration-300 hover:border-accent/25">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Metric label={t("backtest.metricTrainSamples")} value={`${potential_model.training_sample_count}`} />
            <Metric label={t("backtest.metricPositiveRate")} value={`${((potential_model.positive_label_rate ?? 0) * 100).toFixed(1)}%`} />
            {potential_model.calibration && (
              <Metric label={t("backtest.metricBrier")} value={potential_model.calibration.brier_score.toFixed(4)} />
            )}
          </div>
          {potential_model.calibration && (
            <div>
              <h3 className="text-xs font-medium text-ink-400 mb-2">
                {t("backtest.calibrationCurveTitle", {
                  n: potential_model.calibration.n_calibration_rows,
                  target: (potential_model.calibration.target_coverage * 100).toFixed(0),
                  actual: potential_model.calibration.actual_coverage !== null
                    ? `${(potential_model.calibration.actual_coverage * 100).toFixed(1)}%`
                    : "n/a",
                })}
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                    <CartesianGrid stroke="#262c42" strokeDasharray="3 3" />
                    <XAxis
                      type="number" dataKey="x" domain={[0, 100]} tick={{ fontSize: 11, fill: "#8b8f9c" }}
                      label={{ value: t("backtest.axisPredicted"), position: "insideBottom", offset: -5, fill: "#6b7280", fontSize: 11 }}
                    />
                    <YAxis
                      type="number" dataKey="y" domain={[0, 100]} tick={{ fontSize: 11, fill: "#8b8f9c" }}
                      label={{ value: t("backtest.axisObserved"), angle: -90, position: "insideLeft", fill: "#6b7280", fontSize: 11 }}
                    />
                    <ZAxis type="number" dataKey="n" range={[40, 240]} />
                    <Tooltip
                      contentStyle={{ background: "#111763", border: "1px solid #242a8a", fontSize: 12 }}
                      formatter={(v, name) => [name === "n" ? `${v}` : `${Number(v).toFixed(1)}%`, `${name}`]}
                    />
                    <Line
                      type="linear" dataKey="y" data={[{ x: 0, y: 0 }, { x: 100, y: 100 }]}
                      stroke="#4b5563" strokeDasharray="4 4" dot={false} legendType="none" activeDot={false}
                    />
                    <Scatter data={calibrationPoints} fill="#ff8b26" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-ink-600 mt-1">{t("backtest.calibrationFootnote")}</p>
            </div>
          )}
        </div>
      </section>

      {potential_model.feature_importance && (
        <section>
          <h2 className="text-xl font-medium text-ink-100 mb-1">{t("backtest.featureImportanceTitle")}</h2>
          <p className="text-xs text-ink-600 mb-3">
            {FEATURE_IMPORTANCE_METHOD_LABELS[potential_model.feature_importance.method]
              ? t(FEATURE_IMPORTANCE_METHOD_LABELS[potential_model.feature_importance.method])
              : potential_model.feature_importance.method}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureImportanceChart
              title={t("backtest.rankerTitle")}
              entries={potential_model.feature_importance.ranker}
            />
            <FeatureImportanceChart
              title={t("backtest.regressorTitle")}
              entries={potential_model.feature_importance.regressor}
            />
          </div>
        </section>
      )}

      {potential_model.permutation_importance && (
        <section>
          <h2 className="text-xl font-medium text-ink-100 mb-1">{t("backtest.permImportanceTitle")}</h2>
          <p className="text-xs text-ink-600 mb-3">
            {PERMUTATION_IMPORTANCE_METHOD_LABELS[potential_model.permutation_importance.method]
              ? t(PERMUTATION_IMPORTANCE_METHOD_LABELS[potential_model.permutation_importance.method])
              : potential_model.permutation_importance.method}
            （{t("backtest.evalRows", { n: potential_model.permutation_importance.n_eval_rows })}）
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureImportanceChart
              title={t("backtest.permRankerTitle")}
              entries={potential_model.permutation_importance.ranker}
            />
            <FeatureImportanceChart
              title={t("backtest.permRegressorTitle")}
              entries={potential_model.permutation_importance.regressor}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function FeatureImportanceChart({ title, entries }: { title: string; entries: { feature: string; importance: number }[] }) {
  const { t } = useLocale();
  const top = entries.slice(0, 8);
  const maxImportance = Math.max(...top.map((e) => e.importance), 1);
  return (
    <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] transition-colors duration-300 hover:border-accent/25">
      <h3 className="text-xs font-medium text-ink-400 mb-3">{title}</h3>
      <div className="space-y-1.5">
        {top.map((e) => (
          <div key={e.feature} className="flex items-center gap-2 text-xs">
            <span className="w-48 shrink-0 text-ink-400 truncate">{FEATURE_KEYS[e.feature] ? t(FEATURE_KEYS[e.feature]) : e.feature}</span>
            <div className="flex-1 bg-white/5 rounded h-3 overflow-hidden">
              <div className="bg-accent h-full" style={{ width: `${(e.importance / maxImportance) * 100}%` }} />
            </div>
            <span className="w-14 text-right text-ink-400">{e.importance.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TierRow({ tier, highlight }: { tier: BacktestTier; highlight?: boolean }) {
  const { t } = useLocale();
  const k20 = tier.per_k["20"];
  const k100 = tier.per_k["100"];
  return (
    <tr className={clsx("transition-colors duration-150 hover:bg-white/[0.04]", highlight ? "bg-accent/5 font-medium" : "border-t border-white/5")}>
      <td className="px-3 py-2 text-ink-100">{tier.tier === "global" ? t("backtest.tierGlobal") : tier.tier}</td>
      <td className="px-3 py-2 text-right text-ink-400">{tier.n_candidates}</td>
      <td className="px-3 py-2 text-right text-ink-400">{tier.n_positive}</td>
      <KCells k={k20} insufficient={tier.insufficient_sample} borderLeft />
      <KCells k={k100} insufficient={tier.insufficient_sample} borderLeft />
    </tr>
  );
}

function KCells({ k, insufficient, borderLeft }: { k: TopKResult; insufficient: boolean; borderLeft?: boolean }) {
  const { t } = useLocale();
  const border = borderLeft ? "border-l border-white/5" : "";
  return (
    <>
      <td className={`px-3 py-2 text-right text-ink-400 ${border}`}>{(k.baseline_hit_rate * 100).toFixed(1)}%</td>
      <td className="px-3 py-2 text-right text-ink-100">{(k.model_hit_rate * 100).toFixed(1)}%</td>
      <td className="px-3 py-2 text-right">
        {insufficient ? (
          <span className="text-ink-600 text-xs">{t("backtest.insufficientSample")}</span>
        ) : (
          <span className="text-accent">{k.lift !== null ? `${k.lift.toFixed(2)}×` : "n/a"}</span>
        )}
      </td>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className="text-lg font-semibold text-ink-100">{value}</div>
    </div>
  );
}
