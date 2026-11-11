"use client";
// Global chrome (DESIGN.md §4): wordmark, links, mode switcher, network, wallet, pause, the 7-bit
// scroll readout and the Δ readout. Identical on every page.
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from "motion/react";
import { useNearWallet } from "near-connect-hooks";
import { Pause, Play } from "@phosphor-icons/react";
import type { Network } from "@nullpoint/core";
import { NET_COOKIE } from "@/lib/config";
import { MODES, setMode, storedPreview, type Mode } from "@/lib/modes";

const LINKS = [
  { href: "/app", label: "Vault" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/proof", label: "Proof" },
];
const ORDER: Mode[] = ["btc", "eth", "near", "park"];

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wdth-112 tracking-[-0.02em] ${className}`}>
      <span className="font-normal">null</span>
      <span className="font-extrabold">Point</span>
    </span>
  );
}

/** HUD controls lean toward a fine pointer (DESIGN.md §4). */
function Magnetic({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 300, damping: 30 });
  const y = useSpring(0, { stiffness: 300, damping: 30 });
  return (
    <motion.div
      style={{ x, y }}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * 0.25);
        y.set((e.clientY - r.top - r.height / 2) * 0.35);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

const seg = (on: boolean) => `h-[var(--hud)] px-3 font-mono text-[12px] tracking-[0.12em] uppercase ${on ? "bg-tc text-fc" : "text-tc"}`;

export type HudLive = { symbol: string | null; delta: number; paused: boolean } | null;

export function Hud({ network, liveMode, live }: { network: Network; liveMode: Mode; live: HudLive }) {
  const path = usePathname();
  const router = useRouter();
  const { signedAccountId, signIn, signOut, loading } = useNearWallet();
  const [mode, setLocal] = useState<Mode>(liveMode);
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState(false);
  const [announce, setAnnounce] = useState("");

  // Restore a session preview and the pause choice after hydration.
  useEffect(() => {
    document.documentElement.dataset.live = liveMode;
    const p = storedPreview();
    if (p && p !== liveMode) pick(p, false);
    else pick(null, false);
    setPaused(document.documentElement.dataset.paused === "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode]);

  useEffect(() => setMenu(false), [path]);

  function pick(m: Mode | null, say = true) {
    setMode(m);
    const next = m ?? liveMode;
    setLocal(next);
    if (say) setAnnounce(next === liveMode ? `Back to the live vault: ${MODES[next].label}` : `Previewing ${MODES[next].label}`);
  }

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    document.documentElement.dataset.paused = next ? "1" : "0";
    try {
      localStorage.setItem("np_paused", next ? "1" : "0");
    } catch {}
  };

  const setNet = (n: Network) => {
    document.cookie = `${NET_COOKIE}=${n}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  const account = signedAccountId && (signedAccountId.length > 22 ? `${signedAccountId.slice(0, 10)}…${signedAccountId.slice(-8)}` : signedAccountId);

  const modes = (
    <div role="group" aria-label="Color mode" className="flex border border-tc bg-fc">
      {ORDER.map((m) => (
        <button key={m} onClick={() => pick(m === liveMode ? null : m)} aria-pressed={mode === m} className={seg(mode === m)} title={m === liveMode ? "Live vault" : "Preview"}>
          {MODES[m].label}
        </button>
      ))}
    </div>
  );
  const net = (
    <div role="group" aria-label="Network" className="flex border border-tc bg-fc">
      {(["testnet", "mainnet"] as const).map((n) => (
        <button key={n} onClick={() => setNet(n)} aria-pressed={network === n} className={seg(network === n)}>
          {n}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-[var(--pad)]">
        <Link href="/" className="pointer-events-auto bg-fc px-2 py-1 text-[17px] text-tc">
          <Wordmark />
        </Link>
        <nav className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          <div className="hidden items-center gap-2 lg:flex">
            <div className="flex border border-tc bg-fc">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined} className={`${seg(path === l.href)} flex items-center`}>
                  {l.label}
                </Link>
              ))}
            </div>
            {net}
          </div>
          <Magnetic>{modes}</Magnetic>
          <div className="hidden sm:block">
            {account ? (
              <button onClick={() => signOut()} className={`${seg(false)} border border-tc bg-fc normal-case tracking-normal`} title="Disconnect">
                {account}
              </button>
            ) : (
              <button onClick={() => signIn()} disabled={loading} className={`${seg(true)} border border-tc`}>
                Connect
              </button>
            )}
          </div>
          <Magnetic>
            <button onClick={togglePause} aria-pressed={paused} aria-label={paused ? "Play animations" : "Pause animations"} className={`${seg(false)} flex items-center gap-1.5 border border-tc bg-fc`}>
              {paused ? <Play weight="bold" size={12} /> : <Pause weight="bold" size={12} />}
              {paused ? "play" : "pause"}
            </button>
          </Magnetic>
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
          <div className="mt-auto flex flex-wrap gap-2">
            {net}
            {account ? (
              <button onClick={() => signOut()} className={`${seg(false)} border border-tc normal-case tracking-normal`}>{account} · disconnect</button>
            ) : (
              <button onClick={() => signIn()} className={`${seg(true)} border border-tc`}>Connect</button>
            )}
          </div>
        </div>
      )}

      <Bits />
      {live && path !== "/" && <Delta live={live} />}
      <p aria-live="polite" className="sr-only">{announce}</p>
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
    <div className={`fixed bottom-[var(--pad)] right-[var(--pad)] z-20 hidden px-2 py-1.5 font-mono text-[12px] md:block ${live.paused ? "bg-alarm text-fc" : "panel"}`}>
      {live.paused ? "vault paused" : live.symbol ? `Δ ${live.delta >= 0 ? "+" : "−"}${Math.abs(live.delta).toFixed(4)} ${live.symbol}` : "Δ 0 · parked in USDC"}
    </div>
  );
}
