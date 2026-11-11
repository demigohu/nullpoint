"use client";
// Landing only (DESIGN.md §6): Lenis smooth scroll driven by GSAP's ticker, so ScrollTrigger pins
// and scrubs stay in sync. Also feeds scroll velocity to the footer marquee.
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { reducedMotion } from "@/lib/scramble";

gsap.registerPlugin(ScrollTrigger);

export function Smooth() {
  // Pins are created by sibling components; order and measure them once all exist and fonts are in.
  useEffect(() => {
    const refresh = () => {
      ScrollTrigger.sort();
      ScrollTrigger.refresh();
    };
    const raf = requestAnimationFrame(refresh);
    document.fonts.ready.then(refresh);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (reducedMotion()) return;
    const lenis = new Lenis({ lerp: 0.085, anchors: true });
    const raf = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    lenis.on("scroll", (l: Lenis) => {
      ScrollTrigger.update();
      const m = document.querySelector<HTMLElement>(".marquee")?.getAnimations()[0];
      if (m) m.playbackRate = (l.velocity < 0 ? -1 : 1) * (1 + Math.min(Math.abs(l.velocity) * 0.12, 6));
    });
    (window as { __lenis?: Lenis }).__lenis = lenis;
    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      delete (window as { __lenis?: Lenis }).__lenis;
    };
  }, []);
  return null;
}
