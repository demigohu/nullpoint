// Scramble (DESIGN.md §6.2): text resolves left to right out of the current mode's glyphs,
// 6 updates a second. Never use it on amounts the user typed.
const STEP_MS = 1000 / 6;

export const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Current mode's glyph pair as scramble alphabet. */
export const modeGlyphs = () => (document.documentElement.dataset.mode === "park" ? "0" : "+−");

/** Resolves `el`'s text to `text`. Returns a cancel function. */
export function scramble(el: HTMLElement, text: string, { ms = 600, delay = 0, chars = modeGlyphs() } = {}) {
  if (reducedMotion() || document.documentElement.dataset.paused === "1") {
    el.textContent = text;
    return () => {};
  }
  let raf = 0, start = 0, lastStep = -1;
  const tick = (now: number) => {
    start ||= now + delay;
    const p = Math.min(1, Math.max(0, (now - start) / ms));
    const step = Math.floor((now - start) / STEP_MS);
    if (step !== lastStep && now >= start) {
      lastStep = step;
      const n = Math.floor(p * text.length);
      let out = text.slice(0, n);
      for (let i = n; i < text.length; i++) out += text[i] === " " ? " " : chars[(Math.random() * chars.length) | 0];
      el.textContent = out;
    }
    if (p < 1) raf = requestAnimationFrame(tick);
    else el.textContent = text;
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    el.textContent = text;
  };
}
