"use client";
import { useEffect, useRef } from "react";
import { scramble } from "@/lib/scramble";

/** A live value that scrambles into place whenever it changes (not on first render). */
export function ScrambleText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    return scramble(ref.current!, text, { ms: 400 });
  }, [text]);
  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
