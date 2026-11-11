"use client";
// Hero (DESIGN.md §7.2, §6.3): live field, two-line wordmark whose lines drift apart on scroll
// (two legs moving opposite ways), headline panel below. Intro plays once, after the loader.
import Link from "next/link";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FieldCanvas } from "@/components/field/field-canvas";
import type { Field } from "@/components/field/field";
import { reducedMotion, scramble } from "@/lib/scramble";

gsap.registerPlugin(ScrollTrigger);

export function Hero({ longShare, coin }: { longShare: number; coin: string }) {
  const root = useRef<HTMLElement>(null);
  const field = useRef<Field | null>(null);
  const base = useRef(0);

  useEffect(() => {
    const el = root.current!;
    const reduce = reducedMotion();
    let onReady: ((e: Event) => void) | null = null;
    const ctx = gsap.context(() => {
      const chars = gsap.utils.toArray<HTMLElement>(".hero-char", el);
      // fromTo, not from: if the intro is ever interrupted, the letters still end in place.
      const intro = () => {
        const tl = gsap.timeline();
        tl.fromTo(chars, { yPercent: 115 }, { yPercent: 0, duration: 1.2, ease: "expo.out", stagger: 0.04, overwrite: true }, 0.1);
        chars.forEach((c, i) => tl.call(() => void scramble(c, c.dataset.c!, { ms: 800 }), [], 0.1 + i * 0.04));
        tl.from(".hero-wipe", { clipPath: "inset(0 100% 0 0)", duration: 0.9, ease: "expo.inOut", stagger: 0.05, clearProps: "clipPath" }, 0.35);
      };
      if (!reduce) {
        const ready = (window as { __npReady?: boolean }).__npReady;
        if (ready === true) intro();
        else if (ready === undefined) {
          gsap.set(chars, { yPercent: 115 });
          onReady = (e: Event) => ctx.add(() => ((e as CustomEvent<boolean>).detail ? intro() : gsap.set(chars, { yPercent: 0 })));
          window.addEventListener("np:ready", onReady, { once: true });
        }
      }

      if (reduce) return;
      gsap
        .timeline({
          scrollTrigger: {
            trigger: el,
            start: "top top",
            end: "+=75%",
            pin: true,
            scrub: 0.6,
            onUpdate: (st) => {
              if (!field.current) return;
              base.current ||= field.current.cell;
              field.current.setCell(base.current * (1 + st.progress * 3.2));
            },
          },
        })
        .to(".hero-line-1", { xPercent: -14, ease: "none" }, 0)
        .to(".hero-line-2", { xPercent: 10, ease: "none" }, 0)
        .to(".hero-panel, .hero-hint", { autoAlpha: 0, y: -40, ease: "power1.in" }, 0);
    }, el);
    return () => {
      if (onReady) window.removeEventListener("np:ready", onReady);
      ctx.revert();
    };
  }, []);

  return (
    <section ref={root} className="relative min-h-[100dvh] overflow-hidden">
      <FieldCanvas longShare={longShare} interactive onReady={(f) => (field.current = f)} />

      <div className="pointer-events-none relative flex min-h-[100dvh] flex-col justify-end gap-[clamp(1.5rem,3vw,3rem)] p-[var(--pad)] pt-28">
        <div aria-label="NullPoint" role="img" className="wdth-125 leading-[0.8] tracking-[-0.05em]">
          {["null", "Point"].map((w, li) => (
            <div key={w} className={`hero-line-${li + 1} ${li ? "ml-[8vw] font-extrabold" : "font-normal"} w-fit overflow-hidden bg-fc px-[0.04em] pb-[0.06em] text-[clamp(4rem,min(calc((100vw-2*var(--pad))/4.8),20dvh),21rem)]`}>
              {[...w].map((c, i) => (
                <span key={i} data-c={c} className="hero-char inline-block" aria-hidden>
                  {c}
                </span>
              ))}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="hero-panel hero-wipe pointer-events-auto panel max-w-[38rem] p-[var(--pad)]">
            <h1 className="wdth-112 text-balance text-[clamp(2rem,3.4vw,3.6rem)] font-extrabold leading-[0.95] tracking-[-0.04em]">
              Earn from crypto without betting on it.
            </h1>
            <p className="mt-4 max-w-[50ch] text-[clamp(16px,1.15vw,18px)] leading-[1.5]">
              Deposit USDC. For every $1 of {coin} the vault holds, it bets $1 against it, so price swings cancel. Traders betting on {coin} going up pay
              that bet a fee every hour. You collect it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/app" className="btn" data-label="Deposit USDC">Deposit USDC</Link>
              <Link href="/dashboard" className="btn btn-ghost" data-label="Watch it live">Watch it live</Link>
            </div>
          </div>
          <p className="hero-hint hero-wipe chip w-fit max-md:hidden">click the grid · each + is a dollar long, each − a dollar short</p>
        </div>
      </div>
    </section>
  );
}
