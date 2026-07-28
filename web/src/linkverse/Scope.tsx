import { useState } from "react";
import type { Creator } from "./useData";

const fmtSubs = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;

// Plot geometry (SVG user units). Data axes run 0..100.
const W = 620;
const H = 620;
const PAD = 64; // room for axis labels
const plot = (v: number, axis: "x" | "y") => {
  const t = Math.max(0, Math.min(100, v)) / 100;
  return axis === "x" ? PAD + t * (W - PAD * 1.4) : H - PAD - t * (H - PAD * 1.4);
};
const PRIORITY_P = 60;
const PRIORITY_R = 60;
export const isPriority = (c: Creator) => c.P >= PRIORITY_P && c.R >= PRIORITY_R;

const TOOLTIP_W = 176;
const TOOLTIP_H = 68;

export default function Scope({
  creators,
  selected,
  onSelect,
}: {
  creators: Creator[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [hover, setHover] = useState<Creator | null>(null);
  const zoneX = plot(PRIORITY_R, "x");
  const zoneY = plot(PRIORITY_P, "y");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img"
      aria-label="Creators plotted by Potential and Resonance">
      {/* priority zone tint (top-right) */}
      <rect x={zoneX} y={PAD - 8} width={W - PAD * 1.4 - zoneX + plot(0, "x")} height={zoneY - PAD + 8}
        fill="var(--color-accent)" opacity="0.06" />
      {/* faint grid */}
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g} stroke="var(--color-line)" strokeWidth="1">
          <line x1={plot(g, "x")} y1={plot(0, "y")} x2={plot(g, "x")} y2={plot(100, "y")} opacity="0.5" />
          <line x1={plot(0, "x")} y1={plot(g, "y")} x2={plot(100, "x")} y2={plot(g, "y")} opacity="0.5" />
        </g>
      ))}
      {/* priority reticle ring */}
      <circle cx={(zoneX + plot(100, "x")) / 2} cy={(zoneY + plot(100, "y")) / 2}
        r="8" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" opacity="0.35" />

      {/* HUD corner ticks — action-cam viewfinder cue */}
      {([[PAD, PAD], [W - PAD * 0.4, PAD], [PAD, H - PAD], [W - PAD * 0.4, H - PAD]] as const).map(
        ([cx, cy], i) => {
          const dx = cx < W / 2 ? 12 : -12;
          const dy = cy < H / 2 ? 12 : -12;
          return (
            <g key={i} stroke="var(--color-muted)" strokeWidth="1.5" opacity="0.6">
              <line x1={cx} y1={cy} x2={cx + dx} y2={cy} />
              <line x1={cx} y1={cy} x2={cx} y2={cy + dy} />
            </g>
          );
        },
      )}

      {/* points */}
      {creators.map((c) => {
        const pri = isPriority(c);
        const sel = c.id === selected;
        const cx = plot(c.R, "x");
        const cy = plot(c.P, "y");
        return (
          <g key={c.id} className="cursor-pointer"
            onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)}
            onClick={() => onSelect(c.id)}>
            {sel && <circle cx={cx} cy={cy} r="11" fill="none" stroke="var(--color-accent)" strokeWidth="2" />}
            <circle cx={cx} cy={cy} r={sel ? 6 : pri ? 5 : 3.5}
              fill={pri ? "var(--color-accent)" : "#aab0ba"}
              opacity={pri ? 0.9 : 0.55}
              stroke={c.hasScript ? "var(--color-surface)" : "none"} strokeWidth={c.hasScript ? 1.5 : 0} />
          </g>
        );
      })}

      {/* richer hover tooltip: thumbnail + title + subs + market */}
      {hover && (() => {
        const cx = plot(hover.R, "x");
        const cy = plot(hover.P, "y");
        const bx = Math.min(Math.max(cx + 12, 4), W - TOOLTIP_W - 4);
        const by = Math.min(Math.max(cy - 12 - TOOLTIP_H, 4), H - TOOLTIP_H - 4);
        return (
          <g pointerEvents="none">
            <defs>
              <clipPath id="scope-tooltip-thumb-clip">
                <rect x={bx + 8} y={by + 10} width="48" height="48" rx="4" />
              </clipPath>
            </defs>
            <rect x={bx} y={by} width={TOOLTIP_W} height={TOOLTIP_H} rx="8"
              fill="var(--color-surface)" stroke="var(--color-line)" strokeWidth="1" />
            {hover.thumb ? (
              <image href={hover.thumb} x={bx + 8} y={by + 10} width="48" height="48"
                preserveAspectRatio="xMidYMid slice" clipPath="url(#scope-tooltip-thumb-clip)" />
            ) : (
              <rect x={bx + 8} y={by + 10} width="48" height="48" rx="4" fill="var(--color-paper)" />
            )}
            <text x={bx + 64} y={by + 24} fontSize="12" fontWeight="600" fill="var(--color-ink)">
              {hover.title.length > 18 ? hover.title.slice(0, 18) + "…" : hover.title}
            </text>
            <text x={bx + 64} y={by + 41} fontSize="11" className="num" fill="var(--color-muted)">
              {fmtSubs(hover.subs)} subs
            </text>
            <text x={bx + 64} y={by + 56} fontSize="11" fill="var(--color-muted)">
              {hover.market.replace(/_/g, " ")}
            </text>
          </g>
        );
      })()}

      {/* axis titles */}
      <text x={(PAD + plot(100, "x")) / 2} y={H - 18} textAnchor="middle" fontSize="13"
        fill="var(--color-ink)" fontWeight="600" fontFamily="var(--font-display)">
        Resonance →  fits the product
      </text>
      <text transform={`translate(20 ${(PAD + plot(0, "y")) / 2}) rotate(-90)`} textAnchor="middle"
        fontSize="13" fill="var(--color-ink)" fontWeight="600" fontFamily="var(--font-display)">
        Potential →  about to break out
      </text>

      {/* quadrant labels */}
      <text x={plot(100, "x")} y={PAD - 20} textAnchor="end" fontSize="11" letterSpacing="0.08em"
        fill="var(--color-accent)" fontWeight="700" fontFamily="var(--font-display)">
        SIGN THESE FIRST
      </text>
      <text x={plot(0, "x")} y={PAD - 20} textAnchor="start" fontSize="11" letterSpacing="0.08em"
        fill="var(--color-muted)" fontWeight="600" fontFamily="var(--font-display)">
        WATCHLIST
      </text>
      <text x={plot(100, "x")} y={plot(0, "y") - 12} textAnchor="end" fontSize="11" letterSpacing="0.08em"
        fill="var(--color-muted)" fontWeight="600" fontFamily="var(--font-display)">
        SAFE BET
      </text>
      <text x={plot(0, "x")} y={plot(0, "y") - 12} textAnchor="start" fontSize="11" letterSpacing="0.08em"
        fill="var(--color-muted)" fontWeight="600" fontFamily="var(--font-display)">
        LOW SIGNAL
      </text>
    </svg>
  );
}
