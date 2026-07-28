import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { Creator, Product } from "../lib/schema";
import { useLocale, productFeatureLabel, type TranslationKey } from "../lib/i18n";

const DIMENSION_KEYS: TranslationKey[] = [
  "dim.perspective_ratio", "dim.stabilization_demand", "dim.motion_complexity", "dim.scene_extremity",
  "dim.gear_visibility", "dim.narrative_pace", "dim.scene_diversity", "dim.slow_motion_demand",
];

const SERIES_COLORS = ["#ff8b26", "#6b7280", "#e8e8e8"];

function fmtNum(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export default function CompareModal({
  creators,
  activeProductId,
  products,
  onClose,
  onRemove,
}: {
  creators: Creator[];
  activeProductId: string | null;
  products: Product[];
  onClose: () => void;
  onRemove: (channelId: string) => void;
}) {
  const { t } = useLocale();
  const productById = new Map(products.map((p) => [p.id, p]));
  const activeProduct = activeProductId ? productById.get(activeProductId) : undefined;

  const radarData = DIMENSION_KEYS.map((key, i) => {
    const row: Record<string, string | number> = { dimension: t(key) };
    creators.forEach((c) => {
      row[c.title] = (c.vision?.content_vector?.[i] ?? 0) * 100;
    });
    return row;
  });

  const allDims = activeProductId
    ? Array.from(
        new Set(
          creators.flatMap((c) => Object.keys(c.scores.resonance?.[activeProductId]?.feature_breakdown ?? {})),
        ),
      )
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70 animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-[900px] max-h-[85vh] overflow-y-auto bg-[#090d4c] border border-white/10 rounded-xl shadow-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-medium text-ink-100">{t("compare.title", { n: creators.length })}</h2>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-100 text-xl leading-none px-2 transition-all duration-200 hover:rotate-90"
            aria-label={t("drawer.close")}
          >
            ×
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          {creators.map((c, i) => (
            <span
              key={c.channel_id}
              className="flex items-center gap-2 px-2.5 py-1 rounded-md text-xs border"
              style={{ borderColor: SERIES_COLORS[i], color: SERIES_COLORS[i] }}
            >
              {c.title}
              <button onClick={() => onRemove(c.channel_id)} className="text-[10px] opacity-70 hover:opacity-100">×</button>
            </span>
          ))}
        </div>

        <section className="mb-6">
          <h3 className="text-sm font-semibold text-ink-100 mb-2">{t("compare.radarTitle")}</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="75%">
                <PolarGrid stroke="#1f2483" />
                <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: "#8b8f9c" }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#6b7280" }} />
                <Tooltip contentStyle={{ background: "#111763", border: "1px solid #242a8a", fontSize: 12 }} />
                {creators.map((c, i) => (
                  <Radar
                    key={c.channel_id}
                    name={c.title}
                    dataKey={c.title}
                    stroke={SERIES_COLORS[i]}
                    fill={SERIES_COLORS[i]}
                    fillOpacity={0.15}
                  />
                ))}
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="mb-6">
          <h3 className="text-sm font-semibold text-ink-100 mb-2">{t("compare.scoresTitle")}</h3>
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-ink-400 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">{t("compare.colCreator")}</th>
                  <th className="text-right px-3 py-2 font-medium">{t("compare.colP")}</th>
                  <th className="text-right px-3 py-2 font-medium">
                    {t("compare.colR")}{activeProduct ? `（${activeProduct.name}）` : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {creators.map((c) => (
                  <tr key={c.channel_id} className="border-t border-white/5">
                    <td className="px-3 py-2 text-ink-100">{c.title}</td>
                    <td className="px-3 py-2 text-right text-accent tabular-nums">{fmtNum(c.scores.potential.value)}</td>
                    <td className="px-3 py-2 text-right text-ink-100 tabular-nums">
                      {activeProductId ? fmtNum(c.scores.resonance?.[activeProductId]?.value) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {activeProductId && allDims.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-ink-100 mb-2">{t("compare.breakdownTitle")}</h3>
            <div className="border border-white/10 rounded-lg overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03] text-ink-400 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">{t("compare.colDim")}</th>
                    {creators.map((c) => (
                      <th key={c.channel_id} className="text-right px-3 py-2 font-medium">{c.title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allDims.map((dim) => (
                    <tr key={dim} className="border-t border-white/5">
                      <td className="px-3 py-2 text-ink-400">{productFeatureLabel(t, dim)}</td>
                      {creators.map((c) => (
                        <td key={c.channel_id} className="px-3 py-2 text-right text-ink-100 tabular-nums">
                          {fmtNum(c.scores.resonance?.[activeProductId]?.feature_breakdown?.[dim], 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
