import { useState } from "react";
import type { Creator, Script } from "./useData";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const fmtSubs = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;

const platformLabel = (p: string) =>
  p === "tiktok_vertical" ? "TikTok / Shorts" : p === "youtube_horizontal" ? "YouTube" : p;

const DIM_LABELS: Record<string, string> = {
  perspective_ratio: "Perspective ratio",
  stabilization_demand: "Stabilization",
  motion_complexity: "Motion complexity",
  scene_extremity: "Scene extremity",
  gear_visibility: "Gear visibility",
  narrative_pace: "Narrative pace",
  scene_diversity: "Scene diversity",
  slow_motion_demand: "Slow-motion demand",
};
const dimLabel = (d: string) => DIM_LABELS[d] ?? d;

function buildBrief(creator: Creator, script: Script | undefined) {
  return [
    `LinkVerse outreach brief — ${creator.title}`,
    `Recommended product: ${creator.product}`,
    creator.price.min ? `Budget band: $${creator.price.min}–$${creator.price.max}` : "",
    "",
    `Why they fit: ${creator.reason}`,
    script
      ? `\n[${platformLabel(script.platform)} script]\nHook: ${script.hook}\nCaption: ${script.caption}\nCTA: ${script.cta}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Opens a real Gmail compose window (not a mocked send) — we don't have
// creators' actual emails in this dataset, so this hands off to the user's
// own Gmail with a drafted message rather than faking a "sent" state.
// Uses Gmail's web compose URL instead of mailto: so it opens Gmail
// specifically, rather than whatever the OS/browser's default mail handler
// happens to be (e.g. Outlook).
function buildGmailComposeUrl(creator: Creator, script: Script | undefined) {
  const subject = `Collab opportunity — ${creator.product}`;
  const lines = [
    `Hi ${creator.title},`,
    "",
    `We think you'd be a great fit for ${creator.product} — ${creator.reason}`,
  ];
  if (script) {
    lines.push("", script.hook, "", script.caption, "", script.cta);
  }
  if (creator.price.min) {
    lines.push("", `We're working with a budget band of $${creator.price.min}–$${creator.price.max} for this collab.`);
  }
  lines.push("", "Let us know if you're interested!", "", "— sent via LinkVerse");
  const body = lines.join("\n");
  const params = new URLSearchParams({ view: "cm", fs: "1", su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export default function Kit({
  creator,
  onClose,
  tracked,
  onTrack,
}: {
  creator: Creator;
  onClose: () => void;
  /** Already on the pipeline — the button becomes a state readout, not a no-op. */
  tracked?: boolean;
  onTrack?: () => void;
}) {
  const [tab, setTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const script = creator.scripts[tab];

  const copyBrief = () => {
    navigator.clipboard.writeText(buildBrief(creator, script)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const exportBrief = () => {
    const blob = new Blob([buildBrief(creator, script)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${creator.title}_${script?.platform ?? "brief"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-[440px] bg-surface border-l border-line
      shadow-2xl overflow-y-auto animate-slide">
      {/* header */}
      <div className="sticky top-0 bg-surface/95 backdrop-blur border-b border-line px-6 py-4 flex items-start gap-3">
        {creator.thumb && (
          <img src={creator.thumb} alt="" className="w-12 h-12 rounded object-cover border border-line" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-bold text-ink leading-tight truncate">{creator.title}</h2>
          <p className="text-xs text-muted mt-0.5">
            {fmtSubs(creator.subs)} subs · {creator.sport}
            {creator.market ? ` · ${creator.market.replace(/_/g, " ")}` : ""}
          </p>
        </div>
        {onTrack && (
          <button
            onClick={onTrack}
            aria-pressed={!!tracked}
            title={tracked ? "Already on your pipeline" : "Add to your pipeline"}
            className={`shrink-0 px-2.5 py-1 rounded-full text-xs border transition-colors ${
              tracked
                ? "bg-accent text-white border-accent"
                : "bg-surface text-ink border-line hover:border-accent"
            }`}
          >
            {tracked ? "Tracked" : "Track"}
          </button>
        )}
        <button onClick={onClose} aria-label="Close"
          className="text-muted hover:text-ink text-xl leading-none px-1">×</button>
      </div>

      <div className="px-6 py-5 space-y-6">
        <div>
          <a
            href={buildGmailComposeUrl(creator, script)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-accent text-white
              text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            ✉ Contact {creator.title} →
          </a>
          <p className="text-[11px] text-muted mt-1.5 text-center leading-snug">
            Opens a Gmail draft with the message below — look up their contact (e.g. the channel's About
            page) since we don't have it on file.
          </p>
        </div>

        <RiskBanner risk={creator.risk} />

        {/* scores */}
        <div className="grid grid-cols-3 gap-3">
          {([["Potential", creator.P], ["Resonance", creator.R], ["Combined", creator.C]] as const).map(
            ([label, v]) => (
              <div key={label} className="rounded-lg border border-line bg-paper/60 px-3 py-2.5">
                <div className="num text-2xl font-semibold text-ink">{v}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted mt-0.5">{label}</div>
              </div>
            ),
          )}
        </div>

        <ThumbnailStrip thumbnails={creator.thumbnails} />

        {/* why fit */}
        <section>
          <h3 className="font-display text-sm font-bold text-ink mb-1.5">Why this creator fits</h3>
          <p className="text-sm text-ink/80 leading-relaxed">{creator.reason}</p>
          {creator.contributions.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-4 mb-0.5">
                Feature match breakdown
              </div>
              <ContributionChart contributions={creator.contributions} />
            </>
          )}
        </section>

        {/* product + price */}
        <section className="rounded-lg border border-accent/25 bg-accent/[0.04] px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-accent font-semibold">Recommended product</div>
          <div className="font-display font-bold text-ink mt-0.5">{creator.product}</div>
          {creator.price.min && (
            <div className="text-sm text-ink/80 mt-1.5">
              Budget band <span className="num font-semibold">${creator.price.min}–${creator.price.max}</span>
            </div>
          )}
          {creator.price.basis && <p className="text-[11px] text-muted mt-1 leading-snug">{creator.price.basis}</p>}
        </section>

        {/* what the AI saw */}
        {creator.vision && (
          <section>
            <h3 className="font-display text-sm font-bold text-ink mb-1.5">What the AI saw</h3>
            <VisionSection vision={creator.vision} />
            <VelocityChart velocity={creator.velocity} />
          </section>
        )}

        {/* script */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display text-sm font-bold text-ink">Ready-to-send script</h3>
            {creator.hasScript && (
              <div className="flex items-center gap-2">
                <button onClick={exportBrief}
                  className="text-xs font-medium text-muted border border-line rounded px-2.5 py-1
                    hover:bg-paper transition-colors">
                  Export .txt
                </button>
                <button onClick={copyBrief}
                  className="text-xs font-medium text-accent border border-accent/30 rounded px-2.5 py-1
                    hover:bg-accent hover:text-white transition-colors">
                  {copied ? "Copied ✓" : "Copy brief"}
                </button>
              </div>
            )}
          </div>

          {!creator.hasScript ? (
            <p className="text-sm text-muted bg-paper/60 border border-line rounded-lg px-4 py-3 leading-relaxed">
              Full script not generated for this creator yet. The match reason, product and budget band
              above are ready to send.
            </p>
          ) : (
            <>
              <div className="flex gap-1 mb-3">
                {creator.scripts.map((s, i) => (
                  <button key={i} onClick={() => setTab(i)}
                    className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                      i === tab ? "bg-ink text-white" : "bg-paper text-muted hover:text-ink"
                    }`}>
                    {platformLabel(s.platform)}
                  </button>
                ))}
              </div>
              {script && (
                <div className="space-y-3 text-sm">
                  <Field label="Hook">{script.hook}</Field>
                  {script.beats?.length > 0 && <ListField label="Storyboard" items={script.beats} />}
                  {script.voiceover?.length > 0 && <ListField label="Voiceover" items={script.voiceover} />}
                  <Field label="Caption">{script.caption}</Field>
                  <Field label="Call to action">{script.cta}</Field>
                </div>
              )}
            </>
          )}
        </section>

        <a href={creator.url} target="_blank" rel="noreferrer"
          className="block text-center text-sm font-medium text-accent hover:underline">
          Open channel on YouTube →
        </a>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-0.5">{label}</div>
      <p className="text-ink/85 leading-relaxed">{children}</p>
    </div>
  );
}

function ListField({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">{label}</div>
      <ol className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-ink/85 leading-relaxed flex gap-2">
            <span className="num text-muted shrink-0">{i + 1}</span>
            <span>{it}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RiskBanner({ risk }: { risk: Creator["risk"] }) {
  if (!risk.flagged) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold">
        Review before outreach
      </div>
      <p className="text-sm text-ink/80 leading-relaxed mt-1.5">{risk.conclusion}</p>
      {risk.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {risk.keywords.map((k) => (
            <span key={k}
              className="num text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 border border-amber-500/30">
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ThumbnailStrip({ thumbnails }: { thumbnails: string[] }) {
  if (thumbnails.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {thumbnails.map((url, i) => (
        <img key={i} src={url} alt="" className="h-14 w-24 rounded object-cover border border-line shrink-0" />
      ))}
    </div>
  );
}

const chartTooltipStyle = {
  contentStyle: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-line)",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "var(--color-ink)", fontWeight: 600 },
};

function ContributionChart({ contributions }: { contributions: Creator["contributions"] }) {
  const data = contributions
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((c) => ({ name: dimLabel(c.dim), value: c.value }));
  return (
    <div className="h-44 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" opacity={0.6} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-muted)" }} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: "var(--color-muted)" }} />
          <Tooltip {...chartTooltipStyle} />
          <Bar dataKey="value" fill="var(--color-accent)" fillOpacity={0.85} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Gauge({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-muted mb-1">
        <span>{label}</span>
        <span className="num">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-line overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function VisionSection({ vision }: { vision: NonNullable<Creator["vision"]> }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Field label="Sport types">{vision.sportTypes.join(", ") || "—"}</Field>
        <Field label="Camera perspective">{vision.perspective}</Field>
        <Field label="Narrative pace">{vision.pace}</Field>
      </div>
      <div className="space-y-2">
        <Gauge label="Stabilization demand" value={vision.stabilization} />
        <Gauge label="Scene extremity" value={vision.extremity} />
        <Gauge label="Gear visibility" value={vision.gear} />
      </div>
      <p className="text-xs text-ink/70 leading-relaxed bg-paper/60 border border-line rounded-lg px-3 py-2.5 italic">
        “{vision.evidence}”
      </p>
    </div>
  );
}

function VelocityChart({ velocity }: { velocity: Creator["velocity"] }) {
  if (velocity.length < 2) return null;
  return (
    <div className="mt-4">
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">
        Momentum over time
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={velocity} margin={{ left: -20, top: 4, right: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" opacity={0.6} />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--color-muted)" }} minTickGap={40} />
            <YAxis tick={{ fontSize: 9, fill: "var(--color-muted)" }} width={32} />
            <Tooltip {...chartTooltipStyle} />
            <Line type="monotone" dataKey="relative" stroke="var(--color-accent)" dot={false} strokeWidth={2}
              name="Relative velocity" />
            <Line type="monotone" dataKey="seasonAdjusted" stroke="var(--color-muted)" dot={false} strokeWidth={1.5}
              strokeDasharray="4 3" name="Season-adjusted" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
