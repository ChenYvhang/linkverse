import { useRef, useState } from "react";
import { useLocale, verticalLabel } from "../lib/i18n";
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

export interface ScatterPlotPoint {
  channel_id: string;
  title: string;
  vertical: string;
  potential: number;
  resonance: number;
  combined: number;
  subscriber_count: number;
  thumbnail?: string;
  channel_url?: string;
}

const QUADRANT_SPLIT = 50;
const MIN_RADIUS = 11;
const MAX_RADIUS = 24;
const HOVER_SCALE = 1.3;

function isIgnitionCandidate(p: ScatterPlotPoint) {
  return p.potential >= QUADRANT_SPLIT && p.resonance >= QUADRANT_SPLIT;
}

interface ThumbSymbolProps {
  cx?: number;
  cy?: number;
  size?: number;
  payload?: ScatterPlotPoint;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  inPool: boolean;
  onReportPosition: (channelId: string, cx: number, cy: number) => void;
  openChannelLabel: string;
}

function ThumbSymbol({
  cx,
  cy,
  size,
  payload,
  hoveredId,
  onHover,
  inPool,
  onReportPosition,
  openChannelLabel,
}: ThumbSymbolProps) {
  const [broken, setBroken] = useState(false);
  if (cx === undefined || cy === undefined || !payload) return null;
  onReportPosition(payload.channel_id, cx, cy);
  const area = size ?? 200;
  const baseRadius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Math.sqrt(area / Math.PI)));
  const hovered = hoveredId === payload.channel_id;
  const r = hovered ? baseRadius * HOVER_SCALE : baseRadius;
  const highlight = isIgnitionCandidate(payload);
  const clipId = `thumb-clip-${payload.channel_id}`;
  const showImage = payload.thumbnail && !broken;

  return (
    <g
      onMouseEnter={() => onHover(payload.channel_id)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: "pointer" }}
    >
      {highlight && (
        <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="var(--color-accent)" strokeWidth={1} strokeOpacity={0.35} />
      )}
      <defs>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      {showImage ? (
        <image
          href={payload.thumbnail}
          x={cx - r}
          y={cy - r}
          width={r * 2}
          height={r * 2}
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid slice"
          onError={() => setBroken(true)}
        />
      ) : (
        <circle cx={cx} cy={cy} r={r} fill="#1f2483" />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={highlight ? "var(--color-accent)" : "#3a3f4d"}
        strokeWidth={highlight ? 2 : 1}
      />
      {inPool && (
        <g>
          <circle cx={cx + r * 0.72} cy={cy - r * 0.72} r={5} fill="#e5e7eb" stroke="#04073b" strokeWidth={1} />
          <path
            d={`M ${cx + r * 0.72 - 2.2} ${cy - r * 0.72} l 1.6 1.6 l 3 -3.2`}
            stroke="#04073b"
            strokeWidth={1.2}
            fill="none"
            strokeLinecap="round"
          />
        </g>
      )}
      {hovered && payload.channel_url && (
        // A real <a> (not a click handler + window.open) so the new-tab
        // navigation is a native link activation: it can't be silently
        // eaten by a popup blocker the way a scripted window.open() can.
        <a
          href={payload.channel_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ cursor: "pointer" }}
        >
          <title>{openChannelLabel}</title>
          <circle cx={cx + r * 0.72} cy={cy + r * 0.72} r={7} fill="#e5e7eb" stroke="#04073b" strokeWidth={1} />
          <path
            d={`M ${cx + r * 0.72 - 2.3} ${cy + r * 0.72 + 2.3} L ${cx + r * 0.72 + 2.3} ${cy + r * 0.72 - 2.3} M ${cx + r * 0.72 - 0.3} ${cy + r * 0.72 - 2.3} L ${cx + r * 0.72 + 2.3} ${cy + r * 0.72 - 2.3} L ${cx + r * 0.72 + 2.3} ${cy + r * 0.72 - 0.3}`}
            stroke="#04073b"
            strokeWidth={1.2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </a>
      )}
    </g>
  );
}

interface DragRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const DRAG_THRESHOLD_PX = 6;

export default function ScatterMatrix({
  points,
  onSelect,
  poolIds,
  onBoxSelect,
}: {
  points: ScatterPlotPoint[];
  onSelect: (channelId: string) => void;
  poolIds: Set<string>;
  onBoxSelect: (channelIds: string[]) => void;
}) {
  const { t } = useLocale();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragRect | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<Map<string, { cx: number; cy: number }>>(new Map());
  const hovered = points.find((p) => p.channel_id === hoveredId) ?? null;

  function relativePos(e: React.MouseEvent) {
    const rect = plotRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const pos = relativePos(e);
    setDrag({ x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!drag) return;
    const pos = relativePos(e);
    setDrag((d) => (d ? { ...d, x1: pos.x, y1: pos.y } : d));
  }

  function finishDrag() {
    if (!drag) return;
    const { x0, y0, x1, y1 } = drag;
    if (Math.abs(x1 - x0) > DRAG_THRESHOLD_PX || Math.abs(y1 - y0) > DRAG_THRESHOLD_PX) {
      const xmin = Math.min(x0, x1);
      const xmax = Math.max(x0, x1);
      const ymin = Math.min(y0, y1);
      const ymax = Math.max(y0, y1);
      const matched: string[] = [];
      positionsRef.current.forEach((pos, id) => {
        if (pos.cx >= xmin && pos.cx <= xmax && pos.cy >= ymin && pos.cy <= ymax) matched.push(id);
      });
      if (matched.length > 0) onBoxSelect(matched);
    }
    setDrag(null);
  }

  return (
    <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] transition-colors duration-300 hover:border-white/20">
      <div
        ref={plotRef}
        className="h-[460px] relative select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={finishDrag}
        onMouseLeave={() => setDrag(null)}
      >
        {drag && (
          <div
            className="absolute z-10 border border-dashed pointer-events-none"
            style={{
              left: Math.min(drag.x0, drag.x1),
              top: Math.min(drag.y0, drag.y1),
              width: Math.abs(drag.x1 - drag.x0),
              height: Math.abs(drag.y1 - drag.y0),
              borderColor: "var(--color-accent)",
              background: "rgba(255, 139, 38, 0.08)",
            }}
          />
        )}
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid stroke="#262c42" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="resonance"
              name={t("scatter.axisR")}
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "#8b8f9c" }}
              label={{ value: t("scatter.axisR"), position: "insideBottom", offset: -4, fill: "#6b7280", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="potential"
              name={t("scatter.axisP")}
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "#8b8f9c" }}
              label={{ value: t("scatter.axisP"), angle: -90, position: "insideLeft", fill: "#6b7280", fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="subscriber_count" range={[120, 700]} name={t("matrix.colSubscribers")} />

            <ReferenceArea
              x1={QUADRANT_SPLIT}
              x2={100}
              y1={QUADRANT_SPLIT}
              y2={100}
              fill="var(--color-accent)"
              fillOpacity={0.05}
              stroke="var(--color-accent)"
              strokeOpacity={0.2}
              strokeDasharray="4 4"
              label={{ value: t("scatter.quadrantIgnition"), position: "insideTopRight", fill: "var(--color-accent)", fontSize: 11, fontWeight: 600 }}
            />
            <ReferenceArea
              x1={0}
              x2={QUADRANT_SPLIT}
              y1={QUADRANT_SPLIT}
              y2={100}
              fill="transparent"
              label={{ value: t("scatter.quadrantViral"), position: "insideTopLeft", fill: "#5b5f6b", fontSize: 11 }}
            />
            <ReferenceArea
              x1={QUADRANT_SPLIT}
              x2={100}
              y1={0}
              y2={QUADRANT_SPLIT}
              fill="transparent"
              label={{ value: t("scatter.quadrantResonant"), position: "insideBottomRight", fill: "#5b5f6b", fontSize: 11 }}
            />
            <ReferenceArea
              x1={0}
              x2={QUADRANT_SPLIT}
              y1={0}
              y2={QUADRANT_SPLIT}
              fill="transparent"
              label={{ value: t("scatter.quadrantSkip"), position: "insideBottomLeft", fill: "#5b5f6b", fontSize: 11 }}
            />
            <ReferenceLine x={QUADRANT_SPLIT} stroke="#242a8a" strokeDasharray="3 3" />
            <ReferenceLine y={QUADRANT_SPLIT} stroke="#242a8a" strokeDasharray="3 3" />

            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as ScatterPlotPoint;
                return (
                  <div className="flex gap-2 bg-[#111763] border border-white/15 rounded-md p-2 text-xs max-w-[220px]">
                    {p.thumbnail && (
                      <img src={p.thumbnail} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-ink-100 truncate">{p.title}</div>
                      <div className="text-ink-400">{verticalLabel(t, p.vertical)}</div>
                      <div className="text-ink-400 tabular-nums">
                        P={p.potential.toFixed(1)} R={p.resonance.toFixed(1)}
                      </div>
                    </div>
                  </div>
                );
              }}
            />

            <Scatter
              data={points}
              onClick={(p) => onSelect((p as unknown as ScatterPlotPoint).channel_id)}
              cursor="pointer"
              shape={(props) => {
                const p = props as unknown as {
                  cx?: number;
                  cy?: number;
                  size?: number;
                  payload?: ScatterPlotPoint;
                };
                return (
                  <ThumbSymbol
                    cx={p.cx}
                    cy={p.cy}
                    size={p.size}
                    payload={p.payload}
                    hoveredId={hoveredId}
                    onHover={setHoveredId}
                    inPool={p.payload ? poolIds.has(p.payload.channel_id) : false}
                    onReportPosition={(id, cx, cy) => positionsRef.current.set(id, { cx, cy })}
                    openChannelLabel={t("scatter.openChannel")}
                  />
                );
              }}
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-4 mt-2 text-xs text-ink-400">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-[var(--color-accent)] inline-block" />
          {t("scatter.legendIgnition")}
        </span>
        <span>{t("scatter.legendSize")}</span>
        {hovered && (
          <span className="text-ink-400">
            {t("scatter.current")}<span className="text-ink-100">{hovered.title}</span>
          </span>
        )}
      </div>
    </div>
  );
}
