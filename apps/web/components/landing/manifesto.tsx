"use client";
// Word scrub (DESIGN.md §6.5): the one long statement on the page lights up word by word.
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function Manifesto({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(ref.current!.querySelectorAll("span"), { opacity: 0.18 }, { opacity: 1, ease: "none", stagger: 0.1, scrollTrigger: { trigger: ref.current, start: "top 80%", end: "bottom 50%", scrub: true } });
    });
    return () => mm.revert();
  }, []);
  return (
    <p ref={ref} aria-label={text} className="wdth-110 max-w-[26ch] text-[clamp(1.8rem,3.6vw,4.2rem)] font-bold leading-[1.02] tracking-[-0.035em]">
      {text.split(" ").map((w, i) => (
        <span key={i} aria-hidden>
          {w}{" "}
        </span>
      ))}
    </p>
  );
}
