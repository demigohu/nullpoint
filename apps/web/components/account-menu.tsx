"use client";
// Wallet button and its menu (DESIGN.md §4): test USDC (testnet), color mode, animations, disconnect.
// Disconnected, the button connects directly and a small settings button holds mode and animations.
import { useEffect, useRef, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import { CaretDown, SlidersHorizontal } from "@phosphor-icons/react";
import type { Network } from "@nullpoint/core";
import { NETS, links } from "@/lib/config";
import { MODES, setMode, storedPreview, type Mode } from "@/lib/modes";

const ORDER: Mode[] = ["btc", "eth", "near", "park"];
const TGAS = (n: number) => String(n * 1e12);
export const seg = (on: boolean) => `h-[var(--hud)] px-3 font-mono text-[12px] tracking-[0.12em] uppercase ${on ? "bg-tc text-fc" : "text-tc"}`;

/** Tells open panels (balances in /app) that the wallet changed. */
export const announceBalances = () => window.dispatchEvent(new Event("np:balances"));

export function AccountMenu({ network, liveMode }: { network: Network; liveMode: Mode }) {
  const { signedAccountId, signIn, signOut, loading, callFunctionRaw } = useNearWallet();
  const [open, setOpen] = useState(false);
  const [mode, setLocal] = useState<Mode>(liveMode);
  const [paused, setPaused] = useState(false);
  const [mint, setMint] = useState<{ state: "busy" | "done" | "error"; text: string; hash?: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const net = NETS[network];

  // Restore a session preview and the pause choice after hydration.
  useEffect(() => {
    document.documentElement.dataset.live = liveMode;
    const p = storedPreview();
    pick(p && p !== liveMode ? p : null, false);
    setPaused(document.documentElement.dataset.paused === "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode]);

  // Close on outside click and Escape; return focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

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

  const mintUsdc = async () => {
    setMint({ state: "busy", text: "Confirm in your wallet…" });
    try {
      const r = await callFunctionRaw({ contractId: net.usdc, method: "mint", args: { account_id: signedAccountId, amount: "100000000" }, gas: TGAS(30) });
      setMint({ state: "done", text: "100 test USDC added to your wallet.", hash: r.transaction_outcome?.id });
      announceBalances();
    } catch (e) {
      const raw = (e as Error)?.message ?? "";
      setMint({ state: "error", text: /reject|cancel|denied|closed/i.test(raw) ? "You cancelled in your wallet. Nothing was sent." : `Mint failed: ${raw.slice(0, 120)}` });
    }
  };

  const account = signedAccountId && (signedAccountId.length > 22 ? `${signedAccountId.slice(0, 10)}…${signedAccountId.slice(-8)}` : signedAccountId);
  const item = "flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-mono text-[12px] uppercase tracking-[0.12em] hover:bg-tc hover:text-fc focus-visible:bg-tc focus-visible:text-fc focus-visible:outline-none";

  return (
    <div ref={root} className="relative">
      {signedAccountId ? (
        <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={`${seg(open)} flex items-center gap-2 border border-tc ${open ? "" : "bg-fc"} normal-case tracking-normal`}>
          {account}
          <CaretDown weight="bold" size={12} />
        </button>
      ) : (
        <div className="flex">
          <button onClick={() => signIn()} disabled={loading} className={`${seg(true)} border border-tc`}>Connect wallet</button>
          <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Display settings" className={`${seg(open)} flex items-center border border-l-0 border-tc ${open ? "" : "bg-fc"}`}>
            <SlidersHorizontal weight="bold" size={14} />
          </button>
        </div>
      )}

      {open && (
        <div role="menu" aria-label="Account and display" className="menu panel absolute right-0 top-full z-40 mt-2 w-[min(320px,calc(100vw-2*var(--pad)))] text-tc">
          {signedAccountId && network === "testnet" && (
            <div className="border-b border-tc">
              <button role="menuitem" onClick={mintUsdc} disabled={mint?.state === "busy"} className={item}>
                Get 100 test USDC <span aria-hidden>+</span>
              </button>
              <p className="px-4 pb-3 text-[12px] leading-[1.4]">
                {mint ? (
                  <span className={mint.state === "error" ? "text-alarm" : ""}>
                    {mint.text}{" "}
                    {mint.hash && <a href={links(net).tx(mint.hash)} target="_blank" rel="noreferrer" className="underline underline-offset-2">Transaction ↗</a>}
                  </span>
                ) : (
                  "Mints test USDC to your wallet. Testnet only, no real value. 1 transaction."
                )}
              </p>
            </div>
          )}

          <div className="border-b border-tc px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em]">Colors</p>
            <p className="mt-1 text-[12px] leading-[1.4]">They follow the coin the vault holds ({MODES[liveMode].label === "0" ? "parked" : MODES[liveMode].label}). Preview another:</p>
            <div role="radiogroup" aria-label="Color mode" className="mt-2 grid grid-cols-4 border border-tc">
              {ORDER.map((m) => (
                <button key={m} role="menuitemradio" aria-checked={mode === m} onClick={() => pick(m === liveMode ? null : m)} className={`${seg(mode === m)} px-0`}>
                  {MODES[m].label}
                </button>
              ))}
            </div>
          </div>

          <button role="menuitemcheckbox" aria-checked={!paused} onClick={togglePause} className={`${item} ${signedAccountId ? "border-b border-tc" : ""}`}>
            Animations <span>{paused ? "off" : "on"}</span>
          </button>

          {signedAccountId && (
            <button role="menuitem" onClick={() => { setOpen(false); signOut(); }} className={item}>
              Disconnect <span className="normal-case tracking-normal">{account}</span>
            </button>
          )}
        </div>
      )}
      <p aria-live="polite" className="sr-only">{announce}</p>
    </div>
  );
}
