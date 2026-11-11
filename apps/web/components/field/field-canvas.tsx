"use client";
import { useEffect, useRef } from "react";
import { MODES, type Mode } from "@/lib/modes";
import { Field, register } from "./field";

export type FieldProps = {
  /** Share of cells that are long (+): long notional / (long + short). */
  longShare?: number;
  speed?: number;
  cell?: number;
  /** Click or tap sends a ripple through the field. */
  interactive?: boolean;
  /** Draw this asset's duotone instead of the page's. */
  mode?: Mode;
  bordersOnly?: boolean;
  className?: string;
  /** Imperative access for scroll-driven pages (cell size, waves). */
  onReady?: (f: Field) => void;
};

const defaultCell = () => (innerWidth < 768 ? 22 : innerWidth < 1400 ? 28 : 32);

export function FieldCanvas({ longShare = 0.5, speed = 0.6, cell, interactive, mode, bordersOnly, className, onReady }: FieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const field = useRef<Field | null>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const f = new Field(canvas);
    f.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    field.current = f;
    const ro = new ResizeObserver(() => f.resize());
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => (f.visible = !!e?.isIntersecting));
    io.observe(canvas);
    // Glyphs follow the page mode (park shows 0) unless a fixed mode is given.
    const mo = new MutationObserver(() => {
      if (!field.current?.colors) f.glyphs = MODES[(document.documentElement.dataset.mode as Mode) ?? "park"].glyphs;
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
    const unregister = register(f);
    onReady?.(f);
    return () => {
      unregister();
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
    };
    // onReady is called once per mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const f = field.current!;
    f.longShare = Math.min(1, Math.max(0, longShare));
    f.speed = speed;
    f.bordersOnly = !!bordersOnly;
    f.colors = mode ? { t: MODES[mode].t, f: MODES[mode].f } : null;
    f.glyphs = MODES[mode ?? ((document.documentElement.dataset.mode as Mode) || "park")].glyphs;
    f.setCell(cell ?? defaultCell());
  }, [longShare, speed, bordersOnly, mode, cell]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={className ?? "absolute inset-0 h-full w-full"}
      onPointerDown={
        interactive
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              field.current?.ripple(e.clientX - r.left, e.clientY - r.top);
            }
          : undefined
      }
    />
  );
}
