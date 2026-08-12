import { useEffect, useState } from "react";
import { containsHan, englishDimension, englishName, englishOr } from "./english";

export type Script = {
  platform: string;
  hook: string;
  beats: string[];
  voiceover: string[];
  caption: string;
  cta: string;
};

export type RiskReview = {
  flagged: boolean;
  keywords: string[];
  conclusion: string;
};

export type Contribution = { dim: string; value: number };

export type Vision = {
  /** Raw semantic vector in meta.dimensions order. Present so the app can
   *  score a product the pipeline never saw (the onboarding chat). */
  contentVector: number[] | null;
  sportTypes: string[];
  perspective: string;
  pace: string;
  stabilization: number; // 0-1
  extremity: number; // 0-1
  gear: number; // 0-1
  evidence: string;
};

export type VelocityPoint = {
  date: string;
  relative: number | null;
  seasonAdjusted: number | null;
};

export type Creator = {
  id: string;
  title: string;
  url: string;
  subs: number;
  market: string;
  sport: string;
  /** Fixed-vocabulary vertical label — the filterable facet. `sport` is
   *  free-text LLM output (124 distinct values here) and unusable as one. */
  vertical: string | null;
  thumb: string | null;
  P: number; // Potential — about to break out?
  R: number; // Resonance — fits the product?
  C: number; // Combined
  product: string;
  reason: string;
  price: { min: number | null; max: number | null; basis: string };
  hasScript: boolean;
  scripts: Script[];
  risk: RiskReview;
  contributions: Contribution[];
  vision: Vision | null;
  velocity: VelocityPoint[];
  thumbnails: string[];
};

export type Dataset = {
  meta: {
    name: string;
    channel_count: number;
    analyzed_count: number;
    finding: { k: number; model_pct: number; baseline_pct: number; lift: number };
    products: Record<string, string>;
    /** The category's axes, in content_vector order. */
    dimensions: { key: string; name: string; description: string }[];
    backtest?: {
      k: number;
      tiers: {
        tier: string;
        candidates: number;
        positives: number;
        insufficient: boolean;
        baseline_pct: number;
        model_pct: number;
        lift: number;
      }[];
      excluded_below_1k: number | null;
      method: string | null;
      brier: number | null;
    };
    /** Real subscriber growth between the two most recent collection
     *  snapshots — distinct from the static P score. Unavailable until a
     *  category has been collected twice with a real gap between runs. */
    livePotential: LivePotential;
  };
  creators: Creator[];
};

function normalizeDataset(data: Dataset): Dataset {
  const livePotential = data.meta.livePotential.available
    ? {
        ...data.meta.livePotential,
        movers: data.meta.livePotential.movers.map((mover) => ({
          ...mover,
          title: englishName(mover.title, `Creator ${mover.id.slice(-6)}`),
        })),
      }
    : data.meta.livePotential;
  return {
    ...data,
    meta: {
      ...data.meta,
      dimensions: data.meta.dimensions.map((d) => englishDimension(d.key, d.name, d.description)),
      livePotential,
    },
    creators: data.creators.map((creator) => {
      const scripts = creator.scripts.filter((script) => !containsHan(JSON.stringify(script)));
      const sport = englishOr(creator.sport, "Creator");
      const title = englishName(creator.title, `Creator ${creator.id.slice(-6)}`);
      return {
        ...creator,
        title,
        sport,
        vertical: creator.vertical && !containsHan(creator.vertical) ? creator.vertical : null,
        reason: englishOr(
          creator.reason,
          `${title} creates ${sport.toLowerCase()} content that aligns with ${creator.product}. Review the source channel before outreach.`,
        ),
        price: {
          ...creator.price,
          basis: englishOr(
            creator.price.basis,
            "Heuristic estimate based on public subscriber count; not a confirmed creator quote.",
          ),
        },
        hasScript: scripts.length > 0,
        scripts,
        risk: {
          ...creator.risk,
          keywords: creator.risk.keywords.filter((keyword) => !containsHan(keyword)),
          conclusion: englishOr(
            creator.risk.conclusion,
            "No English risk summary is available. Review recent sponsorships before outreach.",
          ),
        },
        vision: creator.vision
          ? {
              ...creator.vision,
              sportTypes: creator.vision.sportTypes.filter((value) => !containsHan(value)),
              perspective: englishOr(creator.vision.perspective, "Not available"),
              pace: englishOr(creator.vision.pace, "Not available"),
              evidence: englishOr(
                creator.vision.evidence,
                "Detailed visual evidence is not yet available in English.",
              ),
            }
          : null,
      };
    }),
  };
}

export type LiveMover = {
  id: string;
  title: string;
  thumb: string | null;
  url: string;
  subsBefore: number;
  subsAfter: number;
  growthPctPerDay: number;
  newVideos: number;
  /** False means this channel hasn't been vision-analyzed / decided on yet —
   *  it's a real mover the rest of the pipeline hasn't caught up to. Render
   *  it, but don't link into a kit that doesn't exist. */
  hasDecision: boolean;
};

export type LivePotential =
  | { available: false; reason: string; snapshotCount: number }
  | {
      available: true;
      fromDate: string;
      toDate: string;
      elapsedDays: number;
      scoredCount: number;
      movers: LiveMover[];
    };

export function useData(dataPath: string) {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`${import.meta.env.BASE_URL}${dataPath}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((value: Dataset) => setData(normalizeDataset(value)))
      .catch((e) => setError(String(e)));
  }, [dataPath]);

  return { data, error };
}
