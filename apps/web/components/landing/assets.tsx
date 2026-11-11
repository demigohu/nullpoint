"use client";
// Three coins (DESIGN.md §7.5): a horizontal pan on desktop. Each card is drawn in its own
// asset's duotone, with live funding. Mobile: stacked.
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FieldCanvas } from "@/components/field/field-canvas";
import { MODES, modeOf } from "@/lib/modes";

gsap.registerPlugin(ScrollTrigger);

export type Radar = { symbol: string; aprNow: number; apr8h: number; oiUsd: number }[];
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(0)}M`);

export function Assets({ radar, active }: { radar: Radar; active: string | null }) {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const distance = () => track.current!.scrollWidth - innerWidth;
      const pan = gsap.to(track.current, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top top", end: () => `+=${distance()}`, pin: true, scrub: 0.8, invalidateOnRefresh: true },
      });
      gsap.utils.toArray<HTMLElement>(".asset-frame", track.current).forEach((f) =>
        gsap.fromTo(f, { y: 50, rotate: 1.5 }, { y: -50, rotate: -1.5, ease: "none", scrollTrigger: { trigger: f, containerAnimation: pan, start: "left right", end: "right left", scrub: true } }),
      );
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={root} className="overflow-hidden">
      <div ref={track} className="flex w-max flex-col gap-[var(--pad)] p-[var(--pad)] pt-28 max-md:w-full md:h-[100dvh] md:flex-row md:items-center">
        <div className="w-full md:w-[34vw] md:shrink-0">
          <h2 className="wdth-118 text-[clamp(2.2rem,4.6vw,5.4rem)] font-extrabold leading-[0.9] tracking-[-0.045em]">Three coins. The agent holds whichever pays best.</h2>
          <p className="mt-5 max-w-[44ch] text-[15px] leading-[1.5]">Live funding from Hyperliquid, as a yearly rate. It changes every hour and can go negative. When none of the three pays, the vault waits in USDC.</p>
        </div>
        {radar.map((r) => {
          const m = MODES[modeOf(r.symbol)];
          return (
            <article
              key={r.symbol}
              style={{ "--t": m.t, "--f": m.f } as React.CSSProperties}
              className="grid w-full gap-4 bg-fc p-[var(--pad)] text-tc md:h-[78dvh] md:w-[58vw] md:shrink-0 md:grid-cols-[1.1fr_1fr] md:items-center"
            >
              <figure className="asset-frame relative aspect-[3/4] w-full border border-tc max-md:aspect-square">
                <FieldCanvas mode={modeOf(r.symbol)} cell={20} speed={0.6} />
                <figcaption className="absolute -bottom-7 left-0 flex w-full justify-between font-mono text-[11px]">
                  <span className="chip">monitor {r.symbol}</span>
                  {r.symbol === active && <span className="chip">vault holds this</span>}
                </figcaption>
              </figure>
              <div className="max-md:mt-6">
                <h3 className="wdth-125 text-[clamp(3rem,7vw,8rem)] font-extrabold leading-[0.85] tracking-[-0.05em]">{r.symbol}</h3>
                <dl className="num mt-6 grid gap-3 border-t border-tc pt-4 text-[14px]">
                  <div className="flex justify-between gap-4"><dt>Funding now</dt><dd className="font-bold">{r.aprNow.toFixed(1)}% a year</dd></div>
                  <div className="flex justify-between gap-4"><dt>Last 8 hours</dt><dd>{r.apr8h.toFixed(1)}% a year</dd></div>
                  <div className="flex justify-between gap-4"><dt>Market size</dt><dd>{money(r.oiUsd)}</dd></div>
                </dl>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
