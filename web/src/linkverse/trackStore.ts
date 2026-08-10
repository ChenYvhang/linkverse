// Watchlist + outreach outcomes.
//
// This is the feedback layer's data. It is the shape the model would
// eventually learn from: which creators a brand actually pursued, and what
// came of it. The pipeline's potential score is trained on "did this channel
// accelerate" — historical, observable, and nothing to do with whether
// contacting them was a good idea. Only outcomes recorded here can answer
// that.
//
// Two backends, same TrackedMap shape either way:
//   - Signed out, or Supabase not configured: localStorage only. Survives a
//     reload, not a change of device.
//   - Signed in: Supabase, scoped by Row Level Security (supabase/schema.sql)
//     so one account can never read or write another's rows. localStorage is
//     still written as an offline cache, not as the source of truth.
//
// useTrackedSync below is what a component actually calls; the functions in
// this file are its building blocks (and are what Track.tsx's pure local
// tests would exercise, if this project had any yet).
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

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

// --- Supabase-backed storage -------------------------------------------

type TrackedRow = { creator_id: string; stage: OutcomeStage; note: string; updated_at: string };

// No user_id filter on select/delete below: Row Level Security already scopes
// every query to auth.uid(), so a client-side filter would be redundant at
// best and misleading at worst — it would read as "this is what keeps rows
// isolated" when the database is what actually does that.
async function fetchCloudTracked(categoryId: string): Promise<TrackedMap> {
  if (!supabase) return {};
  const { data, error } = await supabase
    .from("tracked_creators")
    .select("creator_id, stage, note, updated_at")
    .eq("category", categoryId);
  if (error) {
    console.error("tracked_creators fetch failed:", error.message);
    return {};
  }
  const out: TrackedMap = {};
  for (const row of (data ?? []) as TrackedRow[]) {
    out[row.creator_id] = { stage: row.stage, note: row.note, updatedAt: row.updated_at };
  }
  return out;
}

async function upsertCloudEntry(userId: string, categoryId: string, creatorId: string, entry: TrackedEntry) {
  if (!supabase) return;
  const { error } = await supabase.from("tracked_creators").upsert({
    user_id: userId,
    category: categoryId,
    creator_id: creatorId,
    stage: entry.stage,
    note: entry.note,
    // updated_at is deliberately omitted: a database trigger sets it, so a
    // stale client clock can never misreport when a row actually changed.
  });
  if (error) console.error("tracked_creators upsert failed:", error.message);
}

async function deleteCloudEntry(categoryId: string, creatorId: string) {
  if (!supabase) return;
  const { error } = await supabase
    .from("tracked_creators")
    .delete()
    .eq("category", categoryId)
    .eq("creator_id", creatorId);
  if (error) console.error("tracked_creators delete failed:", error.message);
}

function diffEntries(prev: TrackedMap, next: TrackedMap): { changed: [string, TrackedEntry][]; removed: string[] } {
  const changed: [string, TrackedEntry][] = [];
  for (const [id, entry] of Object.entries(next)) {
    if (prev[id] !== entry) changed.push([id, entry]);
  }
  const removed = Object.keys(prev).filter((id) => !(id in next));
  return { changed, removed };
}

/**
 * Owns tracked-creators state for one category, backed by Supabase when
 * signed in and localStorage otherwise. Call once per category in view.
 *
 * On sign-in, any entries that exist only locally (tracked before an account
 * existed, or added in another anonymous session) are uploaded once rather
 * than discarded — losing a shortlist the moment someone creates an account
 * would defeat the point of adding one. For ids present in both, the cloud
 * version wins, on the assumption that a returning, already-signed-in user's
 * synced history is more likely to be current than local state on a device
 * that has not talked to the cloud yet.
 */
export function useTrackedSync(categoryId: string, userId: string | null) {
  const [tracked, setTrackedState] = useState<TrackedMap>(() => loadTracked(categoryId));
  const [syncing, setSyncing] = useState(false);
  // Previous userId, to detect the sign-in transition (not just re-renders).
  const prevUserId = useRef<string | null>(null);
  const prevTracked = useRef<TrackedMap>(tracked);

  const commit = useCallback(
    (next: TrackedMap) => {
      const prev = prevTracked.current;
      prevTracked.current = next;
      setTrackedState(next);
      saveTracked(categoryId, next); // offline cache either way
      if (!userId) return;
      const { changed, removed } = diffEntries(prev, next);
      for (const [id, entry] of changed) void upsertCloudEntry(userId, categoryId, id, entry);
      for (const id of removed) void deleteCloudEntry(categoryId, id);
    },
    [categoryId, userId],
  );

  // Category switch: reload from scratch (local immediately, cloud below).
  useEffect(() => {
    const local = loadTracked(categoryId);
    prevTracked.current = local;
    setTrackedState(local);
  }, [categoryId]);

  // Load from, or merge into, the cloud whenever we have both a user and a
  // category to load for.
  useEffect(() => {
    if (!userId || !supabase) {
      prevUserId.current = userId;
      return;
    }
    let cancelled = false;
    setSyncing(true);
    const justSignedIn = prevUserId.current === null;
    prevUserId.current = userId;

    (async () => {
      const cloud = await fetchCloudTracked(categoryId);
      if (cancelled) return;

      if (justSignedIn) {
        const local = loadTracked(categoryId);
        const localOnly = Object.entries(local).filter(([id]) => !(id in cloud));
        for (const [id, entry] of localOnly) await upsertCloudEntry(userId, categoryId, id, entry);
        const merged = { ...cloud, ...Object.fromEntries(localOnly) };
        if (!cancelled) {
          prevTracked.current = merged;
          setTrackedState(merged);
          saveTracked(categoryId, merged);
        }
      } else {
        prevTracked.current = cloud;
        setTrackedState(cloud);
        saveTracked(categoryId, cloud);
      }
      if (!cancelled) setSyncing(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, categoryId]);

  return { tracked, setTracked: commit, syncing };
}
