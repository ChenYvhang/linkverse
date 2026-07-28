import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Bar,
  BarChart,
} from "recharts";
import clsx from "clsx";
import type { Creator, Product } from "../lib/schema";
import { addToCandidatePool, removeFromCandidatePool } from "../lib/candidatePool";
import { useCandidatePool } from "../lib/useCandidatePool";
import { getOutcome, saveOutcome } from "../lib/outcomeStore";
import {
  useLocale,
  verticalLabel,
  perspectiveLabel,
  paceLabel,
  productFeatureLabel,
  localizedText,
  localizedList,
  type TranslationKey,
} from "../lib/i18n";

interface Props {
  creator: Creator;
  products: Product[];
  onClose: () => void;
}

function fmtNum(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/10 pt-4 mt-4 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-ink-100 mb-2">{title}</h3>
      {children}
    </section>
  );
}

export default function CreatorDrawer({ creator, products, onClose }: Props) {
  const { t, locale } = useLocale();
  const velocitySeries = useMemo(
    () =>
      creator.videos
        .filter((v) => v.relative_velocity !== null)
        .slice()
        .sort((a, b) => a.published_at.localeCompare(b.published_at))
        .map((v) => ({
          date: v.published_at.slice(0, 10),
          relative_velocity: v.relative_velocity,
          season_adjusted_velocity: v.season_adjusted_velocity,
        })),
    [creator],
  );

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const { ids: poolIds } = useCandidatePool();
  const inPool = poolIds.includes(creator.channel_id);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-[720px] h-full bg-[#090d4c] border-l border-white/10 overflow-y-auto shadow-2xl animate-slide-in-right">
        <div className="sticky top-0 bg-[#090d4c]/95 backdrop-blur border-b border-white/10 px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink-100 truncate">{creator.title}</h2>
            <a
              href={creator.channel_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent hover:underline"
            >
              {creator.channel_url}
            </a>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                inPool ? removeFromCandidatePool(creator.channel_id) : addToCandidatePool([creator.channel_id])
              }
              className={clsx(
                "text-xs px-2.5 py-1.5 rounded-md border transition-colors",
                inPool
                  ? "border-white/20 text-ink-100 hover:bg-white/5"
                  : "border-[var(--color-accent)]/40 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10",
              )}
            >
              {inPool ? t("drawer.leavePool") : t("drawer.joinPool")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-ink-400 hover:text-ink-100 text-xl leading-none px-2 transition-all duration-200 hover:rotate-90"
              aria-label={t("drawer.close")}
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          {/* Layer 1: 基础信息 */}
          <Section title={t("drawer.section1")}>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat label={t("drawer.statVertical")} value={verticalLabel(t, creator.vertical)} />
              <Stat label={t("drawer.statCountry")} value={creator.country ?? t("drawer.statCountryUnknown")} />
              <Stat label={t("drawer.statSubscribers")} value={fmtNum(creator.subscriber_count)} />
              <Stat label={t("drawer.statViews")} value={fmtNum(creator.view_count_total)} />
              <Stat label={t("drawer.statVideoCount")} value={fmtNum(creator.video_count_total)} />
              <Stat label={t("drawer.statChannelAge")} value={fmtNum(creator.channel_age_days)} />
            </div>
            {creator.thumbnails.length > 0 && (
              <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                {creator.thumbnails.slice(0, 8).map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt=""
                    className="h-16 w-28 object-cover rounded-md border border-white/10 shrink-0"
                  />
                ))}
              </div>
            )}
          </Section>

          {/* Layer 2: 动能特征 */}
          <Section title={t("drawer.section2")}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
              <Stat label={t("drawer.statMomentumAccel")} value={fmtNum(creator.features.momentum_acceleration, 3)} />
              <Stat label={t("drawer.statAdjustedMomentum")} value={fmtNum(creator.features.adjusted_momentum, 3)} />
              <Stat label={t("drawer.statInflection")} value={creator.features.inflection_point?.slice(0, 10) ?? t("drawer.statInflectionNone")} />
              <Stat label={t("drawer.statCadence90d")} value={fmtNum(creator.features.publish_cadence_90d)} />
              <Stat label={t("drawer.statLikeRatio")} value={fmtNum(creator.features.engagement_like_ratio * 100, 2) + "%"} />
              <Stat label={t("drawer.statCommentRatio")} value={fmtNum(creator.features.engagement_comment_ratio * 100, 3) + "%"} />
            </div>
            {velocitySeries.length > 1 && (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={velocitySeries} margin={{ left: -20, top: 4, right: 8 }}>
                    <CartesianGrid stroke="#1f2483" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#8b8f9c" }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 10, fill: "#8b8f9c" }} width={36} />
                    <Tooltip
                      contentStyle={{ background: "#111763", border: "1px solid #242a8a", fontSize: 12 }}
                      labelStyle={{ color: "#e5e7eb" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="relative_velocity"
                      stroke="#ff8b26"
                      dot={false}
                      strokeWidth={2}
                      name={t("drawer.velocityRelative")}
                    />
                    <Line
                      type="monotone"
                      dataKey="season_adjusted_velocity"
                      stroke="#6b7280"
                      dot={false}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      name={t("drawer.velocitySeasonAdjusted")}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>

          {/* Layer 3: 视觉理解 */}
          <Section title={t("drawer.section3")}>
            {creator.vision ? (
              (() => {
                const sportTypes = localizedList(locale, creator.vision.sport_types, creator.vision.sport_types_en);
                const evidence = localizedText(locale, creator.vision.evidence, creator.vision.evidence_en);
                const pending = sportTypes.pending || evidence.pending;
                return (
                  <div className="space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <Stat label={t("drawer.visionSportTypes")} value={sportTypes.items.join(locale === "en" ? ", " : "、") || "—"} />
                      <Stat label={t("drawer.visionPerspective")} value={perspectiveLabel(t, creator.vision.camera_perspective)} />
                      <Stat label={t("drawer.visionPace")} value={paceLabel(t, creator.vision.narrative_pace)} />
                      <Stat label={t("drawer.visionStabilization")} value={fmtNum(creator.vision.stabilization_demand, 2)} />
                      <Stat label={t("drawer.visionExtremity")} value={fmtNum(creator.vision.scene_extremity, 2)} />
                      <Stat label={t("drawer.visionGear")} value={fmtNum(creator.vision.gear_visibility, 2)} />
                    </div>
                    {pending && <p className="text-ink-600 text-xs">{t("drawer.contentPendingTranslation")}</p>}
                    <p className="text-ink-400 text-xs leading-relaxed bg-white/5 rounded-md p-3 mt-2">
                      {evidence.text}
                    </p>
                  </div>
                );
              })()
            ) : (
              <p className="text-ink-400 text-sm">{t("drawer.visionNotAnalyzed")}</p>
            )}
          </Section>

          {/* Layer 4: 匹配分 */}
          <Section title={t("drawer.section4")}>
            <div className="mb-4">
              <div className="text-xs text-ink-400 mb-1">
                {t("drawer.potentialP")}
                {creator.scores.potential.value_lo !== undefined && creator.scores.potential.value_hi !== undefined && (
                  <span> · {t("drawer.conformalRange")} [{fmtNum(creator.scores.potential.value_lo, 1)}, {fmtNum(creator.scores.potential.value_hi, 1)}]</span>
                )}
              </div>
              <div className="text-2xl font-semibold text-accent mb-1.5">{fmtNum(creator.scores.potential.value, 1)}</div>
              {creator.scores.potential.value_lo !== undefined && creator.scores.potential.value_hi !== undefined && (
                <ConfidenceRange
                  value={creator.scores.potential.value}
                  lo={creator.scores.potential.value_lo}
                  hi={creator.scores.potential.value_hi}
                />
              )}
            </div>
            {creator.scores.resonance ? (
              <div className="space-y-4">
                {Object.entries(creator.scores.resonance).map(([productId, r]) => {
                  const product = productById.get(productId);
                  const breakdown = Object.entries(r.feature_breakdown).map(([name, value]) => ({
                    name: productFeatureLabel(t, name),
                    value,
                  }));
                  const contributions = r.contributions.map((c) => ({
                    name: t(`dim.${c.dim}` as TranslationKey),
                    value: c.contribution,
                  }));
                  return (
                    <div key={productId} className="border border-white/10 rounded-lg p-3 transition-colors duration-300 hover:border-white/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-ink-100">{product?.name ?? productId}</span>
                        <span className="text-sm text-ink-100 font-semibold">R = {fmtNum(r.value, 1)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] text-ink-400 mb-1">{t("drawer.featureBreakdown")}</div>
                          <div className="h-28">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={breakdown} layout="vertical" margin={{ left: 0, right: 8 }}>
                                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#8b8f9c" }} />
                                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: "#8b8f9c" }} />
                                <Tooltip contentStyle={{ background: "#111763", border: "1px solid #242a8a", fontSize: 12 }} />
                                <Bar dataKey="value" fill="#ff8b26" radius={[0, 4, 4, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-ink-400 mb-1">{t("drawer.cosineContributions")}</div>
                          <div className="h-28">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={contributions} layout="vertical" margin={{ left: 0, right: 8 }}>
                                <XAxis type="number" tick={{ fontSize: 10, fill: "#8b8f9c" }} />
                                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: "#8b8f9c" }} />
                                <Tooltip contentStyle={{ background: "#111763", border: "1px solid #242a8a", fontSize: 12 }} />
                                <Bar dataKey="value" fill="#6b7280" radius={[0, 4, 4, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-ink-400 text-sm">{t("drawer.resonanceNotReady")}</p>
            )}
          </Section>

          {/* Layer 5: 决策卡 */}
          <Section title={t("drawer.section5")}>
            {creator.decision ? (() => {
              const reasoning = localizedText(locale, creator.decision.reasoning, creator.decision.reasoning_en);
              const priceBasis = localizedText(locale, creator.decision.price_range.basis, creator.decision.price_range.basis_en);
              const localizationNotes = localizedText(locale, creator.decision.localization_notes, creator.decision.localization_notes_en);
              const riskConclusion = localizedText(locale, creator.decision.risk_review.conclusion, creator.decision.risk_review.conclusion_en);
              const pending = reasoning.pending || priceBasis.pending || localizationNotes.pending || riskConclusion.pending;
              return (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-3 items-center">
                  <span className="px-2 py-1 rounded-md bg-accent/15 text-accent text-xs">
                    {t("drawer.recommendedProduct")}{productById.get(creator.decision.recommended_product)?.name ?? creator.decision.recommended_product}
                  </span>
                  <span className="text-xs text-ink-400">
                    {t("drawer.combinedScore", { v: fmtNum(creator.decision.combined_score, 2) })}
                  </span>
                  {creator.decision.risk_review.competitor_flag && (
                    <span className="px-2 py-1 rounded-md bg-red-500/15 text-red-300 text-xs">
                      {t("drawer.competitorRisk")}{creator.decision.risk_review.flagged_keywords.join(", ")}
                    </span>
                  )}
                </div>
                {pending && <p className="text-ink-600 text-xs">{t("drawer.contentPendingTranslation")}</p>}
                <p className="text-ink-100 leading-relaxed">{reasoning.text}</p>
                <div className="text-xs text-ink-400">
                  {t("drawer.priceRange")}
                  {creator.decision.price_range.min !== null
                    ? ` $${creator.decision.price_range.min} - $${creator.decision.price_range.max}`
                    : ` ${t("drawer.priceUnavailable")}`}
                  {priceBasis.text && ` · ${priceBasis.text}`}
                </div>
                <div className="text-xs text-ink-400">{localizationNotes.text}</div>
                {creator.decision.risk_review.competitor_flag && (
                  <p className="text-xs text-red-300/80">{riskConclusion.text}</p>
                )}
              </div>
              );
            })() : (
              <p className="text-ink-400 text-sm">{t("drawer.decisionNotGenerated")}</p>
            )}
          </Section>

          {/* Layer 6: 裂变 tab */}
          <Section title={t("drawer.section6")}>
            <ScriptsPanel creator={creator} />
          </Section>

          {/* Layer 7: 回流层 */}
          <Section title={t("drawer.section7")}>
            <OutcomeForm creator={creator} products={products} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={clsx("flex flex-col")}>
      <span className="text-[11px] text-ink-400">{label}</span>
      <span className="text-ink-100">{value}</span>
    </div>
  );
}

function ConfidenceRange({ value, lo, hi }: { value: number; lo: number; hi: number }) {
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  return (
    <div className="relative h-1.5 rounded-full bg-white/5 max-w-[240px]">
      <div
        className="absolute h-full rounded-full bg-accent/25"
        style={{ left: `${clamp(lo)}%`, width: `${clamp(hi) - clamp(lo)}%` }}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-accent"
        style={{ left: `${clamp(value)}%` }}
      />
    </div>
  );
}

function ScriptsPanel({ creator }: { creator: Creator }) {
  const { t, locale } = useLocale();
  const scripts = creator.scripts;
  const [platform, setPlatform] = useState<"tiktok_vertical" | "youtube_horizontal">("tiktok_vertical");
  const [language, setLanguage] = useState<"zh" | "en">(locale === "en" ? "en" : "zh");
  const [copied, setCopied] = useState(false);

  const platformLabel = (p: "tiktok_vertical" | "youtube_horizontal") =>
    p === "tiktok_vertical" ? t("drawer.platformTiktok") : t("drawer.platformYoutube");
  const languageLabel = (l: "zh" | "en") => (l === "zh" ? t("drawer.languageZh") : t("drawer.languageEn"));

  if (scripts && scripts.length > 0) {
    const active = scripts.find((s) => s.platform === platform && s.language === language) ?? null;

    const asText = (s: NonNullable<typeof active>) =>
      `【${platformLabel(s.platform)} · ${languageLabel(s.language)}】\n\n` +
      `${t("drawer.scriptHook")}：${s.hook}\n\n` +
      `${t("drawer.scriptStoryboard")}：\n${s.storyboard_beats.map((b) => `- ${b}`).join("\n")}\n\n` +
      `${t("drawer.scriptVoiceover")}：\n${s.voiceover_points.map((b) => `- ${b}`).join("\n")}\n\n` +
      `${t("drawer.scriptCaption")}：${s.caption_copy}\n\n` +
      `${t("drawer.scriptCta")}：${s.cta_placement}`;

    return (
      <div className="space-y-3 text-sm">
        <span className="inline-block px-2 py-0.5 rounded text-[11px] bg-accent/15 text-accent">{t("drawer.scriptsFull")}</span>
        <div className="flex flex-wrap gap-3">
          <div className="flex gap-1 bg-white/5 rounded-md p-0.5">
            {(["tiktok_vertical", "youtube_horizontal"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={clsx(
                  "px-2.5 py-1 rounded text-xs transition-colors",
                  platform === p ? "bg-accent/20 text-accent" : "text-ink-400 hover:text-ink-100",
                )}
              >
                {platformLabel(p)}
              </button>
            ))}
          </div>
          <div className="flex gap-1 bg-white/5 rounded-md p-0.5">
            {(["zh", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                className={clsx(
                  "px-2.5 py-1 rounded text-xs transition-colors",
                  language === l ? "bg-accent/20 text-accent" : "text-ink-400 hover:text-ink-100",
                )}
              >
                {languageLabel(l)}
              </button>
            ))}
          </div>
        </div>

        {active ? (
          <div className="border border-white/10 rounded-lg p-3 space-y-2">
            <div>
              <div className="text-[11px] text-ink-400 mb-0.5">{t("drawer.scriptHook")}</div>
              <p className="text-ink-100">{active.hook}</p>
            </div>
            <div>
              <div className="text-[11px] text-ink-400 mb-0.5">{t("drawer.scriptStoryboard")}</div>
              <ul className="list-disc list-inside text-xs text-ink-400 space-y-0.5">
                {active.storyboard_beats.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
            <div>
              <div className="text-[11px] text-ink-400 mb-0.5">{t("drawer.scriptVoiceover")}</div>
              <ul className="list-disc list-inside text-xs text-ink-400 space-y-0.5">
                {active.voiceover_points.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
            <div>
              <div className="text-[11px] text-ink-400 mb-0.5">{t("drawer.scriptCaption")}</div>
              <p className="text-xs text-ink-400">{active.caption_copy}</p>
            </div>
            <div>
              <div className="text-[11px] text-ink-400 mb-0.5">{t("drawer.scriptCta")}</div>
              <p className="text-xs text-ink-400">{active.cta_placement}</p>
            </div>
            <div className="bg-white/5 rounded-md p-2 text-[11px] text-ink-600">
              {t("drawer.scriptEvidence")}
              {locale === "en" ? `"${active.referenced_evidence.video_title}"` : `《${active.referenced_evidence.video_title}》`} ·
              "{active.referenced_evidence.vision_evidence_quote}" · {productFeatureLabel(t, active.referenced_evidence.top_feature_breakdown_dim)}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(asText(active));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="px-2.5 py-1 rounded-md border border-white/15 text-xs text-ink-100 hover:bg-white/5 transition-colors"
              >
                {copied ? t("drawer.copied") : t("drawer.copy")}
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([asText(active)], { type: "text/plain;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${creator.title}_${active.platform}_${active.language}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-2.5 py-1 rounded-md border border-white/15 text-xs text-ink-100 hover:bg-white/5 transition-colors"
              >
                {t("drawer.export")}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-ink-400 text-sm">{t("drawer.scriptsMissingCombo")}</p>
        )}
      </div>
    );
  }

  if (creator.decision && creator.decision.creative_variants.length > 0) {
    const allVariants = creator.decision.creative_variants;
    const localized = allVariants.filter((v) => (v.language ?? "zh") === locale);
    // localized is what's actually in the target language; when it's empty in
    // EN mode, translate_variants.py hasn't covered this channel yet — fall
    // back to the real Chinese content instead of hiding it, with a note.
    const pendingTranslation = locale === "en" && localized.length === 0;
    const shown = localized.length > 0 ? localized : allVariants.filter((v) => (v.language ?? "zh") === "zh");
    return (
      <div className="space-y-2 text-sm">
        <span className="inline-block px-2 py-0.5 rounded text-[11px] bg-white/5 text-ink-400 mb-1">
          {t("drawer.scriptsLight")}
        </span>
        {pendingTranslation && (
          <p className="text-ink-600 text-xs">{t("drawer.scriptsLightPendingTranslation")}</p>
        )}
        {shown.map((variant) => (
          <div key={variant.variant_name} className="border border-white/10 rounded-lg p-3 transition-colors duration-300 hover:border-accent/30">
            <div className="font-medium text-ink-100 text-sm mb-1">{variant.variant_name}</div>
            <p className="text-ink-400 text-xs leading-relaxed mb-2">{variant.script_direction}</p>
            <ul className="list-disc list-inside text-xs text-ink-400 space-y-0.5 mb-2">
              {variant.subtitle_highlights.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
            <div className="flex gap-3 text-[11px] text-ink-400">
              <span>{variant.target_platform_note}</span>
              <span>{t("drawer.targetMarket")}{variant.target_market}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <p className="text-ink-400 text-sm">{t("drawer.scriptsNone")}</p>;
}

function OutcomeForm({ creator, products }: { creator: Creator; products: Product[] }) {
  const { t, locale } = useLocale();
  const defaultProductId = creator.decision?.recommended_product ?? products[0]?.id ?? "";
  const [productId, setProductId] = useState(defaultProductId);
  const existing = getOutcome(creator.channel_id, productId);

  const [actualViews, setActualViews] = useState(existing?.actualViews?.toString() ?? "");
  const [engagementRate, setEngagementRate] = useState(existing?.engagementRate?.toString() ?? "");
  const [ignited, setIgnited] = useState(existing?.ignited ?? false);
  const [note, setNote] = useState(existing?.note ?? "");
  const [savedAt, setSavedAt] = useState(existing?.updatedAt ?? null);

  function handleProductChange(next: string) {
    setProductId(next);
    const o = getOutcome(creator.channel_id, next);
    setActualViews(o?.actualViews?.toString() ?? "");
    setEngagementRate(o?.engagementRate?.toString() ?? "");
    setIgnited(o?.ignited ?? false);
    setNote(o?.note ?? "");
    setSavedAt(o?.updatedAt ?? null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveOutcome(creator.channel_id, productId, {
      actualViews: Number(actualViews) || 0,
      engagementRate: Number(engagementRate) || 0,
      ignited,
      note,
    });
    setSavedAt(new Date().toISOString());
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-sm">
      {products.length > 1 && (
        <div>
          <label className="text-[11px] text-ink-400 block mb-1">{t("outcome.productLabel")}</label>
          <select
            value={productId}
            onChange={(e) => handleProductChange(e.target.value)}
            className="bg-[#090d4c] border border-white/15 rounded-md text-sm px-2.5 py-1.5 text-ink-100"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-ink-400 block mb-1">{t("outcome.actualViews")}</label>
          <input
            type="number"
            min={0}
            value={actualViews}
            onChange={(e) => setActualViews(e.target.value)}
            className="w-full bg-[#090d4c] border border-white/15 rounded-md text-sm px-2.5 py-1.5 text-ink-100 tabular-nums"
          />
        </div>
        <div>
          <label className="text-[11px] text-ink-400 block mb-1">{t("outcome.engagementRate")}</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={engagementRate}
            onChange={(e) => setEngagementRate(e.target.value)}
            className="w-full bg-[#090d4c] border border-white/15 rounded-md text-sm px-2.5 py-1.5 text-ink-100 tabular-nums"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-ink-100 cursor-pointer">
        <input
          type="checkbox"
          checked={ignited}
          onChange={(e) => setIgnited(e.target.checked)}
          className="accent-[var(--color-accent)]"
        />
        {t("outcome.ignited")}
      </label>
      <div>
        <label className="text-[11px] text-ink-400 block mb-1">{t("outcome.note")}</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full bg-[#090d4c] border border-white/15 rounded-md text-sm px-2.5 py-1.5 text-ink-100 resize-none"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="px-3 py-1.5 rounded-md bg-accent/15 text-accent text-xs border border-accent/40 hover:bg-accent/25 transition-colors"
        >
          {t("outcome.save")}
        </button>
        {savedAt && (
          <span className="text-[11px] text-ink-600">{t("outcome.saved", { time: new Date(savedAt).toLocaleString(locale === "en" ? "en-US" : "zh-CN") })}</span>
        )}
      </div>
    </form>
  );
}
