import { ImageResponse } from "next/og";
import { noise3 } from "@/components/field/field";
import { MODES } from "@/lib/modes";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "NullPoint: earn the fee traders pay to bet on crypto going up.";

const CELL = 30;

// A still, seeded field with the wordmark and headline. shortcut: default OG font, not Archivo; load the
// Archivo TTF here if the share card needs the brand face.
export default function OpengraphImage() {
  const { t, f } = MODES.btc;
  const cols = size.width / CELL, rows = Math.ceil(size.height / CELL);
  const cells = Array.from({ length: cols * rows }, (_, k) => noise3((k % cols) * 0.11, Math.floor(k / cols) * 0.11, 0.4) > 0);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexWrap: "wrap", background: f, position: "relative" }}>
        {cells.map((long, k) => (
          <div key={k} style={{ width: CELL, height: CELL, background: long ? t : f, color: long ? f : t, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
            {long ? "+" : "−"}
          </div>
        ))}
        <div style={{ position: "absolute", left: 60, bottom: 60, right: 60, display: "flex", flexDirection: "column", background: f, color: t, padding: 40, border: `2px solid ${t}` }}>
          <div style={{ display: "flex", fontSize: 96, letterSpacing: -4, lineHeight: 1 }}>
            <span style={{ fontWeight: 400 }}>null</span>
            <span style={{ fontWeight: 800 }}>Point</span>
          </div>
          <div style={{ fontSize: 40, marginTop: 20, lineHeight: 1.15 }}>Earn from crypto without betting on it.</div>
        </div>
      </div>
    ),
    size,
  );
}
