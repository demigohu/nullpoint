// The Field (DESIGN.md §3): a canvas of cells, each long (+) or short (−). Cell values come from
// 3D gradient noise; the long/short threshold is the quantile that makes exactly `longShare` of the
// cells long, so the picture is the vault's real balance. Framework-free; field-canvas.tsx wraps it.

// Improved Perlin noise, fixed seed so every visitor sees the same field.
const perm = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 1013904223;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + t * (b - a);
const grad = (h: number, x: number, y: number, z: number) => {
  const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
};
export function noise3(x: number, y: number, z: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X]! + Y, AA = perm[A]! + Z, AB = perm[A + 1]! + Z, B = perm[X + 1]! + Y, BA = perm[B]! + Z, BB = perm[B + 1]! + Z;
  return lerp(
    lerp(lerp(grad(perm[AA]! & 15, x, y, z), grad(perm[BA]! & 15, x - 1, y, z), u), lerp(grad(perm[AB]! & 15, x, y - 1, z), grad(perm[BB]! & 15, x - 1, y - 1, z), u), v),
    lerp(lerp(grad(perm[AA + 1]! & 15, x, y, z - 1), grad(perm[BA + 1]! & 15, x - 1, y, z - 1), u), lerp(grad(perm[AB + 1]! & 15, x, y - 1, z - 1), grad(perm[BB + 1]! & 15, x - 1, y - 1, z - 1), u), v),
    w,
  );
}

/** Value of `q` (0..1) within `values`. */
export function quantile(values: Float32Array, q: number) {
  const s = values.slice().sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))] ?? 0;
}

type Ripple = { x: number; y: number; start: number; line: boolean };
const RIPPLE_SPEED = 900; // css px per second

export class Field {
  cell = 28;
  speed = 0.6;
  longShare = 0.5;
  glyphs: [string, string] = ["+", "−"];
  /** Fixed colors instead of the page's --t/--f (monitors that show another asset). */
  colors: { t: string; f: string } | null = null;
  /** Draw glyphs only where long meets short. */
  bordersOnly = false;
  visible = true;
  /** Reduced motion: one still frame, no ripples. */
  still = false;
  frozen = false;

  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cols = 0;
  private rows = 0;
  private t = 0;
  private values = new Float32Array(0);
  private drawn = new Int8Array(0); // last drawn state per cell, -1 = force redraw
  private paint = "";
  private ripples: Ripple[] = [];

  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.setCell(this.cell, true);
  }

  setCell(cell: number, force = false) {
    if (!force && Math.abs(cell - this.cell) < 0.25) return;
    this.cell = cell;
    this.cols = Math.ceil(this.w / cell) + 1;
    this.rows = Math.ceil(this.h / cell) + 1;
    this.values = new Float32Array(this.cols * this.rows);
    this.drawn = new Int8Array(this.cols * this.rows).fill(-1);
  }

  /** Sends a ring out from (x, y) in css px; signs flip as it passes. */
  ripple(x: number, y: number) {
    if (this.still) return;
    this.ripples.push({ x, y, start: performance.now(), line: false });
  }

  /** A straight front sweeping left to right: the rotation event. */
  wave() {
    if (this.still) return;
    this.ripples.push({ x: 0, y: 0, start: performance.now(), line: true });
  }

  redraw() {
    this.drawn.fill(-1);
  }

  frame(dt: number, now: number) {
    if (!this.frozen) this.t += dt * this.speed * 0.12;
    const { cols, rows, cell, values } = this;
    // Sampled per cell index, so larger cells read as zooming in on the same pattern.
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) values[j * cols + i] = noise3(i * 0.11, j * 0.11, this.t);
    const thr = quantile(values, 1 - this.longShare);

    const style = this.colors ?? (() => {
      const cs = getComputedStyle(this.canvas);
      return { t: cs.getPropertyValue("--t"), f: cs.getPropertyValue("--f") };
    })();
    const paint = style.t + style.f + this.glyphs.join("") + this.bordersOnly;
    if (paint !== this.paint) {
      this.paint = paint;
      this.redraw();
    }

    const diag = Math.hypot(this.w, this.h);
    this.ripples = this.ripples.filter((r) => ((now - r.start) / 1000) * RIPPLE_SPEED < diag + cell * 4);
    const isLong = (i: number, j: number) => {
      let long = values[j * cols + i]! > thr;
      for (const r of this.ripples) {
        const front = ((now - r.start) / 1000) * RIPPLE_SPEED;
        const cx = i * cell + cell / 2, cy = j * cell + cell / 2;
        const d = r.line ? cx : Math.hypot(cx - r.x, cy - r.y);
        if (Math.abs(d - front) < cell * 1.5) long = !long;
      }
      return long;
    };

    const ctx = this.ctx, p = this.dpr, size = cell * p;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `500 ${size * 0.58}px ${getComputedStyle(document.body).getPropertyValue("--font-jb") || "monospace"}`;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const long = isLong(i, j);
        const edge = this.bordersOnly && ((i > 0 && isLong(i - 1, j) !== long) || (i < cols - 1 && isLong(i + 1, j) !== long) || (j > 0 && isLong(i, j - 1) !== long) || (j < rows - 1 && isLong(i, j + 1) !== long));
        const state = (long ? 1 : 0) | (edge ? 2 : 0);
        const k = j * cols + i;
        if (this.drawn[k] === state) continue;
        this.drawn[k] = state;
        // Exact cell box: overlapping a neighbour would leave its edge stale when only this cell redraws.
        const x = Math.floor(i * size), y = Math.floor(j * size);
        ctx.fillStyle = long ? style.t : style.f;
        ctx.fillRect(x, y, Math.floor((i + 1) * size) - x, Math.floor((j + 1) * size) - y);
        if (this.bordersOnly && !edge) continue;
        ctx.fillStyle = long ? style.f : style.t;
        ctx.fillText(this.glyphs[long ? 0 : 1], x + size / 2, y + size / 2 + size * 0.03);
      }
    }
  }
}

// One animation loop for every field on the page.
const fields = new Set<Field>();
let raf = 0, last = 0;
const loop = (now: number) => {
  const dt = Math.min(now - (last || now), 50) / 1000;
  last = now;
  const paused = document.documentElement.dataset.paused === "1";
  if (!document.hidden) for (const f of fields) if (f.visible) {
    f.frozen = paused || f.still;
    f.frame(dt, now);
  }
  raf = fields.size ? requestAnimationFrame(loop) : 0;
};
export function register(f: Field) {
  fields.add(f);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => void fields.delete(f);
}
