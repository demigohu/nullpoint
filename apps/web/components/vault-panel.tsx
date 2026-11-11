"use client";
import { useCallback, useEffect, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import type { NetConfig } from "@/lib/config";
import { links } from "@/lib/config";

type Withdrawal = { id: number; account: string; shares: string; usdc: string; status: string; signed_id: number | null; signedMs?: number };
const STUCK_MS = 10 * 60_000; // only then offer the self-serve fallback
const TGAS = (n: number) => String(n * 1e12);
const fmt = (raw: string | bigint, d = 6) => (Number(raw) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function VaultPanel({ net, sharePrice, navAgeS, maxNavAgeS, withdrawalCount }: {
  net: NetConfig; sharePrice: number; navAgeS: number | null; maxNavAgeS: number; withdrawalCount: number;
}) {
  const { signedAccountId, signIn, viewFunction, callFunction } = useNearWallet();
  const [usdc, setUsdc] = useState<string | null>(null);
  const [shares, setShares] = useState<string | null>(null);
  const [mine, setMine] = useState<Withdrawal[]>([]);
  const [amount, setAmount] = useState("");
  const [withdrawShares, setWithdrawShares] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const navStale = navAgeS === null || navAgeS > maxNavAgeS;

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
    refresh().catch(() => setMsg({ ok: false, text: "Couldn't read balances." }));
  }, [refresh]);

  // The keeper settles withdrawals on its own; keep the list live while any is in flight.
  const inFlight = mine.some((w) => w.status !== "done");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => refresh().catch(() => {}), 10_000);
    return () => clearInterval(t);
  }, [inFlight, refresh]);

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message?.slice(0, 200) || "Transaction failed." });
    } finally {
      setBusy(null);
    }
  };

  if (!signedAccountId) {
    return (
      <div className="rounded-panel border border-line bg-surface p-8">
        <p className="text-lg font-medium">Connect a NEAR {net.network} wallet to deposit.</p>
        <p className="mt-1 text-text-2">You&apos;ll get vault shares priced off the contract&apos;s on-chain NAV.</p>
        <button onClick={() => signIn()} className="mt-6 rounded-control bg-accent px-5 py-2.5 font-medium text-accent-ink active:scale-[0.98]">
          Connect wallet
        </button>
      </div>
    );
  }

  const units = (v: string, d = net.usdcDecimals) => BigInt(Math.round(Number(v) * 10 ** d)).toString();
  const shareValue = shares ? (Number(shares) * sharePrice) / 1e6 : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="rounded-panel border border-line bg-surface p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <Field label="Wallet USDC" value={usdc === null ? "…" : fmt(usdc)} />
          <Field label="Your shares" value={shares === null ? "…" : fmt(shares)} />
          <Field label="Worth" value={shares === null ? "…" : `$${shareValue.toFixed(2)}`} />
        </div>

        <form
          className="mt-8 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("deposit", () => callFunction({ contractId: net.usdc, method: "ft_transfer_call", args: { receiver_id: net.vault, amount: units(amount), msg: "" }, gas: TGAS(100), deposit: "1" }), `Deposited ${amount} USDC.`);
          }}
        >
          <label htmlFor="dep" className="text-sm text-text-2">Deposit USDC</label>
          <div className="flex gap-2">
            <input id="dep" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00"
              className="num w-full rounded-control border border-line bg-bg px-3 py-2.5 placeholder:text-text-3 focus:outline-2 focus:outline-accent" />
            <button disabled={!Number(amount) || !!busy || navStale} className="rounded-control bg-accent px-5 font-medium text-accent-ink active:scale-[0.98] disabled:opacity-50">
              {busy === "deposit" ? "Confirm…" : "Deposit"}
            </button>
          </div>
          <p className="text-xs text-text-3">
            {navStale ? "Deposits are paused until the keeper posts a fresh NAV (the contract refuses stale prices)." : `Share price $${sharePrice.toFixed(4)} from the latest on-chain NAV.`}
          </p>
        </form>

        <form
          className="mt-8 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("withdraw", () => callFunction({ contractId: net.vault, method: "request_withdraw", args: { shares: units(withdrawShares) }, gas: TGAS(30) }), "Withdrawal started. USDC usually arrives in 1-3 minutes.");
          }}
        >
          <label htmlFor="wd" className="text-sm text-text-2">Withdraw shares</label>
          <div className="flex gap-2">
            <input id="wd" inputMode="decimal" value={withdrawShares} onChange={(e) => setWithdrawShares(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00"
              className="num w-full rounded-control border border-line bg-bg px-3 py-2.5 placeholder:text-text-3 focus:outline-2 focus:outline-accent" />
            <button type="button" onClick={() => shares && setWithdrawShares(String(Number(shares) / 1e6))} className="rounded-control border border-line px-3 text-sm text-text-2 hover:text-text">Max</button>
            <button disabled={!Number(withdrawShares) || !!busy} className="rounded-control border border-line px-5 font-medium hover:bg-surface-2 disabled:opacity-50">
              {busy === "withdraw" ? "Confirm…" : "Withdraw"}
            </button>
          </div>
          <p className="text-xs text-text-3">Usually arrives in 1-3 minutes. The keeper prices it off the on-chain NAV and the vault pays you directly.</p>
        </form>

        {net.network === "testnet" && (
          <button
            onClick={() => run("faucet", () => callFunction({ contractId: net.usdc, method: "mint", args: { account_id: signedAccountId, amount: "100000000" }, gas: TGAS(30) }), "Minted 100 test USDC.")}
            disabled={!!busy}
            className="mt-8 text-sm text-text-2 underline underline-offset-2 hover:text-text disabled:opacity-50"
          >
            {busy === "faucet" ? "Minting…" : "Get 100 test USDC"}
          </button>
        )}

        {msg && (
          <p role="status" className={`mt-4 text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>
            {msg.text}
          </p>
        )}
      </div>

      <div className="rounded-panel border border-line bg-surface p-6">
        <h2 className="font-medium">Your withdrawals</h2>
        {mine.length === 0 ? (
          <p className="mt-3 text-sm text-text-3">None yet. Requests show up here with their status.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {mine.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 rounded-control bg-surface-2 px-4 py-3 text-sm">
                <div>
                  <p className="num">{fmt(w.shares)} shares{w.usdc !== "0" && <span className="text-text-3"> → ${fmt(w.usdc)}</span>}</p>
                  <p className="text-xs text-text-3">{STATUS[w.status] ?? w.status}</p>
                </div>
                {w.status === "signed" && w.signedMs !== undefined && Date.now() - w.signedMs > STUCK_MS && (
                  <div className="text-right">
                    <p className="mb-1 text-xs text-text-3">Taking longer than usual?</p>
                    <button
                      onClick={() => run(`exec${w.id}`, () => callFunction({ contractId: net.vault, method: "execute_withdraw", args: { id: w.id }, gas: TGAS(200) }), "Withdrawal paid.")}
                      disabled={!!busy}
                      className="rounded-control border border-line px-3 py-1.5 font-medium hover:bg-surface disabled:opacity-50"
                    >
                      Finish it myself
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <a href={links(net).account(net.vault)} target="_blank" rel="noreferrer" className="mt-6 inline-block text-sm text-text-3 underline-offset-2 hover:text-text hover:underline">
          Vault contract on NearBlocks
        </a>
      </div>
    </div>
  );
}

const STATUS: Record<string, string> = {
  queued: "Queued, the keeper is pricing it",
  signed: "Signed, paying out",
  done: "Paid to your wallet",
  failed: "Retrying",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-text-3">{label}</p>
      <p className="num mt-1 text-2xl">{value}</p>
    </div>
  );
}
