import type { Dataset } from "./useData";

const fmtSubs = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;

const UNAVAILABLE_REASON: Record<string, string> = {
  only_one_snapshot:
    "This category has been collected once. Live Potential compares two collection runs — check back after the next one.",
  snapshots_too_close:
    "The two most recent collection runs were too close together to measure real growth over.",
  no_data: "No collection data yet.",
};

/**
 * Real subscriber growth between the two most recent collection snapshots —
 * not the P score. P is trained once, offline, on historical acceleration
 * across the whole dataset; this is "who moved since we last looked," and it
 * can surface a channel before the rest of the pipeline (vision, decision,
 * outreach kit) has caught up to it — which is exactly the case a static
 * ranking can't catch.
 */
export default function LivePotential({ data, onSelect }: { data: Dataset; onSelect: (id: string) => void }) {
  const lp = data.meta.livePotential;

  return (
    <section className="max-w-6xl mx-auto px-6 pt-10">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="font-display font-bold text-ink text-xl">Live Potential</h2>
        <span className="px-1.5 py-0.5 rounded-full bg-success/10 text-success text-[10px] font-semibold uppercase tracking-wide">
          Beta
        </span>
      </div>

      {!lp.available ? (
        <p className="text-sm text-muted max-w-2xl">
          {UNAVAILABLE_REASON[lp.reason] ?? UNAVAILABLE_REASON.no_data}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted max-w-2xl mb-4">
            Real subscriber growth, not the static Potential score below — measured over{" "}
            <span className="num text-ink">{lp.scoredCount}</span> channels seen in both the{" "}
            <span className="num text-ink">{lp.fromDate}</span> and <span className="num text-ink">{lp.toDate}</span>{" "}
            collection runs (<span className="num text-ink">{lp.elapsedDays}</span> days apart). Ranked by
            %/day so a small channel's real move isn't buried under a huge channel's rounding noise —
            see{" "}
            <a
              href="https://github.com/ChenYvhang/linkverse/blob/main/pipeline/common/momentum.py"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              momentum.py
            </a>{" "}
            for why.
          </p>

          <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6 snap-x">
            {lp.movers.map((m) => {
              const clickable = m.hasDecision;
              return (
                <button
                  key={m.id}
                  onClick={() => clickable && onSelect(m.id)}
                  disabled={!clickable}
                  className={`shrink-0 w-44 snap-start text-left rounded-xl border border-line p-2.5 transition-colors ${
                    clickable ? "hover:border-accent bg-surface cursor-pointer" : "bg-paper/60 cursor-default"
                  }`}
                >
                  {m.thumb ? (
                    <img src={m.thumb} alt="" className="w-full h-20 rounded-lg object-cover border border-line mb-2" />
                  ) : (
                    <div className="w-full h-20 rounded-lg bg-paper border border-line mb-2" />
                  )}
                  <p className="text-xs font-medium text-ink truncate">{m.title}</p>
                  <p className="num text-[11px] text-muted mt-0.5">
                    {fmtSubs(m.subsBefore)} → {fmtSubs(m.subsAfter)}
                  </p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="num text-xs font-semibold text-success">+{m.growthPctPerDay}%/day</span>
                    {m.newVideos > 0 && (
                      <span className="num text-[10px] text-muted">+{m.newVideos} videos</span>
                    )}
                  </div>
                  {!clickable && (
                    <span className="block mt-1.5 text-[10px] text-muted">Not yet analyzed</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
