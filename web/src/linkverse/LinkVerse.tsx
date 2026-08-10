import { useEffect, useMemo, useState } from "react";
import { useData, type Creator, type Dataset } from "./useData";
import Scope, { isPriority } from "./Scope";
import Kit from "./Kit";
import Onboarding from "./Onboarding";
import { CATEGORIES, type CategoryDef, type CategoryId } from "./categories";
import type { ProductMatch } from "./diagnose";

const fmtSubs = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;

// The one category with real data today. Every other category's "results"
// screen borrows this dataset for its blurred preview — if a second
// category ever goes live, this single-fetch assumption needs revisiting.
const READY_CATEGORY = CATEGORIES.find((c) => c.status === "ready") ?? CATEGORIES[0];
// Resonance against an arbitrary product vector — the same cosine similarity
// pipeline/score.py uses, so a product the pipeline never saw is scored on
// exactly the axes the creators were scored on. Without this the chat could
// only ever route to a precomputed ranking.
function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Re-score and re-rank against the visitor's product.
//
// Cosine is taken on CENTERED vectors — each axis minus that axis's mean over
// the analyzed pool — so a match means "this creator is unusually strong where
// the product needs strength", not merely "both numbers are positive". Raw
// cosine over non-negative vectors is badly compressed: measured on this
// dataset, a helmet-mounted POV camera and a studio interview gimbal (products
// that should want opposite creators) shared 6 of their top 10 under raw
// cosine and 1 of 10 under centering.
//
// This deliberately differs from the precomputed R in the dataset, which
// pipeline/score.py computes with raw cosine. The two never appear together:
// a view is either ranked against the visitor's product (all centered) or
// against the pipeline's (all raw). Changing score.py to match would
// invalidate every cached decision card, which is a pipeline decision, not a
// frontend one.
function axisMeans(creators: Creator[], n: number): number[] {
  const sums = new Array(n).fill(0);
  let count = 0;
  for (const c of creators) {
    const v = c.vision?.contentVector;
    if (!v || v.length !== n) continue;
    for (let i = 0; i < n; i++) sums[i] += v[i];
    count++;
  }
  return count === 0 ? sums : sums.map((s) => s / count);
}

function rescore(creators: Creator[], match: ProductMatch): Creator[] {
  const n = match.vector.length;
  const mean = axisMeans(creators, n);
  const centre = (v: number[]) => v.map((x, i) => x - mean[i]);
  const pv = centre(match.vector);

  return creators
    .map((c) => {
      const v = c.vision?.contentVector;
      if (!v || v.length !== n) return c;
      // Centered cosine is signed (-1..1); map onto the same 0..100 scale the
      // rest of the UI reads, so a below-average fit lands under 50.
      const R = Math.round(((cosine(centre(v), pv) + 1) / 2) * 1000) / 10;
      const C = Math.round(Math.sqrt(Math.max(c.P, 0) * Math.max(R, 0)) * 10) / 10;
      return { ...c, R, C, product: match.product };
    })
    .sort((a, b) => b.C - a.C);
}

const EMPTY_POOL: Set<string> = new Set();
const noop = () => {};

// Selection pool persistence. Wrapped in try/catch because localStorage throws
// rather than no-ops in private mode and under some cookie policies — a browser
// that won't store the shortlist should still render the app.
const POOL_KEY = (categoryId: string) => `linkverse.pool.${categoryId}`;

function loadPool(categoryId: string): Set<string> {
  try {
    const raw = localStorage.getItem(POOL_KEY(categoryId));
    const ids = raw ? JSON.parse(raw) : null;
    return Array.isArray(ids) ? new Set(ids.filter((v) => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function savePool(categoryId: string, ids: Set<string>) {
  try {
    if (ids.size === 0) localStorage.removeItem(POOL_KEY(categoryId));
    else localStorage.setItem(POOL_KEY(categoryId), JSON.stringify([...ids]));
  } catch {
    /* storage unavailable — the pool simply won't survive a reload */
  }
}

export default function LinkVerse() {
  const [categoryId, setCategoryId] = useState<CategoryId>(READY_CATEGORY.id);
  const category = CATEGORIES.find((c) => c.id === categoryId) ?? READY_CATEGORY;
  // A ready category loads its OWN dataset. This used to always load
  // READY_CATEGORY.dataPath, so every category's dataPath except the first
  // ready one was dead config: flipping a category to "ready" would have
  // silently kept showing the first category's creators.
  // Onboarding categories still borrow the ready dataset, because the
  // "preparing" screen renders it blurred as a teaser rather than showing
  // that category's (nonexistent) creators.
  const { data, error } = useData(
    category.status === "ready" ? category.dataPath : READY_CATEGORY.dataPath,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyPriority, setOnlyPriority] = useState(false);
  // Survives a reload. The pool is the one piece of real user work in the app —
  // losing a shortlist to an accidental refresh mid-demo is avoidable.
  // Keyed by category so switching products doesn't inherit the wrong picks.
  const [poolIds, setPoolIds] = useState<Set<string>>(() => loadPool(READY_CATEGORY.id));
  // Bumped on reset to remount <Onboarding>, clearing its chat state along
  // with the category it had routed to.
  const [onboardingKey, setOnboardingKey] = useState(0);
  // True when diagnosis couldn't confidently match any known category.
  const [unmatched, setUnmatched] = useState(false);
  // Results (ranking table or locked preview) stay hidden below the chat
  // until a diagnosis actually lands — the landing page is chat-only.
  const [revealed, setRevealed] = useState(false);
  // Non-null once the chat has placed the visitor's own product on this
  // category's axes; the ranking below is then theirs, not the demo's.
  const [match, setMatch] = useState<ProductMatch | null>(null);

  useEffect(() => {
    setSelected(null);
    setOnlyPriority(false);
    setPoolIds(loadPool(categoryId));
  }, [categoryId]);

  useEffect(() => {
    savePool(categoryId, poolIds);
  }, [categoryId, poolIds]);

  function handleDiagnosed(id: CategoryId | null, productMatch?: ProductMatch) {
    setMatch(productMatch ?? null);
    setUnmatched(id === null);
    if (id !== null) setCategoryId(id);
    setRevealed(true);
    requestAnimationFrame(() => {
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function handleReset() {
    setCategoryId(READY_CATEGORY.id);
    setUnmatched(false);
    setRevealed(false);
    setMatch(null);
    setSelected(null);
    setPoolIds(new Set());
    setOnboardingKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Everything below ranks off `creators`, which is the visitor's re-scored
  // ranking when the chat produced a product vector, and the pipeline's
  // precomputed one otherwise.
  const creators = useMemo(
    () => (data ? (match ? rescore(data.creators, match) : data.creators) : []),
    [data, match],
  );
  const shown = useMemo(
    () => (onlyPriority ? creators.filter(isPriority) : creators),
    [creators, onlyPriority],
  );
  const top = useMemo(() => creators.slice(0, 12), [creators]);
  const selectedCreator = useMemo(
    () => creators.find((c) => c.id === selected) ?? null,
    [creators, selected],
  );

  const togglePool = (id: string) =>
    setPoolIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const poolCreators = useMemo(
    () => creators.filter((c) => poolIds.has(c.id)),
    [creators, poolIds],
  );
  const poolBudget = useMemo(() => {
    const priced = poolCreators.filter((c) => c.price.min !== null && c.price.max !== null);
    return {
      min: priced.reduce((s, c) => s + (c.price.min ?? 0), 0),
      max: priced.reduce((s, c) => s + (c.price.max ?? 0), 0),
      unpriced: poolCreators.length - priced.length,
    };
  }, [poolCreators]);
  const poolMarkets = useMemo(() => {
    const counts = new Map<string, number>();
    poolCreators.forEach((c) => counts.set(c.market, (counts.get(c.market) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [poolCreators]);

  return (
    <div className="min-h-screen">
      {/* top bar */}
      <header className="border-b border-line bg-surface/80 backdrop-blur sticky top-0 z-20">
        <div className="h-[3px] bg-gradient-to-r from-accent via-accent-2 to-accent/20" />
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-4">
          <button
            onClick={handleReset}
            className="text-gradient font-display font-extrabold tracking-tight text-lg hover:opacity-80 transition-opacity"
          >
            LinkVerse
          </button>
          <span className="hidden sm:inline text-xs text-muted border-l border-line pl-4">
            Find breakout creators before they blow up
          </span>
          {data && (
            <span className="num ml-auto text-xs text-muted">
              {data.meta.analyzed_count} analyzed · {data.meta.channel_count.toLocaleString()} tracked
            </span>
          )}
        </div>
      </header>

      {/* Landing: eyebrow + headline + chat — the whole first screen, always
          shown. Nothing else renders until a diagnosis actually lands. */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-10 text-center animate-rise">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold mb-5">
          Your product in. The right creators out.
        </div>
        <h1 className="font-display font-extrabold text-ink leading-[1.05] text-[clamp(2rem,5vw,3.4rem)]">
          The fastest way to find <span className="text-gradient">creators who fit your brand</span>.
        </h1>
        <p className="mt-4 text-lg text-ink/70 max-w-2xl mx-auto">
          Paste your company and product. LinkVerse matches it against thousands of creators — for audience fit,
          local reach, and breakout potential — so you reach out to the right ten, not the loudest thousand.
        </p>
      </section>

      <Onboarding key={onboardingKey} onDiagnosed={handleDiagnosed} dimensions={data?.meta.dimensions} />

      {revealed && (
        <div id="results" className="animate-reveal">
          {error ? (
            <div className="px-6 py-20 text-center">
              <p className="text-muted">
                Couldn't load the dataset ({error}). Run <code className="num">npm run build</code> so{" "}
                <code className="num">linkverse.json</code> is served from <code className="num">public/</code>.
              </p>
            </div>
          ) : !data ? (
            <div className="px-6 py-20 text-center text-muted">Loading…</div>
          ) : unmatched ? (
            <LockedPreview mockData={data} variant="paywall" onBack={handleReset} />
          ) : category.status === "onboarding" ? (
            <LockedPreview mockData={data} variant="preparing" category={category} onBack={handleReset} />
          ) : (
            <ReadyResults
              data={data}
              selected={selected}
              setSelected={setSelected}
              onlyPriority={onlyPriority}
              setOnlyPriority={setOnlyPriority}
              poolIds={poolIds}
              shown={shown}
              top={top}
              togglePool={togglePool}
            />
          )}
        </div>
      )}

      {/* Rendered outside #results on purpose: that wrapper's reveal
          animation leaves a lingering (identity) transform on itself, which
          would otherwise become the containing block for these fixed-
          position overlays and anchor them to the stats section instead of
          the real viewport. */}
      {revealed && !error && data && !unmatched && category.status !== "onboarding" && (
        <>
          {poolIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-surface
              border border-line rounded-full pl-5 pr-3 py-2.5 shadow-[0_0_0_1px_rgba(31,53,224,0.08),0_12px_32px_-12px_rgba(31,53,224,0.35)] animate-slide">
              <span className="text-sm text-ink">
                <span className="num font-semibold">{poolIds.size}</span> selected
              </span>
              <span className="w-px h-4 bg-line" />
              <span className="num text-sm text-ink">
                {poolBudget.min || poolBudget.max
                  ? `$${poolBudget.min.toLocaleString()}–$${poolBudget.max.toLocaleString()}`
                  : "no budget data"}
              </span>
              {poolBudget.unpriced > 0 && (
                <span className="text-xs text-muted">(+{poolBudget.unpriced} unpriced)</span>
              )}
              {poolMarkets.length > 0 && (
                <span className="hidden md:inline text-xs text-muted">
                  {poolMarkets.map(([m, n]) => `${m.replace(/_/g, " ")} ${n}`).join(" · ")}
                </span>
              )}
              <button onClick={() => setPoolIds(new Set())} aria-label="Clear selection"
                className="text-muted hover:text-ink text-lg leading-none px-1">×</button>
            </div>
          )}

          {selectedCreator && <Kit creator={selectedCreator} onClose={() => setSelected(null)} />}
        </>
      )}
    </div>
  );
}

// Proof section (stats + evidence + action note) — only ever shown once a
// real diagnosis lands on the ready category, so the hit-rate numbers are
// never presented next to a category they don't back. The floating pool bar
// and Kit drawer render as top-level siblings in LinkVerse instead of here —
// see the comment at their call site for why.
function ReadyResults({
  data,
  selected,
  setSelected,
  onlyPriority,
  setOnlyPriority,
  poolIds,
  shown,
  top,
  togglePool,
}: {
  data: Dataset;
  selected: string | null;
  setSelected: (id: string | null) => void;
  onlyPriority: boolean;
  setOnlyPriority: (v: boolean) => void;
  poolIds: Set<string>;
  shown: Creator[];
  top: Creator[];
  togglePool: (id: string) => void;
}) {
  const f = data.meta.finding;
  const [statsOpen, setStatsOpen] = useState(false);

  return (
    <>
      {/* 1 · PROOF */}
      <section className="max-w-6xl mx-auto px-6 pt-4 pb-14">
        <button
          onClick={() => setStatsOpen((o) => !o)}
          aria-expanded={statsOpen}
          className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted font-semibold hover:text-ink transition-colors"
        >
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-line text-xs leading-none shrink-0">
            {statsOpen ? "−" : "+"}
          </span>
          Measured on held-out data — {f.lift}× better than follower-count ranking ({f.model_pct}% vs{" "}
          {f.baseline_pct}%).
        </button>
        {statsOpen && (
          <>
            <div className="mt-3 flex flex-wrap items-end gap-x-10 gap-y-4">
              <Stat big value={`${f.model_pct}%`} label="LinkVerse hit rate" accent />
              <Stat big value={`${f.baseline_pct}%`} label="Follower-count baseline" />
              <Stat big value={`${f.lift}×`} label="Improvement" accent />
            </div>

            <div className="mt-10 grid sm:grid-cols-3 gap-6 max-w-3xl">
              <Benefit title="Skip the manual search" body="Days of scrolling channels, down to one ranked list." />
              <Benefit title="Localized for your market" body="Creators who already have reach where you're launching." />
              <Benefit
                title="Sign them before they're expensive"
                body="Potential score flags who's about to break out, not who already has."
              />
            </div>

            <p className="mt-8 text-sm text-muted max-w-2xl leading-relaxed">
              LinkVerse scores {data.meta.channel_count.toLocaleString()} creators on two axes —{" "}
              <span className="text-ink font-medium">Potential</span> (are they about to break out?) and{" "}
              <span className="text-ink font-medium">Resonance</span> (do they fit your product?) — then hands you a
              ready outreach kit for each one.
            </p>

            {/* Coverage, stated up front. Ranking only what has been analyzed is
                fine; letting a viewer assume the list covers every collected
                channel is not. */}
            <p className="mt-3 text-xs text-muted max-w-2xl">
              {data.meta.analyzed_count.toLocaleString()} of{" "}
              {data.meta.channel_count.toLocaleString()} collected channels have been through vision
              analysis and scoring — the rest are collected but not yet analyzed, and are not ranked
              here.
            </p>

            {data.meta.backtest && <Methodology backtest={data.meta.backtest} />}
          </>
        )}
      </section>

      {/* 2 · EVIDENCE (scope + top picks) */}
      <section id="evidence" className="border-t border-line bg-surface">
        <EvidenceSection
          shown={shown}
          top={top}
          selected={selected}
          onSelect={setSelected}
          poolIds={poolIds}
          togglePool={togglePool}
          onlyPriority={onlyPriority}
          setOnlyPriority={setOnlyPriority}
        />
      </section>

      {/* 3 · ACTION note */}
      <section className="max-w-6xl mx-auto px-6 py-12 text-center">
        <h2 className="font-display font-bold text-ink text-xl">Then take the next step</h2>
        <p className="text-sm text-muted mt-2 max-w-xl mx-auto">
          Every creator opens an outreach kit — why they fit, which product to pitch, a budget band, and a
          ready-to-send script. Pick one from the list above to see it.
        </p>
      </section>
    </>
  );
}

// Scope chart + top-picks list — shared by the real (interactive) ranking
// page and the blurred locked/preparing preview below, so the two always
// look identical apart from the blur.
function EvidenceSection({
  shown,
  top,
  selected,
  onSelect,
  poolIds,
  togglePool,
  onlyPriority,
  setOnlyPriority,
}: {
  shown: Creator[];
  top: Creator[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  poolIds: Set<string>;
  togglePool: (id: string) => void;
  onlyPriority: boolean;
  setOnlyPriority: (v: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? shown.filter(
            (c) =>
              c.title.toLowerCase().includes(q) ||
              (c.sport ?? "").toLowerCase().includes(q) ||
              c.market.replace(/_/g, " ").toLowerCase().includes(q),
          )
        : shown,
    [shown, q],
  );
  // Collapsed to the top 12 by default so the page still reads as a shortlist;
  // searching or expanding reaches the rest.
  const rows = q || showAll ? matches : top;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 grid lg:grid-cols-[1.15fr_1fr] gap-10 items-start">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-ink text-xl">The evidence</h2>
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
            <input type="checkbox" checked={onlyPriority} onChange={(e) => setOnlyPriority(e.target.checked)} />
            Priority only
          </label>
        </div>
        <p className="text-sm text-muted mb-4 max-w-lg">
          Each dot is a creator. Up = higher potential, right = better product fit.{" "}
          <span className="text-accent font-medium">Blue</span> dots in the top-right are the ones to sign first;
          a white ring means a full script is ready. Click any dot for its kit.
        </p>
        <div className="rounded-xl border border-line p-2 shadow-[0_0_0_1px_rgba(31,53,224,0.05),0_16px_40px_-20px_rgba(31,53,224,0.25)]">
          <Scope creators={shown} selected={selected} onSelect={onSelect} />
        </div>
        {/* The dot encoding was explained in prose above only; a reader who
            skims the paragraph had no way to decode the ring or the size. */}
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 text-[11px] text-muted">
          <li className="flex items-center gap-1.5">
            <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5"
              fill="var(--color-accent)" opacity="0.9" /></svg>
            Priority (P and R both ≥ 60)
          </li>
          <li className="flex items-center gap-1.5">
            <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="3.5"
              fill="#aab0ba" opacity="0.55" /></svg>
            Other creators
          </li>
          <li className="flex items-center gap-1.5">
            <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5"
              fill="var(--color-accent)" opacity="0.9" stroke="var(--color-surface)" strokeWidth="1.5" /></svg>
            Full script ready
          </li>
        </ul>
      </div>

      {/* top picks list */}
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-display font-bold text-ink text-xl">Top picks</h2>
          <span className="num text-xs text-muted">
            {rows.length} of {shown.length}
          </span>
        </div>
        {/* Without this, only the first 12 creators were reachable outside the
            chart — everyone else could be found by hovering dots and no other
            way. */}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search creators…"
          aria-label="Search creators by name or category"
          className="w-full mb-3 px-3 py-2 text-sm rounded-lg border border-line bg-surface text-ink placeholder:text-muted focus:outline-none focus:border-accent"
        />
        <ol className="divide-y divide-line border border-line rounded-xl overflow-hidden">
          {rows.map((c, i) => (
            <li key={c.id}
              className={`flex items-center gap-2 pl-3 pr-1 hover:bg-paper transition-colors ${
                selected === c.id ? "bg-accent/[0.06]" : ""
              }`}>
              <input type="checkbox" checked={poolIds.has(c.id)} onChange={() => togglePool(c.id)}
                aria-label={`Add ${c.title} to selection`}
                className="shrink-0 accent-[var(--color-accent)]" />
              <button onClick={() => onSelect(c.id)}
                className="flex-1 min-w-0 flex items-center gap-3 py-2.5 text-left">
                <span className="num text-xs text-muted w-5 shrink-0">{i + 1}</span>
                {c.thumb ? (
                  <img src={c.thumb} alt="" className="w-9 h-9 rounded object-cover border border-line shrink-0" />
                ) : (
                  <span className="w-9 h-9 rounded bg-paper border border-line shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink truncate">{c.title}</span>
                  <span className="block text-xs text-muted truncate">
                    {fmtSubs(c.subs)} · {c.sport}
                  </span>
                </span>
                <span className="num text-sm font-semibold text-accent shrink-0">{c.C}</span>
              </button>
            </li>
          ))}
        </ol>
        {rows.length === 0 && (
          <p className="text-sm text-muted text-center py-6 border border-line border-t-0 rounded-b-xl">
            No creator matches “{query}”.
          </p>
        )}
        <div className="flex items-center justify-between gap-3 mt-2">
          <p className="text-[11px] text-muted">Ranked by combined score (Potential × Resonance).</p>
          {!query && shown.length > top.length && (
            <button onClick={() => setShowAll((v) => !v)}
              className="text-[11px] font-medium text-accent hover:underline shrink-0">
              {showAll ? "Show top 12" : `Show all ${shown.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Shown for onboarding-status categories ("preparing") and for a diagnosis
// that didn't match any known category ("paywall") — same blurred ranking
// layout underneath in both cases, only the overlay message/CTA differs.
function LockedPreview({
  mockData,
  variant,
  category,
  onBack,
}: {
  mockData: Dataset;
  variant: "preparing" | "paywall";
  category?: CategoryDef;
  onBack: () => void;
}) {
  const top = mockData.creators.slice(0, 12);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="text-center mb-8">
        <div className="text-[11px] uppercase tracking-[0.18em] text-accent font-semibold mb-2">
          {category ? category.label : "Unsupported category"}
        </div>
        <h1 className="font-display font-bold text-ink text-2xl">
          {variant === "preparing" ? "This category's rankings are on the way" : "This category isn't unlocked yet"}
        </h1>
      </div>

      <div className="relative rounded-xl overflow-hidden">
        <div className="pointer-events-none select-none blur-lg" aria-hidden="true">
          <EvidenceSection
            shown={mockData.creators}
            top={top}
            selected={null}
            onSelect={noop}
            poolIds={EMPTY_POOL}
            togglePool={noop}
            onlyPriority={false}
            setOnlyPriority={noop}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-6 bg-paper/30">
          {variant === "preparing" ? (
            <PreparingBadge label={category?.label ?? "This category"} />
          ) : (
            <PaywallOverlay />
          )}
        </div>
      </div>

      <div className="text-center mt-10">
        <button onClick={onBack} className="text-sm font-medium text-accent hover:underline">
          ← Back to start
        </button>
      </div>
    </div>
  );
}

function PreparingBadge({ label }: { label: string }) {
  return (
    <div className="bg-surface border border-line rounded-2xl shadow-xl px-8 py-6 text-center max-w-sm">
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">Coming soon</div>
      <p className="font-display font-bold text-ink text-lg">This category's data is still being prepared</p>
      <p className="text-sm text-muted mt-1.5">
        Real {label.toLowerCase()} rankings will appear here once they're ready.
      </p>
    </div>
  );
}

// "Unlock" plays out a fake ~2s payment step, then honestly discloses it's
// a demo — no card fields, no payment SDK, no network call. Pure UI
// simulation to show a revenue model exists, nothing more.
type UnlockPhase = "idle" | "processing" | "done";
const UNLOCK_SIMULATION_MS = 2000;

function PaywallOverlay() {
  const [phase, setPhase] = useState<UnlockPhase>("idle");

  useEffect(() => {
    if (phase !== "processing") return;
    const timer = setTimeout(() => setPhase("done"), UNLOCK_SIMULATION_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <div className="bg-surface border border-accent/30 rounded-2xl shadow-xl px-8 py-6 text-center max-w-sm">
      <div className="text-[10px] uppercase tracking-wider text-accent font-semibold mb-2">Pro plan</div>
      <p className="font-display font-bold text-ink text-lg">This category unlocks on the Pro plan</p>
      <p className="text-sm text-muted mt-1.5 mb-4">
        Get full creator rankings for categories outside the demo set.
      </p>

      {phase === "idle" && (
        <button
          onClick={() => setPhase("processing")}
          className="text-sm font-semibold text-white bg-accent rounded-lg px-5 py-2 hover:opacity-90 transition-opacity"
        >
          Unlock
        </button>
      )}
      {phase === "processing" && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted">
          <Spinner />
          Processing payment…
        </div>
      )}
      {phase === "done" && (
        <p className="text-xs text-muted leading-relaxed">
          This is demo mode — real payment integration ships in the release version.
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-4 h-4 rounded-full border-2 border-accent/25 border-t-accent animate-spin"
      aria-hidden="true"
    />
  );
}

function Stat({ value, label, accent, big }: { value: string; label: string; accent?: boolean; big?: boolean }) {
  return (
    <div>
      <div className={`num font-semibold ${big ? "text-4xl sm:text-5xl" : "text-2xl"} ${accent ? "text-gradient" : "text-ink"}`}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-muted mt-1">{label}</div>
    </div>
  );
}

function Benefit({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="font-display font-bold text-ink text-sm">{title}</div>
      <p className="text-sm text-muted mt-1 leading-relaxed">{body}</p>
    </div>
  );
}

// Tiered backtest, collapsed by default. The headline lift is one number on
// held-out data; this is where it breaks down by subscriber tier — including
// the tiers where the model loses to the follower-count baseline. Hidden by
// default because most viewers want the answer, not the statistics; one click
// away because a claim nobody can inspect is just marketing.
function Methodology({ backtest }: { backtest: NonNullable<Dataset["meta"]["backtest"]> }) {
  const [open, setOpen] = useState(false);
  const tiers = backtest.tiers.filter((t) => t.tier !== "global");

  return (
    <div className="mt-6 max-w-2xl">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted font-semibold hover:text-ink transition-colors"
      >
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-line text-xs leading-none shrink-0">
          {open ? "−" : "+"}
        </span>
        How this was measured
      </button>

      {open && (
        <div className="mt-3 rounded-xl border border-line bg-paper/60 p-4">
          <p className="text-xs text-muted leading-relaxed mb-3">
            Top-{backtest.k} hit rate against a follower-count baseline, on channels held out of
            training. Broken down by subscriber tier, because a single global number hides where the
            model actually helps.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted text-left border-b border-line">
                  <th className="py-1.5 pr-3 font-medium">Subscriber tier</th>
                  <th className="py-1.5 px-2 font-medium text-right">Baseline</th>
                  <th className="py-1.5 px-2 font-medium text-right">LinkVerse</th>
                  <th className="py-1.5 px-2 font-medium text-right">Lift</th>
                  <th className="py-1.5 pl-2 font-medium text-right">Sample</th>
                </tr>
              </thead>
              <tbody className="num">
                {tiers.map((t) => {
                  const worse = t.lift < 1;
                  return (
                    <tr key={t.tier} className="border-b border-line/60 last:border-0">
                      <td className="py-1.5 pr-3 text-ink">{t.tier}</td>
                      <td className="py-1.5 px-2 text-right text-muted">{t.baseline_pct}%</td>
                      <td className="py-1.5 px-2 text-right text-ink">{t.model_pct}%</td>
                      <td
                        className={`py-1.5 px-2 text-right font-semibold ${
                          worse ? "text-red-600" : "text-accent"
                        }`}
                      >
                        {t.lift}×
                      </td>
                      <td className="py-1.5 pl-2 text-right text-muted">
                        {t.candidates}
                        {t.insufficient ? " ⚠" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-muted leading-relaxed">
            Reported as measured, including the tiers below 1.0× where ranking by follower count
            beats the model. ⚠ marks a sample too small to conclude from.
            {backtest.excluded_below_1k !== null && (
              <> Channels under 1K subscribers ({backtest.excluded_below_1k}) are excluded from tier
              reporting.</>
            )}
            {backtest.brier !== null && <> Calibration Brier score {backtest.brier.toFixed(4)}.</>}
          </p>
        </div>
      )}
    </div>
  );
}
