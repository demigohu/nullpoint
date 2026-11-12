// NullPoint agent. Stateless: each cycle reads the vault and Hyperliquid, then converges.
//   1. report verified prices (1Click quotes; a mock on testnet, where NEAR Intents has no deployment)
//   2. strategist (LLM on NEAR AI Cloud, rule fallback) -> guardrail -> decision recorded on-chain
//   3. desired spot = all in the target asset (or USDC when parked); swap one capped step toward it
//   4. size each Hyperliquid short to its spot (agent wallet)
//   5. report the Hyperliquid side; the contract checks it and recomputes NAV
//   node src/index.ts [--once]
//   env: NETWORK (testnet | mainnet), AGENT_ACCOUNT/AGENT_PRIVATE_KEY (function-call key on the vault),
//        HL_AGENT_PRIVATE_KEY, NEAR_INTENTS_API_KEY (mainnet), SOLVER_ACCOUNT/SOLVER_PRIVATE_KEY (testnet
//        mock 1Click), OWNER, INTERVAL_S (60),
//        STRATEGIST_INTERVAL_MIN (30), NEARAI_API_KEY,
//        STRATEGIST=rule to skip the LLM; DEMO_FUNDING='{"NEAR":60}' and DEMO_MIN_HOLD_HOURS=0 to stage a rotation on testnet
import { readFileSync } from "node:fs";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import {
  ASSETS, LIMITS, assetBySymbol, guardrail, marginAction, mpcToIntentsSignature, ruleDecision,
  postSignedAction, signedMessage as msg, view, type Context, type Decision, type Market,
} from "@nullpoint/core";
import { askStrategist } from "@nullpoint/core/strategist";
import { assertRpcNetwork, signerFromEnv } from "./chain.ts";
import { NET, acquireLock, journal } from "./journal.ts";

const MAINNET = NET === "mainnet";
const OWNER = process.env.OWNER ?? (MAINNET ? "nullpoint.near" : "nullpoint.testnet");
const VAULT = `vault.${OWNER}`;
const VERIFIER = MAINNET ? "intents.near" : `verifier.${OWNER}`;
const oneclick = MAINNET ? await import("./oneclick.ts") : await import("./mock1click.ts");
const agent = signerFromEnv(NET, "AGENT");
const DEFAULT_TARGET = "BTC";
// The vault's leverage is set by the split (margin = equity / (L + 1)). The venue setting only sets the
// initial margin per order; at L itself every dollar of margin is already used and no order fits.
const VENUE_LEVERAGE = 5;
const MIN_TRADE_USDC = 12_000_000n; // Hyperliquid rejects orders under $10, so spot moves in hedgeable chunks
const STRAY_MIN_USDC = 10_500_000n; // leftover of a non-target asset worth moving: its short can still be closed (>$10)
const MAX_WITHDRAWALS_PER_CYCLE = 5; // each needs an MPC signature (~15s)
const WITHDRAW_PULL_EXTRA_USDC = 1_000_000n; // covers the 0.2 USDC Hyperliquid withdrawal fee + quote slippage
const MARGIN_TOL_USDC = 5_000_000n; // margin drift tolerated before moving USDC (1Click minimum is 0.5)
const PRICE_SAMPLE_USDC = 1_000_000n; // quote ~1 USDC worth of each asset for pricing
const ROTATION_COST_BPS = 40; // swap (~30 bps) + closing and opening shorts (~2 x 4.5 bps)
const STRATEGIST_EVERY_MS = Number(process.env.STRATEGIST_INTERVAL_MIN ?? 30) * 60_000;
const RECORD_HOLD_EVERY_MS = 3 * 3_600_000; // HOLDs are recorded on-chain at most this often
// HOLDs are only recorded on-chain every few hours, so the cadence is tracked in memory too.
let lastStrategistRunMs = 0;
const DEMO_FUNDING: Record<string, number> = JSON.parse(process.env.DEMO_FUNDING ?? "{}");
const LIMITS_USED = { ...LIMITS, ...(process.env.DEMO_MIN_HOLD_HOURS ? { minHoldHours: Number(process.env.DEMO_MIN_HOLD_HOURS) } : {}) };

const hlAgent = privateKeyToAccount(
  (process.env.HL_AGENT_PRIVATE_KEY || JSON.parse(readFileSync(new URL(`../../../.keys/${MAINNET ? "mainnet/" : ""}hl-agent.json`, import.meta.url), "utf8")).privateKey) as `0x${string}`,
);
const transport = new HttpTransport({ isTestnet: !MAINNET });
const info = new InfoClient({ transport });
const exchange = new ExchangeClient({ transport, wallet: hlAgent });

const agentCall = (method: string, args: object, gas = 100) => agent.call(VAULT, method, args, { gas });
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Hyperliquid market data for the current cycle, used by every order the agent places.
let market: { vault: string; meta: Awaited<ReturnType<typeof info.metaAndAssetCtxs>>[0]; mark: (coin: string) => number };

/**
 * Changes the short in `coin` by `delta` coins (+ = short more, - = buy back) with an IOC order.
 * Returns false when the change is below Hyperliquid's $10 minimum (nothing to do), unless `split`:
 * then it overshoots by one minimum order and takes it back, so a small but real hedge gap still
 * closes. Throws if the venue rejects the order, so callers can avoid changing spot without the
 * matching hedge.
 */
async function adjustShort(coin: string, delta: number, { split = false } = {}): Promise<boolean> {
  if (delta < 0) {
    // Buying back can't exceed the open short (a reduce-only order would be rejected).
    const st = await retry(() => info.clearinghouseState({ user: market.vault }));
    const open = -Number(st.assetPositions.find((x) => x.position.coin === coin)?.position.szi ?? 0);
    delta = -Math.min(-delta, Math.max(open, 0));
  }
  const idx = market.meta.universe.findIndex((u) => u.name === coin);
  const szDec = market.meta.universe[idx]!.szDecimals;
  const size = Math.floor(Math.abs(delta) * 10 ** szDec) / 10 ** szDec;
  if (size * market.mark(coin) < 10) {
    if (!split || size === 0) return false;
    // Short leg first, so the buy-back always has an open short to reduce.
    const pad = Math.ceil((10.5 / market.mark(coin)) * 10 ** szDec) / 10 ** szDec;
    if (delta > 0) {
      await adjustShort(coin, size + pad);
      await adjustShort(coin, -pad);
    } else {
      await adjustShort(coin, pad);
      await adjustShort(coin, -(size + pad));
    }
    return true;
  }
  const isBuy = delta < 0;
  const leverage = Math.min(VENUE_LEVERAGE, market.meta.universe[idx]!.maxLeverage);
  await retry(() => exchange.updateLeverage({ asset: idx, isCross: true, leverage }));
  const px = market.mark(coin) * (isBuy ? 1.01 : 0.99);
  const res = await retry(
    () => exchange.order({
      orders: [{ a: idx, b: isBuy, p: Number(px.toPrecision(5)).toFixed(Math.max(0, 6 - szDec)).replace(/\.?0+$/, ""), s: size.toFixed(szDec), r: isBuy, t: { limit: { tif: "Ioc" } } }],
      grouping: "na",
    }),
    { reads: false },
  );
  log(`${isBuy ? "reduced" : "shorted"} ${coin} ${size.toFixed(szDec)} ->`, JSON.stringify(res.response.data.statuses));
  return true;
}

/**
 * Retries network failures. Reads also retry timeouts; orders don't (`reads: false`), because a
 * timed-out order may have filled, and the hedge step reconciles sizes next cycle anyway.
 */
async function retry<T>(fn: () => Promise<T>, { tries = 4, reads = true } = {}): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const transient = String(e).includes("fetch failed") || (reads && /timed out/i.test(String(e)));
      if (i >= tries - 1 || !transient) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

type OnChainDecision = { ms: number; action: string; target: string | null; accepted: boolean; source: string };

/** Where the vault should be, derived from accepted decisions on-chain. */
function plan(decisions: OnChainDecision[], nowMs: number) {
  const moves = decisions.filter((d) => d.accepted && ["ROTATE", "RESUME", "PARK"].includes(d.action));
  const last = moves.at(-1);
  const lev = decisions.filter((d) => d.accepted && d.action === "SET_LEVERAGE").at(-1);
  return {
    target: last?.action === "PARK" ? null : (last?.target ?? DEFAULT_TARGET),
    heldSinceMs: last?.ms ?? 0,
    rotationsLast24h: moves.filter((d) => d.action === "ROTATE" && nowMs - d.ms < 86_400_000).length,
    leverage: lev ? Number(lev.target) : LIMITS.maxLeverage,
    lastStrategistMs: decisions.filter((d) => d.source !== "agent").at(-1)?.ms ?? 0,
    lastHoldRecordMs: decisions.filter((d) => d.action === "HOLD").at(-1)?.ms ?? 0,
    lastHoldSource: decisions.filter((d) => d.action === "HOLD").at(-1)?.source,
  };
}

async function markets(meta: any, ctxs: any[]): Promise<Market[]> {
  const since = Date.now() - 8 * 3_600_000;
  return Promise.all(
    ASSETS.map(async (a) => {
      const i = meta.universe.findIndex((u: { name: string }) => u.name === a.hlCoin);
      const hist = await retry(() => info.fundingHistory({ coin: a.hlCoin, startTime: since }));
      const avg = hist.length ? hist.reduce((s, h) => s + Number(h.fundingRate), 0) / hist.length : Number(ctxs[i].funding);
      const apr = (r: number) => r * 8760 * 100;
      return {
        symbol: a.symbol,
        fundingAprNow: DEMO_FUNDING[a.symbol] ?? apr(Number(ctxs[i].funding)),
        fundingApr8h: DEMO_FUNDING[a.symbol] ?? apr(avg),
        openInterestUsd: Math.round(Number(ctxs[i].openInterest) * Number(ctxs[i].markPx)),
      };
    }),
  );
}

async function decide(ctx: Context, mkts: Market[], p: ReturnType<typeof plan>) {
  let decision: Decision, source = "rule", hash = "0".repeat(64), chatId = "", signer = "";
  try {
    if (process.env.STRATEGIST === "rule") throw new Error("STRATEGIST=rule");
    if (!process.env.NEARAI_API_KEY) throw new Error("no NEARAI_API_KEY");
    const r = await askStrategist(process.env.NEARAI_API_KEY, ctx, mkts);
    if (!r.record.verified) throw new Error("strategist answer failed TEE signature check");
    ({ decision, hash } = r);
    source = "llm";
    chatId = r.record.chatId;
    signer = r.record.signature.signing_address;
  } catch (e) {
    log("strategist unavailable, rule fallback:", (e as Error).message);
    decision = ruleDecision(ctx, mkts, LIMITS_USED);
  }
  const g = guardrail(decision, ctx, mkts, LIMITS_USED);
  const accepted = g.ok;
  log(`${source} -> ${decision.action}${decision.target ? " " + decision.target : ""} (${decision.confidence}) ${accepted ? "ACCEPTED" : "REJECTED: " + (g as { reason: string }).reason}: ${decision.reasoning}`);
  // A HOLD from a different source (AI after rule, or back) is news, so it is recorded at once.
  if (decision.action !== "HOLD" || source !== p.lastHoldSource || ctx.nowMs - p.lastHoldRecordMs >= RECORD_HOLD_EVERY_MS) {
    const note = (accepted ? decision.reasoning : `rejected: ${(g as { reason: string }).reason} | ${decision.reasoning}`).slice(0, 280);
    const target = decision.action === "SET_LEVERAGE" ? String(decision.leverage) : (decision.target ?? null);
    await agentCall("report_decision", { decision: { ms: 0, hash, source, action: decision.action, target, accepted, note, chat_id: chatId, signing_address: signer } });
  }
}

/**
 * Moves funds through the vault: verified 1Click quote -> MPC signature -> deposit -> solver delivers.
 * Spot swaps and margin-out sign an Intents transfer (executed by the verifier); margin-in signs a
 * Hyperliquid sendAsset from the vault's master (posted to Hyperliquid).
 */
async function moveViaQuote(req: Record<string, unknown>) {
  const q = await oneclick.quote({ dry: false, swapType: "EXACT_INPUT", deadline: new Date(Date.now() + 10 * 60_000).toISOString(), ...req });
  // Hedge first: change the shorts for this swap before spot changes. If Hyperliquid refuses the
  // order, the swap never happens and the vault stays delta-neutral.
  const from = ASSETS.find((a) => a.tokenId === q.quoteRequest.originAsset);
  const to = ASSETS.find((a) => a.tokenId === q.quoteRequest.destinationAsset);
  if (from) await adjustShort(from.hlCoin, -Number(q.quote.amountIn) / 10 ** from.decimals);
  if (to) await adjustShort(to.hlCoin, Number(q.quote.minAmountOut) / 10 ** to.decimals);
  const dep = q.quote.depositAddress as string;
  journal.put(dep, { q, ms: Date.now() });
  const salt = await view<string>(NET, VERIFIER, "current_salt");
  const tx = await agentCall("sign_quote", { message: msg(q), signature: q.signature, salt_hex: salt }, 300);
  const { signed_count } = await view(NET, VAULT, "get_state");
  journal.update(dep, { signedId: signed_count - 1 });
  // Test hook for crash recovery: die after MPC signed, before the move executes.
  if (process.env.AGENT_TEST_CRASH_AFTER_SIGN === "1") process.exit(99);
  await settle(dep);
  return tx.tx;
}

type SignedItem = { kind: string; payload: string; signature: string | null; ms: number };

/**
 * Takes a journaled move from wherever it stopped to filled. Safe to repeat: an intent whose nonce
 * the verifier already used isn't resubmitted, Hyperliquid rejects a reused sendAsset nonce, and the
 * journal stops the (mock) solver from filling twice.
 */
async function settle(dep: string) {
  const m = journal.all()[dep];
  if (!m || m.filled) return;
  if (m.signedId === undefined) throw new Error(`move ${dep.slice(0, 10)} has no signature yet`);
  const [[, s]] = await view<[number, SignedItem][]>(NET, VAULT, "get_signed", { from: String(m.signedId), limit: 1 });
  if (!s.signature || s.signature === "error") throw new Error(`MPC did not sign move ${dep.slice(0, 10)}`);
  if (!m.executed) {
    if (s.kind === "hl_send_asset") {
      const res = await postSignedAction(NET, s.payload, s.signature);
      if (res?.status !== "ok" && !/nonce/i.test(JSON.stringify(res))) throw new Error(`Hyperliquid rejected the vault's sendAsset: ${JSON.stringify(res)}`);
    } else {
      const { signer_id, nonce, deadline } = JSON.parse(s.payload);
      const used = await view<boolean>(NET, VERIFIER, "is_nonce_used", { account_id: signer_id, nonce });
      if (!used) {
        if (Date.parse(deadline) < Date.now()) throw new Error(`signed intent for ${dep.slice(0, 10)} expired unexecuted; check margin records`);
        await oneclick.execute(VERIFIER, { standard: "erc191", payload: s.payload, signature: mpcToIntentsSignature(s.signature) });
      }
    }
    journal.update(dep, { executed: true });
  }
  const status = await oneclick.complete(VERIFIER, m.q);
  // A refund leaves the margin records off; the next report shows it, and the contract pauses if it's large.
  if (status !== "SUCCESS") log(`1Click move to ${dep.slice(0, 10)}… ended ${status}`);
  journal.update(dep, { filled: true });
}

/** Finishes moves an earlier run left half-done (crash, RPC failure between steps). */
async function resumeMoves() {
  for (const [dep, m] of Object.entries(journal.all())) {
    if (m.filled) continue;
    if (m.signedId === undefined) {
      // sign_quote may have landed without us learning its index: find the payload paying our
      // deposit address. Nothing after 3 minutes means it never landed.
      const { signed_count } = await view(NET, VAULT, "get_state");
      const recent = await view<[number, SignedItem][]>(NET, VAULT, "get_signed", { from: String(Math.max(0, signed_count - 20)), limit: 20 });
      const hit = recent.find(([, s]) => s.ms >= m.ms - 60_000 && s.payload.includes(dep));
      if (hit) journal.update(dep, { signedId: hit[0] });
      else {
        if (Date.now() - m.ms > 3 * 60_000) journal.update(dep, { filled: true }); // abandoned before signing
        continue;
      }
    }
    try {
      await settle(dep);
      log(`resumed move to ${dep.slice(0, 10)}…`);
    } catch (e) {
      log(`could not resume move to ${dep.slice(0, 10)}…:`, (e as Error).message.slice(0, 200));
    }
  }
  journal.prune(30 * 60_000);
}

async function cycle() {
  const state = await view(NET, VAULT, "get_state");
  const { vault_address: vaultAddress, usdc_token_id: usdcToken } = state.config;
  await resumeMoves();
  if (state.paused) return log("vault paused, skipping (owner must investigate and unpause)");
  if (BigInt(state.pending_usdc) > 0n) log("swept deposits, tx", (await agentCall("sweep", {}, 150)).tx);
  const side = { refundTo: vaultAddress, refundType: "INTENTS", recipient: vaultAddress, recipientType: "INTENTS", depositType: "INTENTS" };
  const nowMs = Date.now();

  // 1. prices: sell ~1 USDC worth of each asset for USDC
  const [meta, ctxs] = await retry(() => info.metaAndAssetCtxs());
  const mark = (coin: string) => Number(ctxs[meta.universe.findIndex((u) => u.name === coin)]!.markPx);
  const reportPrices = async () => {
    const quotes = await Promise.all(
      ASSETS.map((a) => {
        const amount = (PRICE_SAMPLE_USDC * 10n ** BigInt(a.decimals)) / BigInt(Math.round(mark(a.hlCoin) * 1e6));
        return oneclick.quote({ dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: a.tokenId, destinationAsset: usdcToken, amount: amount.toString(), deadline: new Date(Date.now() + 10 * 60_000).toISOString(), ...side });
      }),
    );
    await agentCall("report_prices", { quotes: quotes.map((r) => ({ message: msg(r), signature: r.signature })) });
    return Date.now();
  };
  let pricedMs = await reportPrices();

  // 2. strategist
  let p = plan(await view<[number, OnChainDecision][]>(NET, VAULT, "get_decisions", { from: "0", limit: 500 }).then((d) => d.map(([, x]) => x)), nowMs);
  if (nowMs - Math.max(p.lastStrategistMs, lastStrategistRunMs) >= STRATEGIST_EVERY_MS) {
    lastStrategistRunMs = nowMs;
    const mkts = await markets(meta, ctxs);
    log("funding 8h APR:", mkts.map((m) => `${m.symbol} ${m.fundingApr8h.toFixed(1)}% (OI $${(m.openInterestUsd / 1e6).toFixed(1)}M)`).join(", "));
    const ctx: Context = { active: p.target, heldSinceMs: p.heldSinceMs, nowMs, rotationsLast24h: p.rotationsLast24h, rotationCostBps: ROTATION_COST_BPS, allowlist: ASSETS.map((a) => a.symbol) };
    await decide(ctx, mkts, p);
    p = plan(await view<[number, OnChainDecision][]>(NET, VAULT, "get_decisions", { from: "0", limit: 500 }).then((d) => d.map(([, x]) => x)), nowMs);
  }

  market = { vault: vaultAddress, meta, mark };

  // 3. allocate: settle withdrawals, then one capped move toward
  //    margin = equity / (L+1) on Hyperliquid, spot = the rest in the target asset (or USDC when parked).
  const tokens = [usdcToken, ...ASSETS.map((a) => a.tokenId)];
  const readBalances = async () => (await view<string[]>(NET, VERIFIER, "mt_batch_balance_of", { account_id: vaultAddress, token_ids: tokens })).map(BigInt);
  let balances = await readBalances();
  let hl = await retry(() => info.clearinghouseState({ user: vaultAddress }));
  const cap = BigInt(state.params.max_swap_usdc);
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  const usdValue = (i: number) => (balances[i + 1]! * BigInt(Math.round(mark(ASSETS[i]!.hlCoin) * 1e6))) / 10n ** BigInt(ASSETS[i]!.decimals);
  const hlValue = BigInt(Math.round(Number(hl.marginSummary.accountValue) * 1e6));
  const hlFree = BigInt(Math.round(Number(hl.withdrawable) * 1e6));
  const idle = balances[0]! - BigInt(state.owed_usdc);
  const spotValue = ASSETS.reduce((s, _, i) => s + usdValue(i), 0n);
  const navPerShare = state.snapshot && BigInt(state.total_shares) > 0n ? Number(state.snapshot.nav) / Number(state.total_shares) : 1;
  const withdrawals = await view<[number, { shares: string; status: string }][]>(NET, VAULT, "get_withdrawals", { from: "0", limit: 500 });
  const queued = withdrawals.filter(([, w]) => w.status === "queued" || w.status === "failed");
  const reserve = queued.reduce((s, [, w]) => s + BigInt(Math.ceil(Number(w.shares) * navPerShare)), 0n);
  const equity = idle + spotValue + hlValue - reserve;
  const L = BigInt(p.leverage);
  const marginTarget = p.target && equity > 0n ? equity / (L + 1n) : 0n;
  const spotTarget = p.target && equity > 0n ? equity - marginTarget : 0n;
  const targetToken = p.target ? assetBySymbol(p.target).tokenId : usdcToken;
  const stray = ASSETS.findIndex((a, i) => a.tokenId !== targetToken && usdValue(i) >= STRAY_MIN_USDC);
  const ti = ASSETS.findIndex((a) => a.tokenId === targetToken);
  const swapSlip = { slippageTolerance: 50, ...side }; // within the contract's max_slippage_bps of the oracle price
  const hlUsdc = state.config.hl_usdc_asset as string;

  // Moves can fail (RPC, venue); the report in step 5 must still go out, or deposits stall on a stale NAV.
  try {
    // Withdrawals first: finish any signed-but-unexecuted payout (e.g. after a restart), then pay the
    // queue in order while idle USDC covers it. Whatever isn't covered becomes `reserve` above, so the
    // moves below unwind toward it and the rest is paid next cycle.
    for (const [id] of withdrawals.filter(([, w]) => w.status === "signed")) {
      try {
        log(`paid withdrawal #${id} (tx ${(await agentCall("execute_withdraw", { id }, 200)).tx})`);
      } catch (e) {
        log(`withdrawal #${id} execute failed, will re-sign:`, (e as Error).message.slice(0, 160));
      }
    }
    let budget = idle, paid = 0;
    for (const [id, w] of queued) {
      const value = BigInt(Math.ceil(Number(w.shares) * navPerShare));
      if (value > budget || paid >= MAX_WITHDRAWALS_PER_CYCLE) break; // FIFO: don't let small ones jump the line
      const salt = await view<string>(NET, VERIFIER, "current_salt");
      await agentCall("fulfill_withdraw", { id, salt_hex: salt }, 300);
      log(`paid withdrawal #${id} (tx ${(await agentCall("execute_withdraw", { id }, 200)).tx})`);
      budget -= value;
      paid++;
    }

    // USDC still missing for the first withdrawal the loop above couldn't pay.
    const nextQueued = queued[paid];
    const shortfall = nextQueued ? BigInt(Math.ceil(Number(nextQueued[1].shares) * navPerShare)) - budget : 0n;

    // Margin emergency: account value under 3x maintenance margin means a fast rally is eating the
    // short's margin. Top up from idle USDC, or shrink the position (sell spot; step 4 buys back the short).
    const maintenance = BigInt(Math.round(Number(hl.crossMaintenanceMarginUsed) * 1e6));
    const margin = marginAction({
      accountValue: Number(hlValue) / 1e6,
      maintenance: Number(maintenance) / 1e6,
      idleUsdc: Number(idle) / 1e6,
      spotUsd: ti >= 0 ? Number(usdValue(ti)) / 1e6 : 0,
      minTradeUsd: Number(MIN_TRADE_USDC) / 1e6,
    });

    if (paid > 0) {
      // State changed under the numbers above; rebalance next cycle.
    } else if (margin === "top_up") {
      const amount = min(idle, cap);
      log(`MARGIN LOW (account ${Number(hlValue) / 1e6} vs maintenance ${Number(maintenance) / 1e6}): sent ${Number(amount) / 1e6} USDC (sign tx ${await moveViaQuote({ originAsset: usdcToken, destinationAsset: hlUsdc, amount: amount.toString(), slippageTolerance: 100, ...side, recipientType: "DESTINATION_CHAIN" })})`);
    } else if (margin === "shrink") {
      const amount = balances[ti + 1]! / 4n;
      log(`MARGIN LOW, no idle USDC: selling a quarter of the ${p.target} spot to shrink the hedge (sign tx ${await moveViaQuote({ originAsset: targetToken, destinationAsset: usdcToken, amount: amount.toString(), ...swapSlip })})`);
    } else if (shortfall > 0n && hlFree >= shortfall + WITHDRAW_PULL_EXTRA_USDC) {
      // Raise USDC for the next queued withdrawal directly, ignoring rebalancing thresholds: otherwise a
      // shortfall split across both legs (each under its threshold) would leave the queue stuck.
      const amount6 = min(shortfall + WITHDRAW_PULL_EXTRA_USDC, cap);
      log(`pulled ${Number(amount6) / 1e6} USDC margin for withdrawal #${nextQueued![0]} (sign tx ${await moveViaQuote({
        originAsset: hlUsdc, destinationAsset: usdcToken, amount: (amount6 * 100n).toString(), slippageTolerance: 100,
        depositType: "ORIGIN_CHAIN", refundTo: vaultAddress, refundType: "ORIGIN_CHAIN", recipient: vaultAddress, recipientType: "INTENTS",
      })})`);
    } else if (shortfall > 0n && ti >= 0 && usdValue(ti) >= MIN_TRADE_USDC) {
      // Sell at least MIN_TRADE so step 4 can shrink the short by an order Hyperliquid accepts.
      const usd = min(shortfall > MIN_TRADE_USDC ? shortfall : MIN_TRADE_USDC, min(usdValue(ti), cap));
      const amount = (balances[ti + 1]! * usd) / usdValue(ti);
      log(`sold ${Number(usd) / 1e6} USDC of ${p.target} for withdrawal #${nextQueued![0]} (sign tx ${await moveViaQuote({ originAsset: targetToken, destinationAsset: usdcToken, amount: amount.toString(), ...swapSlip })})`);
    } else if (stray >= 0) {
      const value = usdValue(stray);
      // Capped swaps never leave a remainder too small to close on Hyperliquid: keep exactly STRAY_MIN back.
      const usd = value <= cap ? value : value - cap >= STRAY_MIN_USDC ? cap : value - STRAY_MIN_USDC;
      const amount = usd === value ? balances[stray + 1]! : (balances[stray + 1]! * usd) / value;
      log(`moved ${ASSETS[stray]!.symbol} -> ${p.target ?? "USDC"} (sign tx ${await moveViaQuote({ originAsset: ASSETS[stray]!.tokenId, destinationAsset: targetToken, amount: amount.toString(), ...swapSlip })})`);
    } else if (hlValue + MARGIN_TOL_USDC < marginTarget && idle >= MARGIN_TOL_USDC) {
      const amount = min(min(idle, marginTarget - hlValue), cap);
      log(`sent ${Number(amount) / 1e6} USDC margin to Hyperliquid (sign tx ${await moveViaQuote({ originAsset: usdcToken, destinationAsset: hlUsdc, amount: amount.toString(), slippageTolerance: 100, ...side, recipientType: "DESTINATION_CHAIN" })})`);
    } else if (ti >= 0 && usdValue(ti) + MIN_TRADE_USDC < spotTarget && idle >= MIN_TRADE_USDC) {
      const amount = min(min(idle, spotTarget - usdValue(ti)), cap);
      log(`bought ${p.target} with ${Number(amount) / 1e6} USDC (sign tx ${await moveViaQuote({ originAsset: usdcToken, destinationAsset: targetToken, amount: amount.toString(), ...swapSlip })})`);
    } else if (ti >= 0 && usdValue(ti) > spotTarget + MIN_TRADE_USDC) {
      const excess = usdValue(ti) - spotTarget;
      const amount = (balances[ti + 1]! * min(excess, cap)) / usdValue(ti);
      log(`sold ${p.target} for USDC (sign tx ${await moveViaQuote({ originAsset: targetToken, destinationAsset: usdcToken, amount: amount.toString(), ...swapSlip })})`);
    } else if (hlValue > marginTarget + MARGIN_TOL_USDC && hlFree >= MARGIN_TOL_USDC) {
      const amount6 = min(min(hlValue - marginTarget, hlFree), cap);
      log(`pulled ${Number(amount6) / 1e6} USDC margin from Hyperliquid (sign tx ${await moveViaQuote({
        originAsset: hlUsdc, destinationAsset: usdcToken, amount: (amount6 * 100n).toString(), slippageTolerance: 100,
        depositType: "ORIGIN_CHAIN", refundTo: vaultAddress, refundType: "ORIGIN_CHAIN", recipient: vaultAddress, recipientType: "INTENTS",
      })})`);
    }
  } catch (e) {
    log("allocation step failed:", (e as Error).message.slice(0, 240));
  }
  balances = await readBalances();

  // 4. hedge: short size per asset = spot held (trues up rounding and anything a failed move left,
  // e.g. an IOC short that only partly filled). Gaps outside the band close even below $10.
  hl = await retry(() => info.clearinghouseState({ user: vaultAddress }));
  const shortOf = (coin: string) => -Number(hl.assetPositions.find((x) => x.position.coin === coin)?.position.szi ?? 0);
  const gapOf = (i: number, a: (typeof ASSETS)[number]) => Number(balances[i + 1]!) / 10 ** a.decimals - shortOf(a.hlCoin);
  const outOfBand = (i: number, a: (typeof ASSETS)[number]) => {
    const spotUsd = (Number(balances[i + 1]!) / 10 ** a.decimals) * mark(a.hlCoin);
    return Math.abs(gapOf(i, a)) * mark(a.hlCoin) > (spotUsd * Number(state.params.hedge_band_bps)) / 10_000 + Number(state.params.dust_usdc) / 1e6;
  };
  try {
    for (const [i, a] of ASSETS.entries()) {
      await adjustShort(a.hlCoin, gapOf(i, a), { split: outOfBand(i, a) });
    }
  } catch (e) {
    log("hedge failed:", (e as Error).message);
  }

  // 5. report the Hyperliquid side
  hl = await retry(() => info.clearinghouseState({ user: vaultAddress }));
  const positions = hl.assetPositions
    .filter((x) => Number(x.position.szi) < 0)
    .map(({ position: x }) => {
      const a = ASSETS.find((y) => y.hlCoin === x.coin)!;
      const size = -Number(x.szi);
      return {
        symbol: a.symbol,
        size: BigInt(Math.round(size * 10 ** Math.min(a.decimals, 12))) * 10n ** BigInt(Math.max(0, a.decimals - 12)) + "",
        entry_notional: Math.round(size * Number(x.entryPx) * 1e6).toString(),
      };
    });
  const accountValue = Math.round(Number(hl.marginSummary.accountValue) * 1e6).toString();
  // Don't report a hedge we know is off: the contract would pause the vault. A stale NAV only holds
  // deposits until the next cycle fixes the hedge (e.g. Hyperliquid refusing orders under congestion).
  const offHedge = ASSETS.filter((a, i) => outOfBand(i, a));
  if (offHedge.length) return log(`hedge off for ${offHedge.map((a) => a.symbol).join(", ")}; not reporting until it's fixed`);
  // The contract rejects (and pauses on) a report priced older than max_price_age_s; a slow 1Click
  // settlement can eat most of that window, so reprice first.
  if (Date.now() - pricedMs > (Number(state.params.max_price_age_s) * 1000) / 2) pricedMs = await reportPrices();
  await agentCall("report_position", { positions, account_value: accountValue });
  const after = await view(NET, VAULT, "get_state");
  log(`NAV ${Number(after.snapshot?.nav ?? 0) / 1e6} USDC | target ${p.target ?? "PARKED"} | HL ${Number(accountValue) / 1e6} | ${JSON.stringify(positions)} | paused ${after.paused}`);
}

acquireLock();
await assertRpcNetwork(NET);
const once = process.argv.includes("--once");
do {
  try {
    await cycle();
  } catch (e) {
    log("cycle failed:", (e as Error).message);
    if (once) process.exitCode = 1;
  }
  if (!once) await new Promise((r) => setTimeout(r, Number(process.env.INTERVAL_S ?? 60) * 1000));
} while (!once);
