"use client";
// Loader (DESIGN.md §6.1): Δ counts down to zero, 7 bits fill, then the screen collapses like a
// CRT switching off. First visit of a session only; dispatches "np:ready" for the hero intro.
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { noise3 } from "@/components/field/field";
import { reducedMotion } from "@/lib/scramble";

const KEY = "np_loaded";

export function Loader() {
  const [show, setShow] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const core = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLPreElement>(null);
  const delta = useRef<HTMLSpanElement>(null);
  const bits = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const seen = document.documentElement.dataset.loaded === "1"; // set before paint by the layout
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {}
    // The hero intro plays only after the loader, never on repeat visits.
    const done = (intro: boolean) => {
      setShow(false);
      (window as { __npReady?: boolean }).__npReady = intro;
      window.dispatchEvent(new CustomEvent("np:ready", { detail: intro }));
    };
    if (seen || reducedMotion()) return done(false);

    const lenis = (window as { __lenis?: { stop(): void; start(): void } }).__lenis;
    lenis?.stop();
    const glyphs = document.documentElement.dataset.mode === "park" ? ["0", "0"] : ["+", "−"];
    let z = 0, alive = true;
    const field = () => {
      if (!alive || !bg.current) return;
      const cols = Math.ceil(innerWidth / 7.5), rows = Math.ceil(innerHeight / 15); // 13px mono ≈ 7.8px per glyph
      let s = "";
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) s += noise3(i * 0.09, j * 0.16, z) > 0 ? glyphs[0] : glyphs[1];
        s += "\n";
      }
      bg.current.textContent = s;
      z += 0.05;
      setTimeout(field, 50);
    };
    field();

    const start = (Math.random() * 0.08 + 0.02) * (Math.random() < 0.5 ? -1 : 1);
    const p = { v: 0 };
    const paint = () => {
      const d = start * (1 - p.v / 100);
      delta.current!.textContent = `${d < 0 ? "−" : "+"}${Math.abs(d).toFixed(3)}`;
      bits.current!.textContent = Math.round(p.v).toString(2).padStart(7, "0");
    };
    const tl = gsap.timeline({ onComplete: () => { alive = false; lenis?.start(); done(true); } });
    tl.to(p, { v: 72, duration: 1.1, ease: "power2.inOut", onUpdate: paint })
      .to(p, { v: 100, duration: 0.7, ease: "power3.inOut", onUpdate: paint }, "+=0.15")
      .to(core.current, { scaleY: 0, duration: 0.35, ease: "power3.in" })
      .to(root.current, { scaleY: 0.004, duration: 0.5, ease: "power4.in" }, "-=0.05")
      .to(root.current, { scaleX: 0, duration: 0.32, ease: "power3.in" });
    return () => {
      alive = false;
      tl.kill();
      lenis?.start();
    };
  }, []);

  if (!show) return null;
  return (
    <div ref={root} aria-hidden className="loader fixed inset-0 z-50 overflow-hidden bg-fc text-tc">
      <pre ref={bg} className="absolute inset-0 font-mono text-[13px] leading-[15px] text-dim" />
      <div ref={core} className="absolute inset-[18%_12%] flex flex-col items-center justify-center gap-6 bg-fc">
        <span ref={bits} className="font-mono text-sm tracking-[0.4em]">0000000</span>
        <p className="wdth-125 text-[clamp(3rem,14vw,12rem)] font-extrabold leading-none tracking-[-0.05em]">
          Δ<span ref={delta} className="num">+0.000</span>
        </p>
        <span className="font-mono text-xs">long + short = 0</span>
      </div>
    </div>
  );
}
