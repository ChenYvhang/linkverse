// Watchlist + outreach outcomes, persisted locally.
//
// This is the feedback layer's data. Right now it only survives a reload, but
// it is the shape the model would eventually learn from: which creators a brand
// actually pursued, and what came of it. The pipeline's potential score is
// trained on "did this channel accelerate" — historical, observable, and
// nothing to do with whether contacting them was a good idea. Only outcomes
// recorded here can answer that.
//
// Deliberately local for now, and labelled that way in the UI. A shared,
// multi-user store needs accounts and a backend; claiming to "capture results"
// while writing to one browser would be the kind of overstatement this project
// avoids elsewhere.

export const OUTCOME_STAGES = [
  { id: "tracked", label: "Tracked", hint: "On the watchlist, not contacted yet" },
  { id: "contacted", label: "Contacted", hint: "Outreach sent" },
  { id: "replied", label: "Replied", hint: "They responded" },
  { id: "signed", label: "Signed", hint: "Deal agreed" },
  { id: "declined", label: "Declined", hint: "They passed, or we did" },
] as const;

export type OutcomeStage = (typeof OUTCOME_STAGES)[number]["id"];

export type TrackedEntry = {
  stage: OutcomeStage;
  note: string;
  /** ISO date, so a stale watchlist is visible as stale rather than silently old. */
  updatedAt: string;
};

export type TrackedMap = Record<string, TrackedEntry>;

const KEY = (categoryId: string) => `linkverse.tracked.${categoryId}`;

function isStage(v: unknown): v is OutcomeStage {
  return OUTCOME_STAGES.some((s) => s.id === v);
}

export function loadTracked(categoryId: string): TrackedMap {
  try {
    const raw = localStorage.getItem(KEY(categoryId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    // Drop anything malformed rather than letting a bad entry break the view.
    const out: TrackedMap = {};
    for (const [id, e] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = e as Partial<TrackedEntry>;
      if (!isStage(entry?.stage)) continue;
      out[id] = {
        stage: entry.stage,
        note: typeof entry.note === "string" ? entry.note : "",
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveTracked(categoryId: string, map: TrackedMap) {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(KEY(categoryId));
    else localStorage.setItem(KEY(categoryId), JSON.stringify(map));
  } catch {
    /* storage unavailable — tracking simply won't survive a reload */
  }
}

export function setStage(map: TrackedMap, id: string, stage: OutcomeStage): TrackedMap {
  return { ...map, [id]: { ...(map[id] ?? { note: "" }), stage, updatedAt: new Date().toISOString() } };
}

export function setNote(map: TrackedMap, id: string, note: string): TrackedMap {
  const existing = map[id] ?? { stage: "tracked" as OutcomeStage, note: "", updatedAt: "" };
  return { ...map, [id]: { ...existing, note, updatedAt: new Date().toISOString() } };
}

export function untrack(map: TrackedMap, id: string): TrackedMap {
  const next = { ...map };
  delete next[id];
  return next;
}

/** Counts per stage, for the summary strip. */
export function stageCounts(map: TrackedMap): Record<OutcomeStage, number> {
  const counts = Object.fromEntries(OUTCOME_STAGES.map((s) => [s.id, 0])) as Record<OutcomeStage, number>;
  for (const e of Object.values(map)) counts[e.stage] = (counts[e.stage] ?? 0) + 1;
  return counts;
}

/** Reply and signature rates over everyone actually contacted. Returns null
 *  below a floor, because a rate over three creators is noise dressed up as a
 *  metric — the same reason the backtest marks thin tiers rather than
 *  reporting them. */
export const MIN_FOR_RATES = 5;

export function outcomeRates(map: TrackedMap): { contacted: number; replyRate: number; signRate: number } | null {
  const entries = Object.values(map);
  const contacted = entries.filter((e) => e.stage !== "tracked").length;
  if (contacted < MIN_FOR_RATES) return null;
  const replied = entries.filter((e) => e.stage === "replied" || e.stage === "signed").length;
  const signed = entries.filter((e) => e.stage === "signed").length;
  return {
    contacted,
    replyRate: Math.round((replied / contacted) * 100),
    signRate: Math.round((signed / contacted) * 100),
  };
}
