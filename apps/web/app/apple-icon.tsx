import { ImageResponse } from "next/og";
import { MODES } from "@/lib/modes";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Same two cells as icon.svg: long (+) and short (−).
export default function AppleIcon() {
  const { t, f } = MODES.btc;
  const bar = (w: number, h: number, c: string) => <div style={{ width: w, height: h, background: c, position: "absolute" }} />;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: f }}>
        <div style={{ width: 90, height: 180, background: t, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          {bar(44, 14, f)}
          {bar(14, 44, f)}
        </div>
        <div style={{ width: 90, height: 180, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>{bar(44, 14, t)}</div>
      </div>
    ),
    size,
  );
}
