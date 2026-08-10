import { useMemo, useState } from "react";
import type { Creator } from "./useData";
import {
  MIN_FOR_RATES,
  OUTCOME_STAGES,
  outcomeRates,
  setNote,
  setStage,
  stageCounts,
  untrack,
  type OutcomeStage,
  type TrackedMap,
} from "./trackStore";

const fmtSubs = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;

const STAGE_STYLE: Record<OutcomeStage, string> = {
  tracked: "bg-surface text-ink border-line",
  contacted: "bg-accent/10 text-accent border-accent/30",
  replied: "bg-accent text-white border-accent",
  signed: "bg-emerald-600 text-white border-emerald-600",
  declined: "bg-paper text-muted border-line",
};

/**
 * The feedback layer, as a screen of its own.
 *
 * The pipeline's potential score is trained on whether a channel accelerated —
 * observable history that says nothing about whether contacting them was a good
 * idea. Only outcomes recorded here can answer that, which is why this is not a
 * side panel: it is the one place the product learns something the pipeline
 * cannot compute.
 */
export default function Track({
  creators,
  tracked,
  setTracked,
  onSelect,
}: {
  creators: Creator[];
  tracked: TrackedMap;
  setTracked: (m: TrackedMap) => void;
  onSelect: (id: string) => void;
}) {
  const [stageFilter, setStageFilter] = useState<OutcomeStage | "all">("all");

  const rows = useMemo(() => {
    const byId = new Map(creators.map((c) => [c.id, c]));
    return Object.entries(tracked)
      .map(([id, entry]) => ({ id, entry, creator: byId.get(id) ?? null }))
      .filter((r) => stageFilter === "all" || r.entry.stage === stageFilter)
      .sort((a, b) => (b.entry.updatedAt ?? "").localeCompare(a.entry.updatedAt ?? ""));
  }, [creators, tracked, stageFilter]);

  const counts = useMemo(() => stageCounts(tracked), [tracked]);
  const rates = useMemo(() => outcomeRates(tracked), [tracked]);
  const total = Object.keys(tracked).length;

  return (
    <section id="tracking" className="max-w-6xl mx-auto px-6 py-14 border-t border-line">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h2 className="font-display font-bold text-ink text-xl">Your pipeline</h2>
        <span className="num text-xs text-muted">{total} tracked</span>
      </div>
      <p className="text-sm text-muted max-w-2xl mb-5 leading-relaxed">
        What happened after you reached out. The potential score is trained on whether a channel
        grew — it cannot know whether contacting them was worth it. This is the only place that
        answer can come from.
      </p>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
          <p className="text-sm text-muted">
            Nothing tracked yet. Open a creator and use <span className="text-ink font-medium">Track</span>{" "}
            to start a pipeline.
          </p>
        </div>
      ) : (
        <>
          {/* stage filter + measured rates */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <StageChip on={stageFilter === "all"} onClick={() => setStageFilter("all")}>
              All <span className="num opacity-60">{total}</span>
            </StageChip>
            {OUTCOME_STAGES.map((s) => (
              <StageChip
                key={s.id}
                on={stageFilter === s.id}
                onClick={() => setStageFilter(s.id)}
                title={s.hint}
              >
                {s.label} <span className="num opacity-60">{counts[s.id]}</span>
              </StageChip>
            ))}
          </div>

          <div className="rounded-xl border border-line bg-paper/50 px-4 py-3 mb-5 text-xs">
            {rates ? (
              <span className="text-ink">
                <span className="num font-semibold">{rates.replyRate}%</span> replied and{" "}
                <span className="num font-semibold">{rates.signRate}%</span> signed, over{" "}
                <span className="num">{rates.contacted}</span> creators contacted.
              </span>
            ) : (
              <span className="text-muted">
                Reply and signature rates appear once {MIN_FOR_RATES} creators have been contacted — a
                rate over fewer than that is noise, not a measurement.
              </span>
            )}
          </div>

          <ul className="space-y-2">
            {rows.map(({ id, entry, creator }) => (
              <li key={id} className="rounded-xl border border-line p-3">
                <div className="flex items-start gap-3">
                  {creator?.thumb ? (
                    <img src={creator.thumb} alt="" className="w-10 h-10 rounded object-cover border border-line shrink-0" />
                  ) : (
                    <span className="w-10 h-10 rounded bg-paper border border-line shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <button
                        onClick={() => creator && onSelect(id)}
                        disabled={!creator}
                        className="text-sm font-medium text-ink hover:text-accent disabled:hover:text-ink truncate text-left"
                      >
                        {creator?.title ?? id}
                      </button>
                      {creator && (
                        <span className="num text-xs text-muted">
                          {fmtSubs(creator.subs)} · P {creator.P} · R {creator.R}
                        </span>
                      )}
                      {!creator && (
                        // Honest about a stale entry rather than dropping it: the
                        // creator may simply not be in the current filtered set.
                        <span className="text-[11px] text-muted">not in the current dataset</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {OUTCOME_STAGES.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setTracked(setStage(tracked, id, s.id))}
                          aria-pressed={entry.stage === s.id}
                          title={s.hint}
                          className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                            entry.stage === s.id ? STAGE_STYLE[s.id] : "bg-surface text-muted border-line hover:border-accent/40"
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                      <button
                        onClick={() => setTracked(untrack(tracked, id))}
                        className="ml-auto text-[11px] text-muted hover:text-ink"
                      >
                        Remove
                      </button>
                    </div>

                    <input
                      value={entry.note}
                      onChange={(e) => setTracked(setNote(tracked, id, e.target.value))}
                      placeholder="Note — what you sent, what they said…"
                      aria-label={`Note for ${creator?.title ?? id}`}
                      className="w-full mt-2 px-2.5 py-1.5 text-xs rounded-lg border border-line bg-surface text-ink placeholder:text-muted focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-[11px] text-muted mt-4">
        Stored in this browser only. Nothing is sent anywhere, and it will not follow you to another
        device — a shared pipeline needs accounts and a backend, which this does not have yet.
      </p>
    </section>
  );
}

function StageChip({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
        on ? "bg-accent text-white border-accent" : "bg-surface text-ink border-line hover:border-accent/50"
      }`}
    >
      {children}
    </button>
  );
}
