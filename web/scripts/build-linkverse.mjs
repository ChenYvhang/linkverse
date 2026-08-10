// Regenerates web/public/linkverse.json — a trimmed, English-only subset of
// data/dataset.json (the pipeline's full Stage6 output) — for the LinkVerse
// frontend (web/src/linkverse/). Only creators with a generated `decision`
// are included, since P/R/C/reason/product/price all come from that object.
//
// The input lives outside web/ on purpose: it is 60MB+ and nothing fetches it
// at runtime, so keeping it out of web/public/ keeps it out of the deploy
// bundle. Only the trimmed output below is a shipped asset.
//
// Run with: npm run build:data (from web/)

import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Which product category to trim. Each has its own dataset, because each
// scores creators in its own semantic space (see pipeline/config/categories.yaml).
const DEFAULT_CATEGORY = "action_camera";
const category = parseCategoryArg(process.argv.slice(2)) ?? DEFAULT_CATEGORY;

const DATASET_PATH = path.join(__dirname, `../../data/${category}/dataset.json`);
// The default category is what the app loads on first paint, so it keeps the
// top-level filename; the rest live under linkverse/. This mirrors dataPath in
// web/src/linkverse/categories.ts — the two must agree or the fetch 404s.
const OUTPUT_PATH =
  category === DEFAULT_CATEGORY
    ? path.join(__dirname, "../public/linkverse.json")
    : path.join(__dirname, `../public/linkverse/${category}.json`);

function parseCategoryArg(argv) {
  const i = argv.indexOf("--category");
  if (i !== -1) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith("--category="));
  return inline ? inline.slice("--category=".length) : null;
}

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
  // dataset.backtest is null until score.py has actually run for this
  // category — true today for supplement (collected + featured, not yet
  // scored). Guarded rather than assumed, so building a not-yet-scored
  // category's trimmed dataset reports honest zeros instead of crashing.
  const global = dataset.backtest?.tiers?.find((t) => t.tier === "global");
  const k = dataset.backtest?.primary_k ?? 0;
  const pk = global?.per_k?.[String(k)];
  const analyzedCount = dataset.creators.filter((c) => c.decision !== null).length;
  return {
    name: "LinkVerse",
    channel_count: dataset.creators.length,
    analyzed_count: analyzedCount,
    finding: pk
      ? {
          k,
          model_pct: Math.round(pk.model_hit_rate * 100),
          baseline_pct: Math.round(pk.baseline_hit_rate * 100),
          lift: round1(pk.lift),
        }
      : { k, model_pct: 0, baseline_pct: 0, lift: 0 },
    products: Object.fromEntries(dataset.products.map((p) => [p.id, p.name])),
    // Axis definitions for this category, in content_vector order. Sent to
    // /api/diagnose so the model can place a visitor's product on the same
    // axes the creators were scored on.
    dimensions: (dataset.dimensions ?? [])
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => ({ key: d.key, name: d.name, description: d.description })),
    // Per-subscriber-tier results at the primary K, including the ones that
    // make the model look bad (the 1K-10K tier's lift is below 1, i.e. worse
    // than ranking by follower count). The headline number alone is an
    // unverifiable claim; the UI puts these behind a collapsed panel so the
    // evidence is one click away without cluttering the main view.
    backtest: dataset.backtest && {
      k,
      tiers: dataset.backtest.tiers.map((t) => ({
        tier: t.tier,
        candidates: t.n_candidates,
        positives: t.n_positive,
        insufficient: t.insufficient_sample,
        baseline_pct: Math.round(t.per_k[String(k)].baseline_hit_rate * 100),
        model_pct: Math.round(t.per_k[String(k)].model_hit_rate * 100),
        lift: round1(t.per_k[String(k)].lift),
      })),
      excluded_below_1k: dataset.backtest.excluded_below_1k_count ?? null,
      method: dataset.potential_model?.method ?? null,
      brier: dataset.potential_model?.calibration?.brier_score ?? null,
    },
    livePotential: buildLivePotential(dataset.momentum),
  };
}

// "Live Potential": real subscriber growth between the two most recent
// collection snapshots (pipeline/common/momentum.py), distinct from the
// static P score. `available: false` (with a reason) until a category has
// been collected twice with a real gap between runs — sunscreen and
// supplement are both in that state today, with exactly one snapshot each.
function buildLivePotential(momentum) {
  if (!momentum || !momentum.available) {
    return { available: false, reason: momentum?.reason ?? "no_data", snapshotCount: momentum?.snapshot_count ?? 0 };
  }
  return {
    available: true,
    fromDate: momentum.fetched_at_old.slice(0, 10),
    toDate: momentum.fetched_at_new.slice(0, 10),
    elapsedDays: round1(momentum.elapsed_days),
    scoredCount: momentum.scored_count,
    movers: momentum.movers.map((m) => ({
      id: m.channel_id,
      title: m.title,
      thumb: m.thumbnail_url ?? null,
      url: m.channel_url,
      subsBefore: m.subs_before,
      subsAfter: m.subs_after,
      growthPctPerDay: round2(m.sub_delta_pct_per_day),
      newVideos: m.new_videos ?? 0,
      // Whether this channel exists in `creators` below (has a decision card)
      // and can be clicked into a kit. A mover can legitimately be "not yet
      // analyzed" — that's the point of catching movers early — and the UI
      // needs to render that honestly rather than link into a kit that
      // doesn't exist.
      hasDecision: m.has_decision,
    })),
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
    // The raw semantic vector, needed to re-score resonance against a product
    // the pipeline never saw (the onboarding chat lets a visitor describe their
    // own product). 8 floats per creator is a rounding error on file size.
    contentVector: vision.content_vector ?? null,
    // English only — never fall back to the raw Chinese sport_types. An empty
    // array reads as "not analyzed yet" in the UI, which is honest; Chinese
    // text in an English UI is not.
    sportTypes: vision.sport_types_en ?? [],
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

function buildCreator(c, productsById, competitorLabels = {}) {
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
    // English only. The old fallback chain ended at c.vertical, the internal
    // Chinese seed tag, which is why 47 creators rendered as 滑雪 etc: their
    // vision pass returned an empty sport_types, so both translated and raw
    // sport types were empty and the chain fell through. vertical_en is the
    // config-provided English label; if even that is missing we show nothing
    // rather than leaking Chinese into the UI.
    sport: c.vision?.sport_types_en?.[0] ?? c.vertical_en ?? null,
    // Clean, low-cardinality facet for filtering. `sport` above is free-text
    // LLM output — 124 distinct values on this dataset, with inconsistent
    // casing and compound entries — so it reads well on a card but is useless
    // as a filter. The vertical is a fixed vocabulary from the category config.
    vertical: c.vertical_en ?? null,
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
      // Normalised to brand names: cards written before decide.py mapped these
      // hold the raw matcher, which is lowercase and sometimes Chinese.
      keywords: (rr.flagged_keywords ?? []).map((k) => competitorLabels[k] ?? competitorLabels[String(k).toLowerCase()] ?? k),
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
  // dataset.json is gitignored (60MB+), so a fresh clone never has it. Say so
  // outright instead of letting a bare ENOENT stack trace imply the script is
  // broken — the file is regenerated by the pipeline, not by npm.
  if (!existsSync(DATASET_PATH)) {
    console.error(
      `${DATASET_PATH} not found.\n\n` +
        `It is the pipeline's Stage6 output for the "${category}" category and is\n` +
        `gitignored, so a fresh clone will not have it. Regenerate it with:\n\n` +
        `    python -m pipeline.build --category ${category}\n\n` +
        `(that step reads pipeline/artifacts/ and pipeline/cache/, which are also\n` +
        `gitignored — see README "Local development" if those are missing too).`,
    );
    process.exit(1);
  }

  console.log(`Reading ${DATASET_PATH} (category: ${category}) ...`);
  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  const productsById = new Map(dataset.products.map((p) => [p.id, p.name]));

  const analyzed = dataset.creators.filter((c) => c.decision !== null);
  const creators = analyzed.map((c) => buildCreator(c, productsById, dataset.competitor_labels ?? {}));

  const output = { meta: buildMeta(dataset), creators };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  const bytes = statSync(OUTPUT_PATH).size;
  console.log(
    `Wrote ${OUTPUT_PATH}: ${creators.length} creators, ${(bytes / 1024 / 1024).toFixed(2)} MB`,
  );
}

main();
