"use client";
// Global chrome (DESIGN.md §4): wordmark, links, network, the account menu (wallet, test USDC,
// colors, animations), the 7-bit scroll readout and the Δ readout. Identical on every page.
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useMotionValueEvent, useScroll } from "motion/react";
import type { Network } from "@nullpoint/core";
import type { Mode } from "@/lib/modes";
import { DOCS_URL } from "@/lib/config";
import { AccountMenu, seg } from "@/components/account-menu";

const LINKS = [
  { href: "/app", label: "Vault" },
  { href: "/dashboard", label: "Dashboard" },
  { href: DOCS_URL, label: "Docs" },
];

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wdth-112 tracking-[-0.02em] ${className}`}>
      <span className="font-normal">null</span>
      <span className="font-extrabold">Point</span>
    </span>
  );
}

export type HudLive = { symbol: string | null; delta: number; paused: boolean } | null;

export function Hud({ network, liveMode, live }: { network: Network; liveMode: Mode; live: HudLive }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);

  useEffect(() => setMenu(false), [path]);

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-[var(--pad)] max-lg:border-b max-lg:border-tc max-lg:bg-fc max-lg:py-3">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <Link href="/" className="bg-fc px-2 py-1 text-[17px] text-tc">
            <Wordmark />
          </Link>
          {live && path !== "/" && <Delta live={live} />}
        </div>
        <nav className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          <div className="hidden items-center gap-2 lg:flex">
            <div className="flex border border-tc bg-fc">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined} className={`${seg(path === l.href)} flex items-center`}>
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
          <AccountMenu network={network} liveMode={liveMode} />
          <button onClick={() => setMenu(true)} className={`${seg(false)} border border-tc bg-fc lg:hidden`} aria-expanded={menu} aria-controls="menu">
            Menu
          </button>
        </nav>
      </header>

      {menu && (
        <div id="menu" role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-0 z-40 flex flex-col gap-8 overflow-y-auto overscroll-contain bg-fc p-[var(--pad)] pt-24 text-tc"
          onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
          <button onClick={() => setMenu(false)} className={`${seg(false)} absolute right-[var(--pad)] top-[var(--pad)] border border-tc`} autoFocus>
            Close
          </button>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="wdth-118 text-5xl font-extrabold tracking-[-0.04em]">
              {l.label}
            </Link>
          ))}
        </div>
      )}

      <Bits />
    </>
  );
}

/** Scroll position as 7 bits on the right edge (DESIGN.md §4). */
function Bits() {
  const { scrollYProgress } = useScroll();
  const [pct, setPct] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setPct(Math.round(v * 100)));
  const bits = pct.toString(2).padStart(7, "0");
  return (
    <div aria-hidden className="pointer-events-none fixed right-[calc(var(--pad)/2)] top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center gap-[3px] bg-fc p-1 md:flex">
      {[...bits].map((b, i) => (
        <i key={i} className={`block size-[9px] border border-tc ${b === "1" ? "bg-tc" : ""}`} />
      ))}
      <span className="mt-1 font-mono text-[9px] [writing-mode:vertical-rl]">{String(pct).padStart(3, "0")}</span>
    </div>
  );
}

/** Spot minus short for the active coin; near zero means fully hedged. */
function Delta({ live }: { live: NonNullable<HudLive> }) {
  return (
    <div title="Coin held minus the short. Near zero means fully hedged." className={`px-2 py-1.5 font-mono text-[12px] max-sm:hidden ${live.paused ? "bg-alarm text-fc" : "panel"}`}>
      {live.paused ? "vault paused" : live.symbol ? `Δ ${live.delta >= 0 ? "+" : "−"}${Math.abs(live.delta).toFixed(4)} ${live.symbol}` : "Δ 0 · parked in USDC"}
    </div>
  );
}
