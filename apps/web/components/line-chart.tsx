"use client";
// Inline-SVG line chart in the page duotone (DESIGN.md §1): series differ by stroke (solid vs
// dotted), not color. Time-spaced x ticks (never overlap), a hover/touch readout, optional range
// tabs and event markers (rotations, parks), direct end labels, and a table view.
import { useEffect, useMemo, useRef, useState } from "react";

export type Series = { key: string; label: string; dashed?: boolean; points: { x: number; y: number }[] };
export type Marker = { x: number; label: string };

// The SVG is drawn at the width it is shown, so text keeps its real size on phones.
const PAD_WIDE = { l: 64, r: 92, t: 22, b: 30 }, PAD_NARROW = { l: 52, r: 72, t: 22, b: 30 };
const HOUR = 3_600_000;
const RANGES: [string, number][] = [["24H", 24 * HOUR], ["7D", 7 * 24 * HOUR], ["30D", 30 * 24 * HOUR], ["All", Infinity]];

// Formatters are presets: a Server Component can't pass functions to this Client Component.
const Y_FORMATS = { index: (v: number) => v.toFixed(1), usd0: (v: number) => `$${Math.round(v).toLocaleString()}`, usd3: (v: number) => `$${v.toFixed(4)}` };
const fmtTick = (x: number, span: number) =>
  span < 2 * 24 * HOUR
    ? new Date(x).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : new Date(x).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtFull = (x: number) => new Date(x).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function LineChart({
  series,
  yFormat = "index",
  baseline,
  caption,
  ranges = false,
  markers = [],
}: {
  series: Series[];
  yFormat?: keyof typeof Y_FORMATS;
  /** Kept for callers; ticks now adapt to the visible time span. */
  xFormat?: "date" | "datetime";
  baseline?: number;
  caption: string;
  ranges?: boolean;
  markers?: Marker[];
}) {
  const formatY = Y_FORMATS[yFormat];
  const last = Math.max(...series.flatMap((s) => s.points.map((p) => p.x)));
  const [range, setRange] = useState(Infinity);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(720);
  const narrow = W < 520;
  const H = narrow ? 240 : 300;
  const PAD = narrow ? PAD_NARROW : PAD_WIDE;
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e!.contentRect.width))));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => series.map((s) => ({ ...s, points: s.points.filter((p) => last - p.x <= range) })), [series, range, last]);
  const xs = view[0]?.points.map((p) => p.x) ?? [];

  const { x, y, yTicks, xTicks, span } = useMemo(() => {
    const all = view.flatMap((s) => s.points);
    const xMin = Math.min(...all.map((p) => p.x)), xMax = Math.max(...all.map((p) => p.x));
    let yMin = Math.min(...all.map((p) => p.y), baseline ?? Infinity), yMax = Math.max(...all.map((p) => p.y), baseline ?? -Infinity);
    const pad = (yMax - yMin) * 0.1 || Math.abs(yMax) * 0.002 || 1;
    yMin -= pad;
    yMax += pad;
    const x = (v: number) => PAD.l + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
    const yTicks = Array.from({ length: 4 }, (_, i) => yMin + ((yMax - yMin) * (i + 0.5)) / 4);
    // Evenly spaced in time, not by point index, so clustered points can't stack labels.
    const n = narrow ? 2 : 4; // phones: first and last only, so labels never touch
    const xTicks = xMax > xMin ? Array.from({ length: n }, (_, i) => xMin + ((xMax - xMin) * i) / (n - 1)) : [xMin];
    return { x, y, yTicks, xTicks, span: xMax - xMin };
  }, [view, baseline, W, H, narrow, PAD]);

  const tabs = ranges && (
    <div role="group" aria-label="Range" className="mb-3 flex gap-1 font-mono text-[11px]">
      {RANGES.map(([label, ms]) => (
        <button key={label} aria-pressed={range === ms} onClick={() => { setRange(ms); setHover(null); }}
          className={`h-8 border border-tc px-2.5 uppercase tracking-[0.12em] ${range === ms ? "bg-tc text-fc" : ""}`}>
          {label}
        </button>
      ))}
    </div>
  );
  if (xs.length < 2) return <figure ref={box} className="w-full">{tabs}<p className="py-10 text-[14px]">Not enough points in this range yet.</p></figure>;

  const pick = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0;
    xs.forEach((v, i) => Math.abs(x(v) - px) < Math.abs(x(xs[best]!) - px) && (best = i));
    setHover(best);
  };
  const near = hover !== null ? markers.filter((m) => Math.abs(m.x - xs[hover]!) <= Math.max(span / 40, 10 * 60_000)) : [];
  const shownMarkers = markers.filter((m) => m.x >= xs[0]! && m.x <= xs.at(-1)!);
  const hx = hover !== null ? x(xs[hover]!) : 0;

  return (
    <figure ref={box} className="w-full">
      {tabs}
      <div className="relative">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none select-none"
          role="img"
          aria-label={caption}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--dim)" strokeWidth={1} />
              <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num" fontSize={11} fill="var(--t)">{formatY(t)}</text>
            </g>
          ))}
          {xTicks.map((v, i) => (
            <text key={v} x={x(v)} y={H - 8} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"} className="num" fontSize={11} fill="var(--t)">
              {fmtTick(v, span)}
            </text>
          ))}
          {baseline !== undefined && <line x1={PAD.l} x2={W - PAD.r} y1={y(baseline)} y2={y(baseline)} stroke="var(--dim)" strokeDasharray="3 4" strokeWidth={1} />}
          {shownMarkers.map((m) => (
            <g key={m.x}>
              <line x1={x(m.x)} x2={x(m.x)} y1={PAD.t - 8} y2={H - PAD.b} stroke="var(--t)" strokeDasharray="2 3" strokeWidth={1} />
              <rect x={x(m.x) - 3} y={PAD.t - 12} width={6} height={6} fill="var(--t)" />
            </g>
          ))}
          {view.map((s) => (
            <g key={s.key}>
              <path d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join("")} fill="none" stroke="var(--t)"
                strokeWidth={s.dashed ? 1.5 : 2.5} strokeDasharray={s.dashed ? "2 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
              <text x={x(s.points.at(-1)!.x) + 8} y={y(s.points.at(-1)!.y)} dy="0.32em" fontSize={12} className="num" fill="var(--t)">{s.label}</text>
            </g>
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} stroke="var(--t)" strokeWidth={1} />
              {view.map((s) => (
                <rect key={s.key} x={hx - 4} y={y(s.points[hover]!.y) - 4} width={8} height={8} fill="var(--t)" stroke="var(--f)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div
            className="panel num pointer-events-none absolute top-2 z-10 min-w-[10rem] p-2 text-[12px] leading-[1.45]"
            style={hx / W > 0.6 ? { right: `${((W - hx) / W) * 100 + 2}%` } : { left: `${(hx / W) * 100 + 2}%` }}
          >
            <p className="font-bold">{fmtFull(xs[hover]!)}</p>
            {view.map((s) => (
              <p key={s.key}>{s.label}: {formatY(s.points[hover]!.y)}</p>
            ))}
            {near.map((m) => (
              <p key={m.x} className="mt-1 border-t border-tc pt-1">◆ {m.label}</p>
            ))}
          </div>
        )}
      </div>
      <div className="num mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
        {view.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden><line x1="0" x2="16" y1="2" y2="2" stroke="var(--t)" strokeWidth={s.dashed ? 1.5 : 2.5} strokeDasharray={s.dashed ? "2 4" : undefined} /></svg>
            {s.label}
          </span>
        ))}
        {shownMarkers.length > 0 && <span className="flex items-center gap-1.5"><span className="inline-block size-[6px] bg-tc" /> AI decision</span>}
        <span className="opacity-70">Hover or tap the chart for exact values.</span>
        <button onClick={() => setTable((t) => !t)} className="ml-auto underline underline-offset-2">{table ? "Hide table" : "View as table"}</button>
      </div>
      <figcaption className="mt-1 text-[12px]">{caption}</figcaption>
      {table && (
        <div className="mt-3 max-h-56 overflow-auto overscroll-contain border border-tc">
          <table className="num w-full text-[12px]">
            <thead className="sticky top-0 bg-tc text-fc">
              <tr>
                <th className="px-3 py-1.5 text-left font-normal">Time</th>
                {view.map((s) => <th key={s.key} className="px-3 py-1.5 text-right font-normal">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {xs.map((v, i) => (
                <tr key={v}>
                  <td className="px-3 py-1">{fmtFull(v)}</td>
                  {view.map((s) => <td key={s.key} className="px-3 py-1 text-right">{formatY(s.points[i]!.y)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
