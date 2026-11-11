"use client";
// Hero (DESIGN.md §7.2, §6.3): live field, two-line wordmark whose lines drift apart on scroll
// (two legs moving opposite ways), headline panel. Intro plays once, after the loader.
import Link from "next/link";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FieldCanvas } from "@/components/field/field-canvas";
import type { Field } from "@/components/field/field";
import { reducedMotion, scramble } from "@/lib/scramble";

gsap.registerPlugin(ScrollTrigger);

const WORDS = ["null", "Point"];

export function Hero({ longShare }: { longShare: number }) {
  const root = useRef<HTMLElement>(null);
  const field = useRef<Field | null>(null);
  const base = useRef(0);

  useEffect(() => {
    const el = root.current!;
    const reduce = reducedMotion();
    const ctx = gsap.context(() => {
      const chars = gsap.utils.toArray<HTMLElement>(".hero-char", el);
      const intro = () => {
        const tl = gsap.timeline();
        tl.from(chars, { yPercent: 115, duration: 1.2, ease: "expo.out", stagger: 0.04 }, 0.1);
        chars.forEach((c, i) => tl.call(() => void scramble(c, c.dataset.c!, { ms: 800 }), [], 0.1 + i * 0.04));
        tl.from(".hero-wipe", { clipPath: "inset(0 100% 0 0)", duration: 0.9, ease: "expo.inOut", stagger: 0.05, clearProps: "clipPath" }, 0.35);
      };
      if (!reduce) {
        const ready = (window as { __npReady?: boolean }).__npReady;
        if (ready === true) intro();
        else if (ready === undefined) {
          gsap.set(chars, { yPercent: 115 });
          const on = (e: Event) => {
            gsap.set(chars, { yPercent: 0 });
            if ((e as CustomEvent<boolean>).detail) intro();
          };
          window.addEventListener("np:ready", on, { once: true });
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
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="relative min-h-[100dvh] overflow-hidden">
      <FieldCanvas longShare={longShare} interactive onReady={(f) => (field.current = f)} />

      <div className="pointer-events-none relative flex min-h-[100dvh] flex-col justify-end gap-6 p-[var(--pad)] pt-28">
        <div className="hero-panel hero-wipe pointer-events-auto panel max-w-[34rem] self-end p-[var(--pad)] md:absolute md:right-[var(--pad)] md:top-28">
          <h1 className="wdth-110 text-[clamp(1.6rem,2.4vw,2.6rem)] font-bold leading-[1.02] tracking-[-0.035em]">
            Deposit USDC. Collect the fee leveraged traders pay every hour.
          </h1>
          <p className="mt-4 max-w-[46ch] text-[clamp(16px,1.2vw,19px)] leading-[1.45]">
            The vault buys a coin and shorts the same amount. Price moves cancel. The fee is what&apos;s left.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/app" className="btn" data-label="Deposit USDC">Deposit USDC</Link>
            <Link href="/dashboard" className="btn btn-ghost" data-label="See it live">See it live</Link>
          </div>
        </div>

        <div aria-label="NullPoint" role="img" className="wdth-125 font-extrabold leading-[0.8] tracking-[-0.05em]">
          {WORDS.map((w, li) => (
            <div key={w} className={`hero-line-${li + 1} ${li ? "ml-[8vw]" : ""} w-fit overflow-hidden bg-fc px-[0.04em] pb-[0.06em] text-[clamp(4.5rem,calc((100vw-2*var(--pad))/4.6),22rem)] ${li ? "font-extrabold" : "font-normal"}`}>
              {[...w].map((c, i) => (
                <span key={i} data-c={c} className="hero-char inline-block" aria-hidden>
                  {c}
                </span>
              ))}
            </div>
          ))}
        </div>

        <p className="hero-hint hero-wipe chip w-fit">click the field: a ripple flips long and short</p>
      </div>
    </section>
  );
}
