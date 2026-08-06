import { useEffect, useMemo, useState } from "react";
import { useData, type Creator, type Dataset } from "./useData";
import Scope, { isPriority } from "./Scope";
import Kit from "./Kit";
import Onboarding from "./Onboarding";
import { CATEGORIES, type CategoryDef, type CategoryId } from "./categories";

const fmtSubs = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;

// The one category with real data today. Every other category's "results"
// screen borrows this dataset for its blurred preview — if a second
// category ever goes live, this single-fetch assumption needs revisiting.
const READY_CATEGORY = CATEGORIES.find((c) => c.status === "ready") ?? CATEGORIES[0];
const EMPTY_POOL: Set<string> = new Set();
const noop = () => {};

export default function LinkVerse() {
  const [categoryId, setCategoryId] = useState<CategoryId>(READY_CATEGORY.id);
  const category = CATEGORIES.find((c) => c.id === categoryId) ?? READY_CATEGORY;
  const { data, error } = useData(READY_CATEGORY.dataPath);
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyPriority, setOnlyPriority] = useState(false);
  const [poolIds, setPoolIds] = useState<Set<string>>(new Set());
  // Bumped on reset to remount <Onboarding>, clearing its chat state along
  // with the category it had routed to.
  const [onboardingKey, setOnboardingKey] = useState(0);
  // True when diagnosis couldn't confidently match any known category.
  const [unmatched, setUnmatched] = useState(false);

  useEffect(() => {
    setSelected(null);
    setOnlyPriority(false);
    setPoolIds(new Set());
  }, [categoryId]);

  function handleDiagnosed(id: CategoryId | null) {
    if (id === null) {
      setUnmatched(true);
      return;
    }
    setUnmatched(false);
    setCategoryId(id);
    requestAnimationFrame(() => {
      document.getElementById("evidence")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  function handleReset() {
    setCategoryId(READY_CATEGORY.id);
    setUnmatched(false);
    setOnboardingKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const selectedCreator = useMemo(
    () => data?.creators.find((c) => c.id === selected) ?? null,
    [data, selected],
  );
  const shown = useMemo(
    () => (data ? (onlyPriority ? data.creators.filter(isPriority) : data.creators) : []),
    [data, onlyPriority],
  );
  const top = useMemo(() => (data ? data.creators.slice(0, 12) : []), [data]);

  const togglePool = (id: string) =>
    setPoolIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const poolCreators = useMemo(
    () => (data ? data.creators.filter((c) => poolIds.has(c.id)) : []),
    [data, poolIds],
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

      {error ? (
        <div className="min-h-screen grid place-items-center px-6 text-center">
          <p className="text-muted">
            Couldn't load the dataset ({error}). Run <code className="num">npm run build</code> so{" "}
            <code className="num">linkverse.json</code> is served from <code className="num">public/</code>.
          </p>
        </div>
      ) : !data ? (
        <div className="min-h-screen grid place-items-center text-muted">Loading…</div>
      ) : unmatched ? (
        <LockedPreview mockData={data} variant="paywall" onBack={handleReset} />
      ) : category.status === "onboarding" ? (
        <LockedPreview mockData={data} variant="preparing" category={category} onBack={handleReset} />
      ) : (
        <ReadyContent
          data={data}
          selected={selected}
          setSelected={setSelected}
          onlyPriority={onlyPriority}
          setOnlyPriority={setOnlyPriority}
          poolIds={poolIds}
          setPoolIds={setPoolIds}
          selectedCreator={selectedCreator}
          shown={shown}
          top={top}
          togglePool={togglePool}
          poolBudget={poolBudget}
          poolMarkets={poolMarkets}
          onDiagnosed={handleDiagnosed}
          onboardingKey={onboardingKey}
        />
      )}
    </div>
  );
}

function ReadyContent({
  data,
  selected,
  setSelected,
  onlyPriority,
  setOnlyPriority,
  poolIds,
  setPoolIds,
  selectedCreator,
  shown,
  top,
  togglePool,
  poolBudget,
  poolMarkets,
  onDiagnosed,
  onboardingKey,
}: {
  data: Dataset;
  selected: string | null;
  setSelected: (id: string | null) => void;
  onlyPriority: boolean;
  setOnlyPriority: (v: boolean) => void;
  poolIds: Set<string>;
  setPoolIds: (v: Set<string>) => void;
  selectedCreator: Creator | null;
  shown: Creator[];
  top: Creator[];
  togglePool: (id: string) => void;
  poolBudget: { min: number; max: number; unpriced: number };
  poolMarkets: [string, number][];
  onDiagnosed: (id: CategoryId | null) => void;
  onboardingKey: number;
}) {
  const f = data.meta.finding;

  return (
    <>
      {/* 1 · FINDING */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-14 animate-rise">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold mb-5">
          Your product in. The right creators out.
        </div>
        <h1 className="font-display font-extrabold text-ink leading-[1.05] text-[clamp(2rem,5vw,3.4rem)] max-w-3xl">
          The fastest way to find <span className="text-gradient">creators who fit your brand</span>.
        </h1>
        <p className="mt-2 text-xs text-muted">
          Demo tuned for Insta360 — full product-input matching coming next.
        </p>
        <p className="mt-4 text-lg text-ink/70 max-w-2xl">
          Paste your company and product. LinkVerse matches it against thousands of creators — for audience fit,
          local reach, and breakout potential — so you reach out to the right ten, not the loudest thousand.
        </p>

        <div className="mt-8 text-[11px] uppercase tracking-wider text-muted font-semibold">
          Measured on held-out data — {f.lift}× better than follower-count ranking ({f.model_pct}% vs{" "}
          {f.baseline_pct}%).
        </div>
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
      </section>

      <Onboarding key={onboardingKey} onDiagnosed={onDiagnosed} />

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
      </div>

      {/* top picks list */}
      <div>
        <h2 className="font-display font-bold text-ink text-xl mb-3">Top picks</h2>
        <ol className="divide-y divide-line border border-line rounded-xl overflow-hidden">
          {top.map((c, i) => (
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
        <p className="text-[11px] text-muted mt-2">Ranked by combined score (Potential × Resonance).</p>
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
