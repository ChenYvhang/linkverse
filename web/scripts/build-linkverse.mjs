// Regenerates web/public/linkverse.json — a trimmed, English-only subset of
// web/public/dataset.json (the pipeline's full Stage6 output) — for the
// LinkVerse frontend (web/src/linkverse/). Only creators with a generated
// `decision` are included, since P/R/C/reason/product/price all come from
// that object.
//
// Run with: npm run build:data (from web/)

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = path.join(__dirname, "../public/dataset.json");
const OUTPUT_PATH = path.join(__dirname, "../public/linkverse.json");

// Fixed-vocabulary raw-Chinese pipeline outputs that don't have their own
// per-record `_en` translation (unlike reasoning/basis/evidence, which do).
// Copied verbatim from web/src/lib/i18n/dictionaries.ts.
const PACE_EN = {
  "快节奏": "Fast-paced",
  "中等节奏": "Moderate pace",
  "慢节奏": "Slow-paced",
};
const PERSPECTIVE_EN = {
  "混合": "Mixed",
  "第一人称为主": "Mostly first-person",
  "第三人称为主": "Mostly third-person",
  "第三人称为主 / 混合": "Mostly third-person / mixed",
  "第一人称为主 / 混合": "Mostly first-person / mixed",
  "第一人称与第三人称大致各半": "Roughly half first-person, half third-person",
  "第三人称为主，部分第一人称": "Mostly third-person, some first-person",
};

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

function buildMeta(dataset) {
  const global = dataset.backtest.tiers.find((t) => t.tier === "global");
  const k = dataset.backtest.primary_k;
  const pk = global.per_k[String(k)];
  const analyzedCount = dataset.creators.filter((c) => c.decision !== null).length;
  return {
    name: "LinkVerse",
    channel_count: dataset.creators.length,
    analyzed_count: analyzedCount,
    finding: {
      k,
      model_pct: Math.round(pk.model_hit_rate * 100),
      baseline_pct: Math.round(pk.baseline_hit_rate * 100),
      lift: round1(pk.lift),
    },
    products: Object.fromEntries(dataset.products.map((p) => [p.id, p.name])),
  };
}

function buildScripts(creator) {
  const scripts = (creator.scripts ?? [])
    .filter((s) => s.language === "en")
    .map((s) => ({
      platform: s.platform,
      hook: s.hook,
      beats: s.storyboard_beats,
      voiceover: s.voiceover_points,
      caption: s.caption_copy,
      cta: s.cta_placement,
    }));
  return { hasScript: scripts.length > 0, scripts };
}

function buildVision(vision) {
  if (!vision) return null;
  return {
    sportTypes: vision.sport_types_en ?? vision.sport_types ?? [],
    perspective: PERSPECTIVE_EN[vision.camera_perspective] ?? vision.camera_perspective,
    pace: PACE_EN[vision.narrative_pace] ?? vision.narrative_pace,
    stabilization: vision.stabilization_demand,
    extremity: vision.scene_extremity,
    gear: vision.gear_visibility,
    evidence: vision.evidence_en ?? vision.evidence,
  };
}

const MAX_VELOCITY_POINTS = 30;

function buildVelocity(videos) {
  return videos
    .filter((v) => v.relative_velocity !== null)
    .slice()
    .sort((a, b) => a.published_at.localeCompare(b.published_at))
    .slice(-MAX_VELOCITY_POINTS)
    .map((v) => ({
      date: v.published_at.slice(0, 10),
      relative: round2(v.relative_velocity),
      seasonAdjusted: round2(v.season_adjusted_velocity),
    }));
}

function buildCreator(c, productsById) {
  const productId = c.decision.recommended_product;
  const resonance = c.scores.resonance?.[productId];
  const rr = c.decision.risk_review;

  const { hasScript, scripts } = buildScripts(c);

  return {
    id: c.channel_id,
    title: c.title,
    url: c.channel_url,
    subs: c.subscriber_count,
    market: c.market,
    sport: c.vision?.sport_types_en?.[0] ?? c.vision?.sport_types?.[0] ?? c.vertical,
    thumb: c.thumbnails?.[0] ?? null,
    P: round1(c.decision.potential_score),
    R: round1(c.decision.resonance_score),
    C: round1(c.decision.combined_score),
    product: productsById.get(productId) ?? productId,
    reason: c.decision.reasoning_en ?? c.decision.reasoning,
    price: {
      min: c.decision.price_range.min,
      max: c.decision.price_range.max,
      basis: c.decision.price_range.basis_en ?? c.decision.price_range.basis,
    },
    hasScript,
    scripts,
    risk: {
      flagged: rr.competitor_flag,
      keywords: rr.flagged_keywords,
      conclusion: rr.conclusion_en ?? rr.conclusion,
    },
    contributions: (resonance?.contributions ?? []).map((x) => ({
      dim: x.dim,
      value: round2(x.contribution),
    })),
    vision: buildVision(c.vision),
    velocity: buildVelocity(c.videos ?? []),
    thumbnails: (c.thumbnails ?? []).slice(0, 5),
  };
}

function main() {
  console.log(`Reading ${DATASET_PATH} ...`);
  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  const productsById = new Map(dataset.products.map((p) => [p.id, p.name]));

  const analyzed = dataset.creators.filter((c) => c.decision !== null);
  const creators = analyzed.map((c) => buildCreator(c, productsById));

  const output = { meta: buildMeta(dataset), creators };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  const bytes = statSync(OUTPUT_PATH).size;
  console.log(
    `Wrote ${OUTPUT_PATH}: ${creators.length} creators, ${(bytes / 1024 / 1024).toFixed(2)} MB`,
  );
}

main();
