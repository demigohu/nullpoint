// Server-side reads. Everything shown on the site comes from the vault contract, the verifier,
// or Hyperliquid's public API; nothing is stored by the web app.
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { ASSETS, hlInfo, view, type Network } from "@nullpoint/core";
import { DEFAULT_NET, NET_COOKIE, NETS, type NetConfig } from "./config";
import { targetMode } from "./modes";

export async function currentNet(): Promise<NetConfig> {
  const n = (await cookies()).get(NET_COOKIE)?.value as Network | undefined;
  return NETS[n && n in NETS ? n : DEFAULT_NET];
}

export type VaultState = {
  owner: string;
  agent: string;
  config: { vault_address: string; usdc_token_id: string; verifier: string; mpc: string; mpc_path: string; oneclick_pubkey: string; hl_chain: string };
  params: { max_tvl: string; max_swap_usdc: string; max_slippage_bps: number; hedge_band_bps: number; max_report_drift_bps: number; max_price_age_s: number; max_nav_age_s: number; entry_fee_bps: number; exit_fee_bps: number; performance_fee_bps: number; treasury: string };
  assets: { symbol: string; token_id: string; price_in: string; price_out: string; price_ms: number }[];
  paused: boolean;
  total_shares: string;
  pending_usdc: string;
  owed_usdc: string;
  margin_net: string;
  positions: { symbol: string; size: string; entry_notional: string }[];
  account_value: string;
  snapshot: { nav: string; ms: number; usdc_in_verifier: string; spot: string[] } | null;
  signed_count: number;
  withdrawal_count: number;
};

export type Decision = { ms: number; hash: string; source: string; action: string; target: string | null; accepted: boolean; note: string; chat_id: string; signing_address: string };
export type Signed = { kind: string; payload: string; digest: string; signature: string | null; ms: number };
export type NavPoint = { ms: number; nav: string; total_shares: string };

const last = async <T,>(c: NetConfig, method: string, count: number, limit: number) =>
  (await view<[number, T][]>(c.network, c.vault, method, { from: String(Math.max(0, count - limit)), limit })).map(([id, x]) => ({ id, ...x }));

/** Everything the pages need, in one round of parallel reads (cached per request: the layout and the page share it). */
export const vaultOverview = cache(async (c: NetConfig) => {
  if (!c.deployed) return null;
  const state = await view<VaultState>(c.network, c.vault, "get_state");
  const [decisions, signed, nav, hl] = await Promise.all([
    view<[number, Decision][]>(c.network, c.vault, "get_decisions", { from: "0", limit: 500 }).then((d) => d.map(([id, x]) => ({ id, ...x }))),
    last<Signed>(c, "get_signed", state.signed_count, 200),
    view<[number, NavPoint][]>(c.network, c.vault, "get_nav_history", { from: "0", limit: 500 }).then((d) => d.map(([, x]) => x)),
    hlInfo(c.hlChain, { type: "clearinghouseState", user: state.config.vault_address }).catch(() => null),
  ]);
  const balances = state.snapshot?.spot ?? [];
  const spot = ASSETS.map((a, i) => {
    const st = state.assets.find((x) => x.symbol === a.symbol);
    const qty = BigInt(balances[i] ?? "0");
    const usdc = st && BigInt(st.price_in) > 0n ? (qty * BigInt(st.price_out)) / BigInt(st.price_in) : 0n;
    return { symbol: a.symbol, qty: Number(qty) / 10 ** a.decimals, usd: Number(usdc) / 1e6 };
  });
  const sharePrice = BigInt(state.total_shares) > 0n && state.snapshot ? Number(state.snapshot.nav) / Number(state.total_shares) : 1;
  // The two legs, for the field and the Δ readout.
  const shorts: { coin: string; szi: string; positionValue: string }[] = hl?.assetPositions?.map((p: { position: any }) => p.position) ?? [];
  const symbol = state.positions[0]?.symbol ?? null;
  const longUsd = spot.reduce((s, x) => s + x.usd, 0);
  const shortUsd = shorts.reduce((s, p) => s + Math.abs(Number(p.positionValue)), 0);
  const hedge = {
    mode: targetMode(decisions),
    symbol,
    longShare: longUsd + shortUsd > 0 ? longUsd / (longUsd + shortUsd) : 0.5,
    delta: symbol ? (spot.find((x) => x.symbol === symbol)?.qty ?? 0) + Number(shorts.find((p) => p.coin === symbol)?.szi ?? 0) : 0,
  };
  return { state, decisions, signed, nav, hl, spot, sharePrice, hedge };
});

export type Overview = NonNullable<Awaited<ReturnType<typeof vaultOverview>>>;

/** Live Hyperliquid funding for the allowlist (mainnet: real market data even before our launch). */
export async function fundingRadar(chain: "testnet" | "mainnet") {
  const [meta, ctxs] = await hlInfo<[{ universe: { name: string }[] }, { funding: string; openInterest: string; markPx: string }[]]>(chain, { type: "metaAndAssetCtxs" });
  const since = Date.now() - 8 * 3_600_000;
  return Promise.all(
    ASSETS.map(async (a) => {
      const i = meta.universe.findIndex((u) => u.name === a.hlCoin);
      const hist = await hlInfo<{ fundingRate: string }[]>(chain, { type: "fundingHistory", coin: a.hlCoin, startTime: since });
      const avg = hist.length ? hist.reduce((s, h) => s + Number(h.fundingRate), 0) / hist.length : Number(ctxs[i]!.funding);
      return {
        symbol: a.symbol,
        aprNow: Number(ctxs[i]!.funding) * 8760 * 100,
        apr8h: avg * 8760 * 100,
        oiUsd: Number(ctxs[i]!.openInterest) * Number(ctxs[i]!.markPx),
        mark: Number(ctxs[i]!.markPx),
      };
    }),
  );
}

/**
 * The hero chart: BTC vs a hedged position over the last 30 days, both indexed to 100.
 * Built from real Hyperliquid mainnet 4h closes and hourly funding. The hedged line assumes the
 * vault's 2x split (2/3 spot + equal short), so price moves cancel and only funding accrues.
 */
export async function hedgeBacktest(days = 30) {
  const end = Date.now(), start = end - days * 86_400_000;
  const candles = await hlInfo<{ t: number; c: string }[]>("mainnet", { type: "candleSnapshot", req: { coin: "BTC", interval: "4h", startTime: start, endTime: end } });
  const funding: { time: number; fundingRate: string }[] = [];
  for (let t = start; t < end; ) {
    const page = await hlInfo<{ time: number; fundingRate: string }[]>("mainnet", { type: "fundingHistory", coin: "BTC", startTime: t });
    if (!page.length) break;
    funding.push(...page);
    t = page.at(-1)!.time + 1;
    if (page.length < 500) break;
  }
  const p0 = Number(candles[0]!.c);
  let fi = 0, fundingIdx = 0;
  return candles.map((k) => {
    for (; fi < funding.length && funding[fi]!.time <= k.t; fi++) fundingIdx += Number(funding[fi]!.fundingRate) * (2 / 3) * 100;
    return { t: k.t, btc: (100 * Number(k.c)) / p0, hedged: 100 + fundingIdx };
  });
}
