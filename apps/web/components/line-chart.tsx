"use client";
// Inline-SVG line chart: one y-axis, 2px lines, crosshair + tooltip, direct end labels + legend,
// and a table view (required: the light-mode NAV color sits under 3:1 contrast).
import { useMemo, useRef, useState } from "react";

export type Series = { key: string; label: string; color: string; points: { x: number; y: number }[] };

const W = 720, H = 280, PAD = { l: 60, r: 84, t: 12, b: 28 };

// Formatters are presets: a Server Component can't pass functions to this Client Component.
const Y_FORMATS = { index: (v: number) => v.toFixed(1), usd3: (v: number) => `$${v.toFixed(3)}` };
const X_FORMATS = {
  date: (x: number) => new Date(x).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  datetime: (x: number) => new Date(x).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
};

export function LineChart({
  series,
  yFormat = "index",
  xFormat = "date",
  baseline,
  caption,
}: {
  series: Series[];
  yFormat?: keyof typeof Y_FORMATS;
  xFormat?: keyof typeof X_FORMATS;
  baseline?: number;
  caption: string;
}) {
  const formatY = Y_FORMATS[yFormat], formatX = X_FORMATS[xFormat];
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const svg = useRef<SVGSVGElement>(null);

  const { xs, x, y, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const xMin = Math.min(...all.map((p) => p.x)), xMax = Math.max(...all.map((p) => p.x));
    let yMin = Math.min(...all.map((p) => p.y), baseline ?? Infinity), yMax = Math.max(...all.map((p) => p.y), baseline ?? -Infinity);
    const pad = (yMax - yMin) * 0.08 || 1;
    yMin -= pad;
    yMax += pad;
    const x = (v: number) => PAD.l + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
    const ticks = Array.from({ length: 4 }, (_, i) => yMin + ((yMax - yMin) * (i + 0.5)) / 4);
    return { xs: series[0]?.points.map((p) => p.x) ?? [], x, y, ticks };
  }, [series, baseline]);

  if (!xs.length) return <p className="text-sm text-text-3">No data yet.</p>;

  const onMove = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    xs.forEach((v, i) => Math.abs(x(v) - px) < Math.abs(x(xs[best]!) - px) && (best = i));
    setHover(best);
  };

  return (
    <figure className="w-full">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={caption}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num" fontSize={11} fill="var(--text-3)">
              {formatY(t)}
            </text>
          </g>
        ))}
        {[xs[0]!, xs[Math.floor(xs.length / 2)]!, xs.at(-1)!].map((v, i) => (
          <text key={v} x={x(v)} y={H - 8} textAnchor={(["start", "middle", "end"] as const)[i]} fontSize={11} fill="var(--text-3)">
            {formatX(v)}
          </text>
        ))}
        {baseline !== undefined && <line x1={PAD.l} x2={W - PAD.r} y1={y(baseline)} y2={y(baseline)} stroke="var(--text-3)" strokeDasharray="3 4" strokeWidth={1} />}
        {series.map((s) => (
          <g key={s.key}>
            <path d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join("")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <text x={x(s.points.at(-1)!.x) + 8} y={y(s.points.at(-1)!.y)} dy="0.32em" fontSize={12} fill="var(--text-2)">
              {s.label}
            </text>
          </g>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(xs[hover]!)} x2={x(xs[hover]!)} y1={PAD.t} y2={H - PAD.b} stroke="var(--text-3)" strokeWidth={1} />
            {series.map((s) => (
              <circle key={s.key} cx={x(s.points[hover]!.x)} cy={y(s.points[hover]!.y)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-text-2">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.label}
            {hover !== null && <span className="num text-text">{formatY(s.points[hover]!.y)}</span>}
          </span>
        ))}
        {hover !== null && <span className="text-text-3">{formatX(xs[hover]!)}</span>}
        <button onClick={() => setTable((t) => !t)} className="ml-auto text-text-3 underline-offset-2 hover:text-text hover:underline">
          {table ? "Hide table" : "View as table"}
        </button>
      </div>
      <figcaption className="mt-1 text-xs text-text-3">{caption}</figcaption>
      {table && (
        <div className="mt-3 max-h-56 overflow-auto rounded-control border border-line">
          <table className="num w-full text-xs">
            <thead className="sticky top-0 bg-surface-2 text-text-2">
              <tr>
                <th className="px-3 py-1.5 text-left font-normal">Time</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-1.5 text-right font-normal">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xs.map((v, i) => (
                <tr key={v} className="odd:bg-surface">
                  <td className="px-3 py-1 text-text-3">{new Date(v).toLocaleString()}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1 text-right">{formatY(s.points[i]!.y)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
