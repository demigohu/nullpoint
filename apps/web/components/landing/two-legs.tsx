"use client";
// Two legs (DESIGN.md §7.3): pinned; the field zooms out like an aerial view while the 30-day chart
// opens. BTC swings, the hedged line stays flat; readouts count both moves with the scroll.
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FieldCanvas } from "@/components/field/field-canvas";
import type { Field } from "@/components/field/field";
import { LineChart } from "@/components/line-chart";
import { reducedMotion } from "@/lib/scramble";

gsap.registerPlugin(ScrollTrigger);

type Point = { t: number; btc: number; hedged: number };
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`;

export function TwoLegs({ bt, longShare }: { bt: Point[]; longShare: number }) {
  const root = useRef<HTMLElement>(null);
  const field = useRef<Field | null>(null);
  const btcEl = useRef<HTMLSpanElement>(null);
  const vaultEl = useRef<HTMLSpanElement>(null);
  const btcMove = bt.at(-1)!.btc - 100, hedgedMove = bt.at(-1)!.hedged - 100;

  useEffect(() => {
    if (reducedMotion()) return;
    const el = root.current!;
    const mm = gsap.matchMedia();
    mm.add("(min-width: 768px)", () => {
      ScrollTrigger.create({
        trigger: el,
        start: "top top",
        end: "+=160%",
        pin: true,
        scrub: true,
        onUpdate: ({ progress: p }) => {
          field.current?.setCell(64 - 50 * p);
          btcEl.current!.textContent = pct(btcMove * p);
          vaultEl.current!.textContent = pct(hedgedMove * p, 2);
        },
      });
      gsap.fromTo(".legs-chart", { clipPath: "inset(50% 0 50% 0)" }, { clipPath: "inset(0% 0 0% 0)", ease: "none", scrollTrigger: { trigger: el, start: "top top", end: "+=110%", scrub: true } });
    });
    mm.add("(max-width: 767px)", () => {
      gsap.from(".legs-chart", { clipPath: "inset(50% 0 50% 0)", duration: 1.2, ease: "expo.inOut", scrollTrigger: { trigger: ".legs-chart", start: "top 75%" } });
    });
    return () => mm.revert();
  }, [btcMove, hedgedMove]);

  return (
    <section ref={root} className="relative min-h-[100dvh] overflow-hidden">
      <FieldCanvas longShare={longShare} speed={0.35} cell={64} onReady={(f) => (field.current = f)} />
      <div className="relative grid min-h-[100dvh] content-center items-stretch gap-[var(--pad)] p-[var(--pad)] pt-28 md:grid-cols-12">
        <div className="panel p-[var(--pad)] md:col-span-5">
          <h2 className="wdth-118 text-[clamp(2.2rem,4.2vw,5rem)] font-extrabold leading-[0.9] tracking-[-0.045em]">
            BTC {btcMove < 0 ? "fell" : "rose"} {Math.abs(btcMove).toFixed(1)}% in 30 days. A hedged vault {hedgedMove < 0 ? "lost" : "made"} {Math.abs(hedgedMove).toFixed(2)}%.
          </h2>
          <p className="mt-5 max-w-[52ch] text-[clamp(16px,1.15vw,18px)] leading-[1.5]">
            Every dollar you deposit is split in two. About 67¢ buys BTC. The other 33¢ goes to Hyperliquid as collateral for a short of the same size,
            which is a bet that BTC falls. If BTC drops 10%, the BTC loses 6.7¢ and the short makes 6.7¢. Your dollar is still a dollar.
          </p>
          <aside className="mt-6 border-t border-tc pt-4">
            <p className="chip">Where the yield comes from</p>
            <p className="mt-3 max-w-[52ch] text-[15px] leading-[1.5]">
              On Hyperliquid, more traders bet on prices rising than falling, many of them with borrowed money. To keep that market close to the real
              price, the crowded side pays the other side every hour. That payment is called funding. NullPoint sits on the side that usually gets paid.
            </p>
          </aside>
        </div>
        <div className="legs-chart panel flex flex-col justify-center p-[var(--pad)] md:col-span-7">
          <div className="num mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[clamp(1.4rem,2.6vw,2.8rem)] font-bold leading-none tracking-[-0.04em]">
            <span>BTC <span ref={btcEl}>{pct(btcMove)}</span></span>
            <span>NullPoint <span ref={vaultEl}>{pct(hedgedMove, 2)}</span></span>
          </div>
          <LineChart
            baseline={100}
            series={[
              { key: "btc", label: "BTC", dashed: true, points: bt.map((p) => ({ x: p.t, y: p.btc })) },
              { key: "hedged", label: "NullPoint", points: bt.map((p) => ({ x: p.t, y: p.hedged })) },
            ]}
            caption="Simulated on the last 30 days of real Hyperliquid prices and funding, with the vault's two-thirds / one-third split. Fees not included."
          />
        </div>
      </div>
    </section>
  );
}
