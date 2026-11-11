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
}

export const storedPreview = (): Mode | null => {
  try {
    const m = sessionStorage.getItem(PREVIEW_KEY);
    return m && m in MODES ? (m as Mode) : null;
  } catch {
    return null;
  }
};
