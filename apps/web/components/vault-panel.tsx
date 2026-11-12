"use client";
// Deposit and withdraw. Each action opens a review that simulates it against the chain (the same
// checks the contract runs), then the wallet signs, then a result read back from the chain
// (COPY.md "/app", DESIGN.md §5 Explainer). Test USDC lives in the account menu.
import { useCallback, useEffect, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import type { NetConfig } from "@/lib/config";
import { links } from "@/lib/config";
import { ScrambleText } from "@/components/scramble-text";
import { Term } from "@/components/term";
import { TxDialog, type TxSpec } from "@/components/tx-dialog";

type Withdrawal = { id: number; account: string; shares: string; usdc: string; status: string; signed_id: number | null; signedMs?: number };
type ChainState = { paused: boolean; total_shares: string; snapshot: { nav: string; ms: number } | null; params: { max_tvl: string; max_nav_age_s: number; entry_fee_bps: number; exit_fee_bps: number }; withdrawal_count: number };

const STUCK_MS = 10 * 60_000; // only then offer the self-serve fallback
const RECENT = 3; // withdrawals listed before "show older"
const TGAS = (n: number) => String(n * 1e12);
const fmt = (raw: bigint | string | number, d = 6) => (Number(raw) / 10 ** d).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ago = (s: number) => (s < 90 ? `${s}s ago` : `${Math.round(s / 60)} min ago`);
// Max fee at NEAR's minimum gas price (0.0001 NEAR per Tgas); unused gas is refunded.
// NEAR's minimum gas price is 0.0001 NEAR per Tgas; the wallet only charges what the call uses.
const fee = (tgas: number) => `less than ${(tgas * 0.0001).toFixed(3)} NEAR from your wallet. Most of it is usually refunded.`;
const gas = (tgas: number): [string, string] => ["Gas limit", `${tgas} Tgas`];

export function VaultPanel({ net, withdrawalCount }: { net: NetConfig; withdrawalCount: number }) {
  const { signedAccountId, signIn, viewFunction } = useNearWallet();
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [shares, setShares] = useState<bigint | null>(null);
  /** USDC put in and not yet taken out (the contract's cost basis) and the entry fees inside it; null on a contract without it. */
  const [basis, setBasis] = useState<{ deposited: bigint; entryCost: bigint } | null>(null);
  const [chain, setChain] = useState<ChainState | null>(null);
  const [mine, setMine] = useState<Withdrawal[]>([]);
  const [allShown, setAllShown] = useState(false);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [withdrawShares, setWithdrawShares] = useState("");
  const [tx, setTx] = useState<TxSpec | null>(null);
  const L = links(net);

  const read = useCallback(async () => {
    const [b, s, st] = await Promise.all([
      viewFunction({ contractId: net.usdc, method: "ft_balance_of", args: { account_id: signedAccountId } }) as Promise<string>,
      viewFunction({ contractId: net.vault, method: "get_shares", args: { account_id: signedAccountId } }) as Promise<string>,
      viewFunction({ contractId: net.vault, method: "get_state", args: {} }) as Promise<ChainState>,
    ]);
    return { usdc: BigInt(b), shares: BigInt(s), state: st };
  }, [viewFunction, net, signedAccountId]);

  const refresh = useCallback(async () => {
    if (!signedAccountId) return;
    const r = await read();
    setUsdc(r.usdc);
    setShares(r.shares);
    const h = (await viewFunction({ contractId: net.vault, method: "get_holding", args: { account_id: signedAccountId } }).catch(() => null)) as { deposited: string; entry_cost?: string } | null;
    setBasis(h ? { deposited: BigInt(h.deposited), entryCost: BigInt(h.entry_cost ?? 0) } : null);
    setChain(r.state);
    const w = (await viewFunction({ contractId: net.vault, method: "get_withdrawals", args: { from: "0", limit: Math.max(r.state.withdrawal_count, withdrawalCount) + 20 } })) as [number, Omit<Withdrawal, "id">][];
    const own = w.map(([id, x]) => ({ id, ...x })).filter((x) => x.account === signedAccountId).reverse();
    // When the payout was signed: a stuck one offers the self-serve fallback, and the time finds its transactions.
    await Promise.all(
      own.filter((x) => x.signed_id !== null).map(async (x) => {
        const res = (await viewFunction({ contractId: net.vault, method: "get_signed", args: { from: String(x.signed_id), limit: 1 } })) as [number, { ms: number }][];
        x.signedMs = res[0]?.[1].ms;
      }),
    );
    setMine(own);
  }, [signedAccountId, viewFunction, net, withdrawalCount, read]);

  useEffect(() => {
    refresh().catch(() => {});
    const on = () => refresh().catch(() => {});
    window.addEventListener("np:balances", on); // test USDC from the account menu, finished transactions
    return () => window.removeEventListener("np:balances", on);
  }, [refresh]);

  // The agent settles withdrawals on its own; keep the list live while any is in flight.
  const inFlight = mine.some((w) => w.status !== "done");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => refresh().catch(() => {}), 10_000);
    return () => clearInterval(t);
  }, [inFlight, refresh]);

  if (!signedAccountId) {
    return (
      <div className="panel p-[var(--pad)]">
        <p className="wdth-110 text-[clamp(1.4rem,2vw,2rem)] font-bold leading-tight tracking-[-0.03em]">Connect a NEAR {net.network} wallet to deposit.</p>
        <p className="mt-2 max-w-[48ch] text-[15px] leading-[1.5]">Connecting only shares your account name; nothing is sent or signed.</p>
        <button onClick={() => signIn()} className="btn mt-6" data-label="Connect wallet">Connect wallet</button>
      </div>
    );
  }

  const priceOf = (st: ChainState | null) => (st?.snapshot && BigInt(st.total_shares) > 0n ? Number(st.snapshot.nav) / Number(st.total_shares) : 1);
  const sharePrice = priceOf(chain);
  const units = (v: string) => BigInt(Math.round(Number(v) * 10 ** net.usdcDecimals));
  const depositUnits = Number(amount) > 0 ? units(amount) : 0n;
  const outUnits = Number(withdrawShares) > 0 ? units(withdrawShares) : 0n;

  const depositSpec = (): TxSpec => ({
    title: `Deposit ${fmt(depositUnits)} USDC into the vault`,
    confirm: "Sign in wallet",
    call: { contractId: net.usdc, method: "ft_transfer_call", args: { receiver_id: net.vault, amount: depositUnits.toString(), msg: "" }, gas: TGAS(100), deposit: "1" },
    signs: [
      ["Contract", `${net.usdc} (the USDC token)`],
      ["Method", "ft_transfer_call, which sends USDC to the vault and tells it to mint your shares"],
      ["Arguments", `receiver ${net.vault}, amount ${depositUnits} (${fmt(depositUnits)} USDC, 6 decimals)`],
      ["Attached", "1 yoctoNEAR (0.000000000000000000000001 NEAR). The token standard requires it as proof that a person signed."],
      gas(100),
    ],
    fee: fee(100),
    notes: [
      "Your shares arrive as soon as your wallet confirms. If the vault can't take the deposit, your USDC comes straight back.",
      "Within a minute, the agent puts the USDC to work. You can watch it on the dashboard.",
    ],
    simulate: async () => {
      // Same math and limits as the vault's ft_on_transfer.
      const { usdc, shares, state } = await read();
      const nav = BigInt(state.snapshot?.nav ?? 0), total = BigInt(state.total_shares);
      const cost = (depositUnits * BigInt(state.params.entry_fee_bps)) / 10_000n;
      const net = depositUnits - cost;
      const out = total === 0n ? net : nav > 0n ? (net * total) / nav : 0n;
      const age = state.snapshot ? Math.round((Date.now() - state.snapshot.ms) / 1000) : Infinity;
      const p = priceOf(state);
      return {
        summary: { give: `${fmt(depositUnits)} USDC`, get: `≈${fmt(out)} shares` },
        vaultFee: ["Deposit fee", `${fmt(cost)} USDC (${state.params.entry_fee_bps / 100}%). It pays for the swaps that put your money to work.`],
        checks: [
          { label: "You have the USDC", ok: usdc >= depositUnits, detail: `Your wallet holds ${fmt(usdc)} USDC.` },
          { label: "The vault is open", ok: !state.paused, detail: state.paused ? "The vault is paused, so it refuses deposits." : "It isn't paused." },
          { label: "The share price is fresh", ok: age <= state.params.max_nav_age_s, detail: Number.isFinite(age) ? `Updated ${ago(age)}. The contract won't take deposits on a price older than ${state.params.max_nav_age_s / 60} minutes.` : "There's no share price yet." },
          { label: "Under the vault's cap", ok: nav + depositUnits <= BigInt(state.params.max_tvl), detail: `The vault would hold $${fmt(nav + depositUnits)} of its $${fmt(state.params.max_tvl)} limit.` },
          { label: "You receive shares", ok: out > 0n, detail: `About ${fmt(out)} shares, at $${p.toFixed(4)} each, for ${fmt(net)} USDC after the deposit fee.` },
        ],
        changes: [
          { label: "Wallet USDC", before: fmt(usdc), after: fmt(usdc - depositUnits) },
          { label: "Your shares", before: fmt(shares), after: fmt(shares + out) },
          { label: "Your value", before: `$${fmt(Number(shares) * p, 6)}`, after: `$${fmt(Number(shares + out) * p, 6)}` },
        ],
      };
    },
    result: async () => {
      const before = shares ?? 0n;
      const r = await read();
      return {
        title: `Deposited. You received ${fmt(r.shares - before)} shares.`,
        changes: [
          { label: "Wallet USDC", before: fmt(usdc ?? 0n), after: fmt(r.usdc) },
          { label: "Your shares", before: fmt(before), after: fmt(r.shares) },
        ],
        next: "The agent hedges it within a minute or so. You can watch that happen on the dashboard.",
      };
    },
  });

  const withdrawSpec = (): TxSpec => ({
    title: `Withdraw ${fmt(outUnits)} shares`,
    confirm: "Sign in wallet",
    call: { contractId: net.vault, method: "request_withdraw", args: { shares: outUnits.toString() }, gas: TGAS(30) },
    signs: [
      ["Contract", `${net.vault} (the vault)`],
      ["Method", "request_withdraw, which hands your shares back and queues a USDC payout to you"],
      ["Arguments", `shares ${outUnits} (${fmt(outUnits)} shares, 6 decimals)`],
      ["Attached", "nothing"],
      gas(30),
    ],
    fee: fee(30),
    notes: [
      "Your shares leave your balance now. The USDC usually lands in your wallet within 1-3 minutes, priced when the agent pays you, so it can differ by a few cents.",
      "This is the only thing you sign. If the payout takes more than 10 minutes, a button appears so you can finish it yourself.",
    ],
    simulate: async () => {
      // Same check as the vault's request_withdraw.
      const { shares, state } = await read();
      const p = priceOf(state);
      const value = Number(outUnits) * p;
      const paid = value * (1 - state.params.exit_fee_bps / 10_000);
      return {
        summary: { give: `${fmt(outUnits)} shares`, get: `≈$${fmt(paid, 6)} USDC` },
        vaultFee: ["Withdrawal fee", `$${fmt(value - paid, 6)} (${state.params.exit_fee_bps / 100}%). It pays for selling your part of the coin and closing its short.`],
        checks: [
          { label: "You have the shares", ok: outUnits > 0n && outUnits <= shares, detail: `You hold ${fmt(shares)} shares.` },
          { label: "The vault is running", ok: !state.paused, detail: state.paused ? "The vault is paused, so the payout waits until it resumes." : "It isn't paused, so the agent will pick it up." },
        ],
        changes: [
          { label: "Your shares", before: fmt(shares), after: fmt(shares - outUnits) },
          { label: "USDC to your wallet", before: "0.00", after: `about ${fmt(paid, 6)}` },
        ],
      };
    },
    result: async () => {
      const w = (await viewFunction({ contractId: net.vault, method: "get_withdrawals", args: { from: "0", limit: 500 } })) as [number, Withdrawal][];
      const last = w.filter(([, x]) => x.account === signedAccountId).at(-1);
      return {
        title: `Withdrawal #${last?.[0] ?? "?"} queued for ${fmt(outUnits)} shares.`,
        next: "The agent picks it up next, then the USDC lands in your wallet. Follow each step under Your withdrawals.",
      };
    },
  });

  const finishSpec = (w: Withdrawal): TxSpec => ({
    title: `Finish withdrawal #${w.id} yourself`,
    confirm: "Sign in wallet",
    call: { contractId: net.vault, method: "execute_withdraw", args: { id: w.id }, gas: TGAS(200) },
    signs: [
      ["Contract", `${net.vault} (the vault)`],
      ["Method", "execute_withdraw, which submits the payout NEAR's signers already signed"],
      ["Arguments", `id ${w.id}`],
      ["Attached", "nothing"],
      gas(200),
    ],
    fee: fee(200),
    notes: ["The payout is already approved and can only go to you. Normally the agent sends it; this lets you send it yourself."],
    simulate: async () => ({
      summary: { give: "nothing", get: `${fmt(w.usdc)} USDC` },
      checks: [{ label: "The payout is signed", ok: w.status === "signed", detail: `Signed for ${fmt(w.usdc)} USDC to ${w.account}.` }],
      changes: [{ label: "Wallet USDC", before: fmt(usdc ?? 0n), after: fmt((usdc ?? 0n) + BigInt(w.usdc)) }],
    }),
    result: async () => ({ title: `Withdrawal #${w.id} paid: ${fmt(w.usdc)} USDC is in your wallet.` }),
  });

  const fieldClass = "num w-full border border-tc bg-fc px-4 py-3 text-[clamp(2rem,3.4vw,3.4rem)] leading-none tracking-[-0.03em] outline-none placeholder:text-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tc";
  const balanceHint = usdc === 0n ? (net.network === "testnet" ? " Your wallet is empty: open your account menu (top right) and get 100 test USDC." : " Your wallet has no USDC yet.") : "";

  return (
    <div className="grid gap-[var(--pad)]">
      <div className="panel p-[var(--pad)]">
        <p className="chip">Your value</p>
        <p className="num mt-3 text-[clamp(3rem,7vw,7rem)] font-bold leading-[0.9] tracking-[-0.04em]">
          $<ScrambleText text={shares === null ? "…" : fmt(Number(shares) * sharePrice, 6)} />
        </p>
        <p className="num mt-3 text-[14px]">
          {shares === null ? "…" : fmt(shares)} <Term k="share">shares</Term> × ${sharePrice.toFixed(4)} · in your wallet: {usdc === null ? "…" : fmt(usdc)} USDC
        </p>
        {basis !== null && basis.deposited > 0n && shares !== null && (() => {
          // Earnings count from the money that went to work: the deposit fee is shown on its own line.
          const working = Number(basis.deposited - basis.entryCost);
          const earned = Number(shares) * sharePrice - working;
          return (
            <p className="num mt-2 text-[14px]">
              You put in ${fmt(basis.deposited)}
              {basis.entryCost > 0n && <> · <Term k="deposit fee">deposit fee</Term> ${fmt(basis.entryCost)}</>} · {earned >= 0 ? "earned" : "down"} since{" "}
              <b>${fmt(Math.abs(earned), 6)}</b> ({((earned / working) * 100).toFixed(2)}%)
            </p>
          );
        })()}
      </div>

      <div className="panel">
        <div role="tablist" aria-label="Action" className="grid grid-cols-2 border-b border-tc">
          {(["deposit", "withdraw"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-12 font-mono text-[13px] uppercase tracking-[0.2em] ${tab === t ? "bg-tc text-fc" : ""}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="p-[var(--pad)]">
          {tab === "deposit" ? (
            <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); setTx(depositSpec()); }}>
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="dep" className="chip">Amount (USDC)</label>
                <button type="button" onClick={() => usdc !== null && setAmount(String(Number(usdc) / 1e6))} className="font-mono text-[12px] underline underline-offset-2">
                  Balance {usdc === null ? "…" : fmt(usdc)} · MAX
                </button>
              </div>
              <input id="dep" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className={fieldClass} aria-describedby="dep-help" />
              <p id="dep-help" className="text-[14px] leading-[1.5]">
                How much USDC to put in. You&apos;ll see exactly what happens, and what you get back, before your wallet asks you to sign anything.{balanceHint}
              </p>
              <button disabled={!depositUnits} className="btn mt-3 w-full" data-label="Review deposit">Review deposit</button>
            </form>
          ) : (
            <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); setTx(withdrawSpec()); }}>
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="wd" className="chip">Shares to withdraw</label>
                <button type="button" onClick={() => shares !== null && setWithdrawShares(String(Number(shares) / 1e6))} className="font-mono text-[12px] underline underline-offset-2">
                  You hold {shares === null ? "…" : fmt(shares)} · MAX
                </button>
              </div>
              <input id="wd" inputMode="decimal" autoComplete="off" value={withdrawShares} onChange={(e) => setWithdrawShares(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className={fieldClass} aria-describedby="wd-help" />
              <p id="wd-help" className="text-[14px] leading-[1.5]">
                {outUnits > 0n ? `Worth about $${fmt(Number(outUnits) * sharePrice * (1 - (chain?.params.exit_fee_bps ?? 0) / 10_000), 6)} at today's price, after the withdrawal fee. ` : "How many shares to cash out. "}The USDC lands in your wallet on its own, usually within 1-3 minutes.
              </p>
              <button disabled={!outUnits} className="btn mt-3 w-full" data-label="Review withdrawal">Review withdrawal</button>
            </form>
          )}
        </div>
      </div>

      <div className="panel p-[var(--pad)]">
        <h2 className="chip">Your withdrawals</h2>
        {mine.length === 0 ? (
          <p className="mt-4 text-[14px]">No withdrawals yet. When you make one, you can follow each step here.</p>
        ) : (
          <ul className="mt-4">
            {(allShown ? mine : mine.slice(0, RECENT)).map((w) => <WithdrawalRow key={w.id} w={w} txUrl={L.tx} onFinish={() => setTx(finishSpec(w))} />)}
          </ul>
        )}
        {mine.length > RECENT && (
          <button type="button" onClick={() => setAllShown(!allShown)} aria-expanded={allShown} className="mt-2 font-mono text-[12px] underline underline-offset-2">
            {allShown ? "Show the latest only" : `Show ${mine.length - RECENT} older`}
          </button>
        )}
        <a href={L.account(net.vault)} target="_blank" rel="noreferrer" className="mt-6 inline-block font-mono text-[12px] underline underline-offset-2">
          Vault contract on NearBlocks ↗
        </a>
      </div>

      <TxDialog net={net} spec={tx} onClose={() => setTx(null)} />
    </div>
  );
}

const STEPS = [
  ["requested", "Your shares are handed back and the payout is in line."],
  ["signed", "The agent priced it, and NEAR's signers signed the payout to you."],
  ["paid", "USDC arrived in your wallet."],
] as const;

/** Status track: one square bit per step (DESIGN.md §5). */
function WithdrawalRow({ w, txUrl, onFinish }: { w: Withdrawal; txUrl: (h: string) => string; onFinish: () => void }) {
  const done = w.status === "done" ? 3 : w.status === "signed" ? 2 : 1;
  const stuck = w.status === "signed" && w.signedMs !== undefined && Date.now() - w.signedMs > STUCK_MS;
  // The vault keeps when it signed, not the hashes: look up the signing and payout transactions.
  const [hashes, setHashes] = useState<(string | null)[]>([]);
  useEffect(() => {
    if (w.signedMs === undefined) return;
    const find = (q: string) => fetch(`/api/tx?ms=${w.signedMs}&${q}`).then((r) => r.json()).then((j: { hash: string | null }) => j.hash).catch(() => null);
    Promise.all([find("methods=fulfill_withdraw"), done === 3 ? find(`methods=execute_withdraw&id=${w.id}`) : null]).then(setHashes);
  }, [w.signedMs, w.id, done]);
  return (
    <li className="border-t border-tc py-4">
      <p className="num text-[14px]">
        #{w.id} · {fmt(w.shares)} shares{w.usdc !== "0" && ` → $${fmt(w.usdc)}`}
        {w.status === "failed" && <span className="text-alarm"> · retrying</span>}
      </p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {STEPS.map(([name, body], i) => {
          const state = i < done ? "done" : i === done ? "now" : "later";
          return (
            <li key={name} className="flex gap-2 text-[13px] leading-[1.4]">
              <i aria-hidden className={`mt-[3px] block size-[10px] shrink-0 border ${stuck && i === 2 ? "border-alarm" : "border-tc"} ${state === "done" ? "bg-tc" : state === "now" && !stuck ? "blink" : ""}`} />
              <span>
                <span className="font-mono text-[11px] uppercase tracking-[0.2em]">{name}</span>
                <span className="sr-only"> ({state === "done" ? "done" : state === "now" ? "in progress" : "waiting"})</span>
                {state === "done" && <span className="block">{body}</span>}
                {state === "done" && i > 0 && hashes[i - 1] && (
                  <a href={txUrl(hashes[i - 1]!)} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-[11px] underline underline-offset-2">
                    Transaction ↗
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {stuck && (
        <div className="mt-3 border border-alarm p-3 text-[13px] text-alarm">
          <p>This is taking longer than it should. You can finish it yourself with one transaction: it submits the payout the contract already signed.</p>
          <button onClick={onFinish} className="btn mt-3" data-label="Review and finish">Review and finish</button>
        </div>
      )}
    </li>
  );
}
