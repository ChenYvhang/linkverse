import { useDataset } from "../lib/useDataset";
import { Loading } from "../components/Loading";
import { StatusBadge } from "../components/StatusBadge";
import FlywheelCounter from "../components/FlywheelCounter";
import clsx from "clsx";
import { useLocale, type TranslationKey } from "../lib/i18n";

const ARCHITECTURE_LAYER_LABELS: Record<string, { name: TranslationKey; note: TranslationKey }> = {
  "数据层": { name: "status.layerData", note: "status.layerDataNote" },
  "匹配层": { name: "status.layerMatching", note: "status.layerMatchingNote" },
  "裂变层": { name: "status.layerFission", note: "status.layerFissionNote" },
  "复盘层": { name: "status.layerFeedback", note: "status.layerFeedbackNote" },
};

export default function SystemStatusPage() {
  const { t, locale } = useLocale();
  const { data, loading } = useDataset();
  if (loading || !data) return <Loading />;

  const { meta } = data;

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-[32px] font-bold text-ink-100 mb-1">{t("status.title")}</h1>
        <p className="text-sm text-ink-400">
          {t("status.fetchedAt", { time: new Date(meta.fetched_at).toLocaleString(locale === "en" ? "en-US" : "zh-CN") })}
        </p>
        <div className="mt-2">
          <FlywheelCounter channelCount={meta.channel_count} />
        </div>
      </div>

      <section>
        <h2 className="text-xl font-medium text-ink-100 mb-3">{t("status.architectureTitle")}</h2>
        <div className="grid grid-cols-1 gap-3">
          {meta.architecture_layers.map((layer) => {
            const labels = ARCHITECTURE_LAYER_LABELS[layer.layer];
            return (
              <div
                key={layer.layer}
                className="border border-white/10 rounded-xl p-4 bg-white/[0.02] flex items-start gap-4 transition-colors duration-300 hover:border-accent/25"
              >
                <div className="w-20 shrink-0 text-sm font-medium text-ink-100 pt-0.5">
                  {labels ? t(labels.name) : layer.layer}
                </div>
                <div className="flex-1">
                  <StatusBadge status={layer.status} />
                  <p className="text-xs text-ink-400 mt-2 leading-relaxed">{labels ? t(labels.note) : layer.note}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-medium text-ink-100 mb-3">{t("status.dataSourcesTitle")}</h2>
        <div className="flex flex-wrap gap-2">
          {meta.data_sources.map((ds) => (
            <span
              key={ds.platform}
              className={clsx(
                "px-3 py-1.5 rounded-full text-xs border transition-transform duration-200 hover:scale-105",
                ds.status === "connected"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-gray-500/15 text-ink-400 border-gray-500/30",
              )}
            >
              {ds.platform} · {ds.status === "connected" ? t("status.connected") : t("status.pending")}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-medium text-ink-100 mb-3">{t("status.coverageTitle")}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label={t("status.metricChannels")} value={meta.channel_count.toLocaleString()} />
          <MetricCard label={t("status.metricVideos")} value={meta.video_count.toLocaleString()} />
          <MetricCard
            label={t("status.metricVisionCoverage")}
            value={`${meta.vision_coverage.analyzed ?? 0} / ${meta.vision_coverage.total}`}
            sub={t("status.visionCoverageNote")}
          />
          <MetricCard
            label={t("status.metricDecisionCoverage")}
            value={`${meta.decision_coverage.generated ?? 0} / ${meta.decision_coverage.total}`}
          />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-medium text-ink-100 mb-3">{t("status.quotaTitle")}</h2>
        <div className="grid grid-cols-5 gap-3">
          <MetricCard label="search.list" value={meta.quota_used.search.toLocaleString()} />
          <MetricCard label="channels.list" value={meta.quota_used.channels.toLocaleString()} />
          <MetricCard label="playlistItems.list" value={meta.quota_used.playlistItems.toLocaleString()} />
          <MetricCard label="videos.list" value={meta.quota_used.videos.toLocaleString()} />
          <MetricCard label={t("status.quotaTotal")} value={meta.quota_used.total.toLocaleString()} highlight />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-medium text-ink-100 mb-3">{t("status.ageBiasTitle")}</h2>
        <div
          className={clsx(
            "border rounded-xl p-4 text-sm",
            meta.age_bias_validation.pass
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-red-500/30 bg-red-500/5",
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={meta.age_bias_validation.pass ? "text-emerald-300" : "text-red-300"}>
              {meta.age_bias_validation.pass ? t("status.ageBiasPass") : t("status.ageBiasFail")}
            </span>
            <span className="text-ink-400 text-xs">
              {t("status.ageBiasSlope", { slope: meta.age_bias_validation.slope.toFixed(4), threshold: meta.age_bias_validation.threshold })}
            </span>
          </div>
          <p className="text-xs text-ink-400">
            {t("status.ageBiasNote")}
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-medium text-ink-100 mb-3">{t("status.modelTitle")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <MetricCard
            label={t("status.modelPotential")}
            value={meta.model_status.potential_score_model === "dual_head_gbdt" ? t("status.modelPotentialGbdt") : t("status.modelPotentialHeuristic")}
            sub={t("status.modelTrainSamples", { n: meta.model_status.gbdt_sample_count })}
          />
          <MetricCard label={t("status.modelVision")} value="GLM-4.6V-Flash" sub={t("status.modelVisionSub")} />
          <MetricCard label={t("status.modelTemporal")} value={t("status.modelTemporalValue")} sub={t("status.modelTemporalSub")} />
        </div>
      </section>

      <footer className="pt-6 border-t border-white/10 text-center">
        <span className="glimmer-text text-sm font-medium">{t("status.footer")}</span>
      </footer>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="border border-white/10 rounded-xl p-3 bg-white/[0.02] transition-all duration-300 hover:border-accent/25 hover:-translate-y-0.5">
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className={clsx("text-lg font-semibold mt-0.5", highlight ? "text-accent" : "text-ink-100")}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-ink-600 mt-1">{sub}</div>}
    </div>
  );
}
