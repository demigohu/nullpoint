"use client";
// One cycle, four verbs (DESIGN.md §7.4): pinned on desktop; scroll walks the keeper's steps and
// the square field acts each one out. Mobile and reduced motion: the step in view is active.
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FieldCanvas } from "@/components/field/field-canvas";
import type { Field } from "@/components/field/field";
import { MODES, type Mode } from "@/lib/modes";
import { reducedMotion, scramble } from "@/lib/scramble";

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  ["Sweep", "New deposits move from the vault contract into its own NEAR Intents account."],
  ["Hedge", "The keeper opens a short on Hyperliquid, then buys the same amount of the coin through NEAR Intents. The short goes first, so the vault never holds a coin without its hedge."],
  ["Report", "The keeper reports both legs. The contract prices them with signed quotes and rejects any report that drifts more than 1% from what it expects."],
  ["Rotate", "When another coin pays clearly more, a model running in a secure enclave suggests a switch. Hard limits decide: 2 switches a day at most, 6 hours minimum per coin, and the extra fee must repay the switch cost within 7 days."],
] as const;

// What the square field does on each step.
const look = (step: number, next: Mode) =>
  [
    { longShare: 0.78, bordersOnly: false, mode: undefined },
    { longShare: 0.5, bordersOnly: false, mode: undefined },
    { longShare: 0.5, bordersOnly: true, mode: undefined },
    { longShare: 0.5, bordersOnly: false, mode: next },
  ][step]!;

export function Cycle({ liveMode }: { liveMode: Mode }) {
  const root = useRef<HTMLElement>(null);
  const field = useRef<Field | null>(null);
  const verb = useRef<HTMLSpanElement>(null);
  const [step, setStep] = useState(0);
  const order: Mode[] = ["btc", "eth", "near"];
  const next = order[(order.indexOf(liveMode) + 1) % 3]!;

  useEffect(() => {
    const el = root.current!;
    const bars = gsap.utils.toArray<HTMLElement>(".cycle-bar", el);
    const mm = gsap.matchMedia();
    mm.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      ScrollTrigger.create({
        trigger: el,
        start: "top top",
        end: "+=280%",
        pin: true,
        scrub: true,
        onUpdate: ({ progress }) => {
          const t = progress * 4.1;
          setStep(Math.min(3, Math.floor(t)));
          bars.forEach((b, i) => gsap.set(b, { scaleX: Math.min(1, Math.max(0, t - i)) }));
        },
      });
      gsap.from(".cycle-canvas", { clipPath: "inset(50% 50% 50% 50%)", duration: 1.4, ease: "expo.inOut", scrollTrigger: { trigger: el, start: "top 60%" } });
    });
    mm.add("(max-width: 767px), (prefers-reduced-motion: reduce)", () => {
      gsap.utils.toArray<HTMLElement>(".cycle-step", el).forEach((s, i) =>
        ScrollTrigger.create({ trigger: s, start: "top 60%", end: "bottom 40%", onToggle: (st) => st.isActive && setStep(i) }),
      );
    });
    return () => mm.revert();
  }, []);

  // Each step enters with its own gesture.
  useEffect(() => {
    if (step === 0 || step === 3) field.current?.wave();
    if (verb.current && !reducedMotion()) return scramble(verb.current, STEPS[step]![0].toLowerCase(), { ms: 400 });
  }, [step]);

  return (
    <section ref={root} className="relative grid min-h-[100dvh] content-center gap-[var(--pad)] p-[var(--pad)] pt-28 md:grid-cols-12">
      <div className="md:col-span-6">
        <h2 className="wdth-118 max-w-[16ch] text-[clamp(2.2rem,4.6vw,5.4rem)] font-extrabold leading-[0.9] tracking-[-0.045em]">
          A keeper runs the same four steps, over and over.
        </h2>
        <ol className="mt-8">
          {STEPS.map(([name, body], i) => (
            <li key={name} className="cycle-step border-t border-tc py-4">
              <div className="flex items-baseline gap-3">
                <span className={`font-mono text-[11px] ${i === step ? "chip" : "border border-tc px-2 py-1"}`}>0{i + 1}</span>
                <h3 className={`wdth-110 text-[clamp(1.5rem,2.2vw,2.6rem)] leading-none tracking-[-0.035em] ${i === step ? "font-extrabold" : "font-normal"}`}>{name}</h3>
              </div>
              <p className="mt-2 max-w-[56ch] text-[15px] leading-[1.5]">{body}</p>
              <i aria-hidden className="cycle-bar mt-3 block h-px origin-left scale-x-0 bg-tc max-md:hidden" />
            </li>
          ))}
        </ol>
      </div>
      <div className="md:col-span-6 md:col-start-7 md:self-center max-md:order-first">
        <div className="cycle-canvas relative aspect-square w-full border border-tc">
          <FieldCanvas {...look(step, next)} speed={step === 0 ? 1.6 : 0.6} cell={36} onReady={(f) => (field.current = f)} />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[12px]">
          <span ref={verb} className="chip">sweep</span>
          <span className="border border-tc px-2 py-1">
            0{step + 1} / 04{step === 3 ? ` · ${MODES[liveMode].label} → ${MODES[next].label}` : ""}
          </span>
        </div>
      </div>
    </section>
  );
}
