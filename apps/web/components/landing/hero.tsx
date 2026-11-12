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

      {/* Like the reference: the wordmark fills the bottom of the screen; the pitch sits in a panel at the top right. */}
      <div className="pointer-events-none relative flex min-h-[100dvh] flex-col gap-6 p-[var(--pad)] pt-28 lg:block">
        <div className="hero-panel hero-wipe pointer-events-auto panel p-[clamp(1rem,1.6vw,1.75rem)] lg:absolute lg:right-[var(--pad)] lg:top-28 lg:w-[min(32rem,38vw)]">
          <h1 className="wdth-112 text-balance text-[clamp(1.8rem,2.3vw,2.6rem)] font-extrabold leading-[0.95] tracking-[-0.04em]">
            Earn from crypto without betting on it.
          </h1>
          <p className="mt-3 text-[clamp(15px,1vw,16px)] leading-[1.5]">
            Deposit USDC. For every $1 of {coin} the vault holds, it bets $1 against it, so price swings cancel. Traders betting on {coin} going up pay
            that bet a fee every hour. You collect it.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/app" className="btn" data-label="Deposit USDC">Deposit USDC</Link>
            <Link href="/dashboard" className="btn btn-ghost" data-label="Watch it live">Watch it live</Link>
          </div>
        </div>

        <div aria-label="NullPoint" role="img" className="wdth-125 mt-auto leading-[0.8] tracking-[-0.05em] lg:absolute lg:bottom-[var(--pad)] lg:left-[var(--pad)]">
          {["null", "Point"].map((w, li) => (
            <div key={w} className={`hero-line-${li + 1} ${li ? "ml-[6vw] font-extrabold" : "font-normal"} w-fit overflow-hidden whitespace-nowrap bg-fc px-[0.04em] pb-[0.06em] text-[clamp(4rem,min(calc((100vw-2*var(--pad))/4.6),22dvh),21rem)] lg:text-[clamp(5rem,min(calc((100vw-2*var(--pad)-6vw)/3.3),calc((100dvh-8rem)*0.47)),28rem)]`}>
              {[...w].map((c, i) => (
                <span key={i} data-c={c} className="hero-char inline-block" aria-hidden>
                  {c}
                </span>
              ))}
            </div>
          ))}
        </div>

        <p className="hero-hint hero-wipe chip w-fit max-xl:hidden lg:absolute lg:bottom-[var(--pad)] lg:right-[var(--pad)]">click the grid · each + is a dollar long, each − a dollar short</p>
      </div>
    </section>
  );
}
