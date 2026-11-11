// Duotone modes (DESIGN.md §1). The live mode follows the vault's active asset; a visitor can
// preview another for the session. CSS owns the colors (globals.css); this file is for code that
// needs them outside CSS (canvas overrides, metadata images).
export type Mode = "btc" | "eth" | "near" | "park";

export const MODES: Record<Mode, { label: string; t: string; f: string; glyphs: [string, string] }> = {
  btc: { label: "BTC", t: "#FF5B14", f: "#0A0A0A", glyphs: ["+", "−"] },
  eth: { label: "ETH", t: "#2433FF", f: "#F2F1EC", glyphs: ["+", "−"] },
  near: { label: "NEAR", t: "#00E59B", f: "#0A0A0A", glyphs: ["+", "−"] },
  park: { label: "0", t: "#F2F1EC", f: "#0A0A0A", glyphs: ["0", "0"] },
};

export const modeOf = (symbol: string | null | undefined): Mode => {
  const m = symbol?.toLowerCase();
  return m === "btc" || m === "eth" || m === "near" ? m : "park";
};

/**
 * The coin the vault is committed to: the last accepted ROTATE/RESUME/PARK decision, BTC before any
 * (mirrors the agent's plan()). Positions alone would flicker to "parked" while a withdrawal briefly
 * closes the short.
 */
export const targetMode = (decisions: { accepted: boolean; action: string; target: string | null }[]): Mode => {
  const last = decisions.filter((d) => d.accepted && ["ROTATE", "RESUME", "PARK"].includes(d.action)).at(-1);
  return !last ? "btc" : last.action === "PARK" ? "park" : modeOf(last.target);
};

const PREVIEW_KEY = "np_preview";

/** Switches the page's duotone. `preview` is remembered for the session; null returns to live. */
export function setMode(mode: Mode | null) {
  const root = document.documentElement;
  const next = mode ?? (root.dataset.live as Mode);
  try {
    if (mode && mode !== root.dataset.live) sessionStorage.setItem(PREVIEW_KEY, mode);
    else sessionStorage.removeItem(PREVIEW_KEY);
  } catch {}
  root.dataset.mode = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", MODES[next].f);
  const icon = `data:image/svg+xml,${encodeURIComponent(iconSvg(next))}`;
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((l) => (l.href = icon));
}

/** The favicon in a mode's colors: two cells, long (+) and short (−). Same drawing as app/icon.svg. */
export function iconSvg(m: Mode) {
  const { t, f } = MODES[m];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${f}"/><rect x="1" y="1" width="15" height="30" fill="${t}"/><rect x="5" y="14.5" width="7" height="3" fill="${f}"/><rect x="7" y="12.5" width="3" height="7" fill="${f}"/><rect x="20" y="14.5" width="8" height="3" fill="${t}"/><rect x="0.5" y="0.5" width="31" height="31" fill="none" stroke="${t}"/></svg>`;
}

export const storedPreview = (): Mode | null => {
  try {
    const m = sessionStorage.getItem(PREVIEW_KEY);
    return m && m in MODES ? (m as Mode) : null;
  } catch {
    return null;
  }
};
