"use client";
// Deposit and withdraw. Every action says what will happen before you sign, shows progress while it
// runs, and leaves a receipt with the transaction (COPY.md "/app", DESIGN.md §5 Explainer).
import { useCallback, useEffect, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import type { NetConfig } from "@/lib/config";
import { links } from "@/lib/config";
import { ScrambleText } from "@/components/scramble-text";
import { Term } from "@/components/term";

type Withdrawal = { id: number; account: string; shares: string; usdc: string; status: string; signed_id: number | null; signedMs?: number };
type Receipt = { ok: boolean; title: string; next?: string; hash?: string; reason?: string };

const STUCK_MS = 10 * 60_000; // only then offer the self-serve fallback
const TGAS = (n: number) => String(n * 1e12);
const num = (raw: string | bigint | number, d = 6) => (Number(raw) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: 2 });
const usd = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Wallet and contract errors in plain words (COPY.md "Errors"); the raw reason stays visible. */
function explain(e: unknown): Receipt {
  const raw = (e as Error)?.message ?? String(e);
  if (/reject|cancel|denied|closed/i.test(raw)) return { ok: false, title: "You cancelled in your wallet. Nothing was sent." };
  if (/fetch|network|timeout/i.test(raw)) return { ok: false, title: "Couldn't reach NEAR. Your funds didn't move. Try again.", reason: raw.slice(0, 200) };
  const panic = raw.match(/panicked at[^:]*: ?(.*)|Smart contract panicked: (.*)|ExecutionError\W+(.*)/);
  return { ok: false, title: "The vault rejected this transaction.", reason: (panic?.slice(1).find(Boolean) ?? raw).slice(0, 200) };
}

export function VaultPanel({ net, sharePrice, navAgeS, maxNavAgeS, withdrawalCount }: {
  net: NetConfig; sharePrice: number; navAgeS: number | null; maxNavAgeS: number; withdrawalCount: number;
}) {
  const { signedAccountId, signIn, viewFunction, callFunctionRaw } = useNearWallet();
  const [usdc, setUsdc] = useState<string | null>(null);
  const [shares, setShares] = useState<string | null>(null);
  const [mine, setMine] = useState<Withdrawal[]>([]);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [withdrawShares, setWithdrawShares] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const navStale = navAgeS === null || navAgeS > maxNavAgeS;
  const L = links(net);

  const refresh = useCallback(async () => {
    if (!signedAccountId) return;
    const [b, s, w] = await Promise.all([
      viewFunction({ contractId: net.usdc, method: "ft_balance_of", args: { account_id: signedAccountId } }),
      viewFunction({ contractId: net.vault, method: "get_shares", args: { account_id: signedAccountId } }),
      viewFunction({ contractId: net.vault, method: "get_withdrawals", args: { from: "0", limit: Math.max(withdrawalCount + 20, 50) } }),
    ]);
    setUsdc(b as string);
    setShares(s as string);
    const own = (w as [number, Omit<Withdrawal, "id">][]).map(([id, x]) => ({ id, ...x })).filter((x) => x.account === signedAccountId).reverse();
    // When the payout was signed, so a stuck one can offer the self-serve fallback.
    await Promise.all(
      own.filter((x) => x.status === "signed" && x.signed_id !== null).map(async (x) => {
        const res = (await viewFunction({ contractId: net.vault, method: "get_signed", args: { from: String(x.signed_id), limit: 1 } })) as [number, { ms: number }][];
        x.signedMs = res[0]?.[1].ms;
      }),
    );
    setMine(own);
  }, [signedAccountId, viewFunction, net, withdrawalCount]);

  useEffect(() => {
    refresh().catch((e) => setReceipt(explain(e)));
  }, [refresh]);

  // The keeper settles withdrawals on its own; keep the list live while any is in flight.
  const inFlight = mine.some((w) => w.status !== "done");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => refresh().catch(() => {}), 10_000);
    return () => clearInterval(t);
  }, [inFlight, refresh]);

  const run = async (label: string, call: Parameters<typeof callFunctionRaw>[0], ok: Omit<Receipt, "ok" | "hash">) => {
    setBusy(label);
    setReceipt(null);
    try {
      const r = await callFunctionRaw(call);
      const failure = (r.receipts_outcome ?? []).map((o) => (o.outcome.status as { Failure?: unknown }).Failure).find(Boolean);
      if (failure) throw new Error(JSON.stringify(failure));
      setReceipt({ ok: true, ...ok, hash: r.transaction_outcome?.id ?? r.transaction?.hash });
      await refresh();
    } catch (e) {
      setReceipt(explain(e));
    } finally {
      setBusy(null);
    }
  };

  if (!signedAccountId) {
    return (
      <div className="panel p-[var(--pad)]">
        <p className="wdth-110 text-[clamp(1.4rem,2vw,2rem)] font-bold leading-tight tracking-[-0.03em]">Connect a NEAR {net.network} wallet to deposit.</p>
        <p className="mt-2 max-w-[48ch] text-[15px] leading-[1.5]">Connecting only shares your account name; nothing is sent or signed.</p>
        <button onClick={() => signIn()} className="btn mt-6" data-label="Connect wallet">Connect wallet</button>
      </div>
    );
  }

  const units = (v: string, d = net.usdcDecimals) => BigInt(Math.round(Number(v) * 10 ** d)).toString();
  const shareValue = shares ? (Number(shares) / 1e6) * sharePrice : 0;
  const balance = usdc === null ? null : Number(usdc) / 1e6;
  const depositAmount = Number(amount) || 0;
  const tooMuch = balance !== null && depositAmount > balance;
  const outShares = Number(withdrawShares) || 0;
  const outUsdc = outShares * sharePrice;
  const fieldClass = "num w-full border border-tc bg-fc px-4 py-3 text-[clamp(2rem,3.4vw,3.4rem)] leading-none tracking-[-0.03em] outline-none placeholder:text-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tc";

  return (
    <div className="grid gap-[var(--pad)]">
      <div className="panel p-[var(--pad)]">
        <p className="chip">Your value</p>
        <p className="num mt-3 text-[clamp(3rem,7vw,7rem)] font-bold leading-[0.9] tracking-[-0.04em]">
          $<ScrambleText text={shares === null ? "…" : usd(shareValue)} />
        </p>
        <p className="num mt-3 text-[14px]">
          {shares === null ? "…" : num(shares)} <Term k="share">shares</Term> at ${sharePrice.toFixed(4)} each · wallet {balance === null ? "…" : usd(balance)} USDC
        </p>
      </div>

      <div className="panel">
        <div role="tablist" aria-label="Action" className="grid grid-cols-2 border-b border-tc">
          {(["deposit", "withdraw"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setReceipt(null); }}
              className={`h-12 font-mono text-[13px] uppercase tracking-[0.2em] ${tab === t ? "bg-tc text-fc" : ""}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="p-[var(--pad)]">
          {tab === "deposit" ? (
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run("deposit", { contractId: net.usdc, method: "ft_transfer_call", args: { receiver_id: net.vault, amount: units(amount), msg: "" }, gas: TGAS(100), deposit: "1" }, {
                  title: `Deposited. ${amount} USDC is in the vault and about ${num(depositAmount / sharePrice, 0)} shares are in your account.`,
                  next: "Next, the keeper hedges it: a short on Hyperliquid, then the coin through NEAR Intents.",
                });
              }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="dep" className="chip">Amount (USDC)</label>
                <button type="button" onClick={() => balance !== null && setAmount(String(balance))} className="font-mono text-[12px] underline underline-offset-2">
                  Balance {balance === null ? "…" : usd(balance)} · MAX
                </button>
              </div>
              <input id="dep" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className={fieldClass} aria-describedby="dep-help" />
              <p id="dep-help" className={`text-[14px] leading-[1.5] ${tooMuch ? "text-alarm" : ""}`}>
                {navStale
                  ? "Deposits pause while the share price is more than 10 minutes old, so nobody buys in at an outdated price. The keeper refreshes it every cycle."
                  : tooMuch
                    ? `Your wallet has ${usd(balance!)} USDC. Lower the amount${net.network === "testnet" ? " or get test USDC below" : ""}.`
                    : depositAmount > 0
                      ? `You'll sign 1 transaction that sends ${amount} USDC to the vault contract (${net.vault}). You receive about ${num(depositAmount / sharePrice, 0)} shares at $${sharePrice.toFixed(4)} each.`
                      : "Enter how much USDC to put in. You get shares priced at the vault's current share price."}
              </p>
              <button disabled={!depositAmount || tooMuch || !!busy || navStale} className="btn mt-3 w-full" data-label={`Deposit ${amount || 0} USDC`}>
                {busy === "deposit" ? "Confirm in your wallet…" : `Deposit ${amount || 0} USDC`}
              </button>
            </form>
          ) : (
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run("withdraw", { contractId: net.vault, method: "request_withdraw", args: { shares: units(withdrawShares) }, gas: TGAS(30) }, {
                  title: `Withdrawal requested for ${withdrawShares} shares.`,
                  next: "The keeper frees the USDC and the contract pays your wallet, usually within 1-3 minutes. Track it below.",
                });
              }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="wd" className="chip">Shares to withdraw</label>
                <button type="button" onClick={() => shares && setWithdrawShares(String(Number(shares) / 1e6))} className="font-mono text-[12px] underline underline-offset-2">
                  You hold {shares === null ? "…" : num(shares)} · MAX
                </button>
              </div>
              <input id="wd" inputMode="decimal" autoComplete="off" value={withdrawShares} onChange={(e) => setWithdrawShares(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className={fieldClass} aria-describedby="wd-help" />
              <p id="wd-help" className="text-[14px] leading-[1.5]">
                {outShares > 0
                  ? `You'll sign 1 transaction asking the vault to buy back ${withdrawShares} shares, worth about $${usd(outUsdc)} at today's price. The keeper frees the USDC and the contract sends it to your wallet, usually within 1-3 minutes.`
                  : "Enter how many shares to sell back to the vault. USDC arrives in your wallet automatically."}
              </p>
              <button disabled={!outShares || !!busy || (shares !== null && outShares * 1e6 > Number(shares))} className="btn mt-3 w-full" data-label={`Withdraw $${usd(outUsdc)}`}>
                {busy === "withdraw" ? "Confirm in your wallet…" : `Withdraw $${usd(outUsdc)}`}
              </button>
            </form>
          )}

          {receipt && (
            <div role="status" className={`mt-6 border p-4 text-[14px] leading-[1.5] ${receipt.ok ? "border-tc" : "border-alarm text-alarm"}`}>
              <p className="font-bold">{receipt.title}</p>
              {receipt.next && <p className="mt-1">{receipt.next}</p>}
              {receipt.reason && <p className="num mt-2 break-all text-[12px]">Reason: {receipt.reason}</p>}
              {receipt.hash && (
                <a href={L.tx(receipt.hash)} target="_blank" rel="noreferrer" className="num mt-2 inline-block break-all text-[12px] underline underline-offset-2">
                  Transaction {receipt.hash.slice(0, 10)}…{receipt.hash.slice(-6)} ↗
                </a>
              )}
            </div>
          )}

          {net.network === "testnet" && (
            <div className="mt-8 border-t border-tc pt-4">
              <button
                onClick={() => run("faucet", { contractId: net.usdc, method: "mint", args: { account_id: signedAccountId, amount: "100000000" }, gas: TGAS(30) }, { title: "100 test USDC added to your wallet." })}
                disabled={!!busy}
                className="btn btn-ghost"
                data-label="Get 100 test USDC"
              >
                {busy === "faucet" ? "Confirm in your wallet…" : "Get 100 test USDC"}
              </button>
              <p className="mt-2 text-[13px] leading-[1.5]">Mints 100 test USDC to your wallet. It has no real value. 1 transaction.</p>
            </div>
          )}
        </div>
      </div>

      <div className="panel p-[var(--pad)]">
        <h2 className="chip">Your withdrawals</h2>
        {mine.length === 0 ? (
          <p className="mt-4 text-[14px]">No withdrawals yet. Requests show up here with each step as it happens.</p>
        ) : (
          <ul className="mt-4">
            {mine.map((w) => <WithdrawalRow key={w.id} w={w} busy={!!busy} onFinish={() => run(`exec${w.id}`, { contractId: net.vault, method: "execute_withdraw", args: { id: w.id }, gas: TGAS(200) }, { title: "Withdrawal paid to your wallet." })} />)}
          </ul>
        )}
        <a href={L.account(net.vault)} target="_blank" rel="noreferrer" className="mt-6 inline-block font-mono text-[12px] underline underline-offset-2">
          Vault contract on NearBlocks ↗
        </a>
      </div>
    </div>
  );
}

const STEPS = [
  ["requested", "The vault recorded your request and fixed the price."],
  ["signed", "NEAR's MPC network signed the payout. Anyone can now execute it."],
  ["paid", "USDC arrived in your wallet."],
] as const;

/** Status track: one square bit per step (DESIGN.md §5). */
function WithdrawalRow({ w, busy, onFinish }: { w: Withdrawal; busy: boolean; onFinish: () => void }) {
  const done = w.status === "done" ? 3 : w.status === "signed" ? 2 : 1;
  const stuck = w.status === "signed" && w.signedMs !== undefined && Date.now() - w.signedMs > STUCK_MS;
  return (
    <li className="border-t border-tc py-4">
      <p className="num text-[14px]">
        #{w.id} · {num(w.shares)} shares{w.usdc !== "0" && ` → $${num(w.usdc)}`}
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
              </span>
            </li>
          );
        })}
      </ol>
      {stuck && (
        <div className="mt-3 border border-alarm p-3 text-[13px] text-alarm">
          <p>This is taking longer than usual. You can finish it yourself: 1 transaction that executes the payout the contract already signed.</p>
          <button onClick={onFinish} disabled={busy} className="btn mt-3" data-label="Finish it myself">Finish it myself</button>
        </div>
      )}
    </li>
  );
}
