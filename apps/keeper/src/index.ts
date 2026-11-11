// NullPoint keeper (testnet). Stateless: each cycle reads the vault and Hyperliquid, then converges.
//   1. report verified prices (1Click quotes; mock on testnet)
//   2. strategist (LLM on NEAR AI Cloud, rule fallback) -> guardrail -> decision recorded on-chain
//   3. desired spot = all in the target asset (or USDC when parked); swap one capped step toward it
//   4. size each Hyperliquid short to its spot (agent wallet)
//   5. report the Hyperliquid side; the contract checks it and recomputes NAV
//   node src/index.ts [--once]
//   env: KEEPER_ACCOUNT/KEEPER_PRIVATE_KEY (function-call key on the vault), HL_AGENT_PRIVATE_KEY,
//        SOLVER_ACCOUNT/SOLVER_PRIVATE_KEY (testnet mock 1Click), OWNER, INTERVAL_S (60),
//        STRATEGIST_INTERVAL_MIN (30), NEARAI_API_KEY,
//        STRATEGIST=rule to skip the LLM; DEMO_FUNDING='{"NEAR":60}' and DEMO_MIN_HOLD_HOURS=0 to stage a rotation on testnet
import { readFileSync } from "node:fs";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import {
  ASSETS, LIMITS, assetBySymbol, guardrail, mpcToIntentsSignature, ruleDecision,
  postSignedAction, signedMessage as msg, view, type Context, type Decision, type Market,
} from "@nullpoint/core";
import { askStrategist } from "@nullpoint/core/strategist";
import { signerFromEnv } from "./chain.ts";
import * as oneclick from "./mock1click.ts";

const NET = "testnet";
const OWNER = process.env.OWNER ?? "nullpoint.testnet";
const [VAULT, VERIFIER] = ["vault", "verifier"].map((p) => `${p}.${OWNER}`);
const keeper = signerFromEnv(NET, "KEEPER");
const solver = signerFromEnv(NET, "SOLVER"); // testnet: plays 1Click on the mock verifier
const DEFAULT_TARGET = "BTC";
const MIN_TRADE_USDC = 12_000_000n; // Hyperliquid rejects orders under $10, so spot moves in hedgeable chunks
const MAX_WITHDRAWALS_PER_CYCLE = 5; // each needs an MPC signature (~15s)
const MARGIN_TOL_USDC = 5_000_000n; // margin drift tolerated before moving USDC (1Click minimum is 0.5)
const PRICE_SAMPLE_USDC = 1_000_000n; // quote ~1 USDC worth of each asset for pricing
const ROTATION_COST_BPS = 40; // swap (~30 bps) + closing and opening shorts (~2 x 4.5 bps)
const STRATEGIST_EVERY_MS = Number(process.env.STRATEGIST_INTERVAL_MIN ?? 30) * 60_000;
const RECORD_HOLD_EVERY_MS = 3 * 3_600_000; // HOLDs are recorded on-chain at most this often
// HOLDs are only recorded on-chain every few hours, so the cadence is tracked in memory too.
let lastStrategistRunMs = 0;
const DEMO_FUNDING: Record<string, number> = JSON.parse(process.env.DEMO_FUNDING ?? "{}");
const LIMITS_USED = { ...LIMITS, ...(process.env.DEMO_MIN_HOLD_HOURS ? { minHoldHours: Number(process.env.DEMO_MIN_HOLD_HOURS) } : {}) };

const agent = privateKeyToAccount(
  (process.env.HL_AGENT_PRIVATE_KEY || JSON.parse(readFileSync(new URL("../../../.keys/hl-agent.json", import.meta.url), "utf8")).privateKey) as `0x${string}`,
);
const transport = new HttpTransport({ isTestnet: true });
const info = new InfoClient({ transport });
const exchange = new ExchangeClient({ transport, wallet: agent });

const keeperCall = (method: string, args: object, gas = 100) => keeper.call(VAULT, method, args, { gas });
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1 || !String(e).includes("fetch failed")) throw e;
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
    lastStrategistMs: decisions.filter((d) => d.source !== "keeper").at(-1)?.ms ?? 0,
    lastHoldRecordMs: decisions.filter((d) => d.action === "HOLD").at(-1)?.ms ?? 0,
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
  if (decision.action !== "HOLD" || ctx.nowMs - p.lastHoldRecordMs >= RECORD_HOLD_EVERY_MS) {
    const note = (accepted ? decision.reasoning : `rejected: ${(g as { reason: string }).reason} | ${decision.reasoning}`).slice(0, 280);
    const target = decision.action === "SET_LEVERAGE" ? String(decision.leverage) : (decision.target ?? null);
    await keeperCall("report_decision", { decision: { ms: 0, hash, source, action: decision.action, target, accepted, note, chat_id: chatId, signing_address: signer } });
  }
}

/**
 * Moves funds through the vault: verified 1Click quote -> MPC signature -> deposit -> (mock) solver fill.
 * Spot swaps and margin-out sign an Intents transfer (executed by the verifier); margin-in signs a
 * Hyperliquid sendAsset from the vault's master (posted to Hyperliquid).
 */
async function moveViaQuote(req: Record<string, unknown>) {
  const q = await oneclick.quote({ dry: false, swapType: "EXACT_INPUT", deadline: new Date(Date.now() + 10 * 60_000).toISOString(), ...req });
  const salt = await view<string>(NET, VERIFIER, "current_salt");
  const tx = await keeperCall("sign_quote", { message: msg(q), signature: q.signature, salt_hex: salt }, 300);
  const { signed_count } = await view(NET, VAULT, "get_state");
  const [[, s]] = await view(NET, VAULT, "get_signed", { from: String(signed_count - 1), limit: 1 });
  if (!s.signature || s.signature === "error") throw new Error(`MPC did not sign quote (tx ${tx.tx})`);
  if (s.kind === "hl_send_asset") {
    const res = await postSignedAction("testnet", s.payload, s.signature);
    if (res?.status !== "ok") throw new Error(`Hyperliquid rejected the vault's sendAsset: ${JSON.stringify(res)}`);
  } else {
    // Testnet: the vault-signed intent goes to the mock verifier (mainnet: 1Click /v0/submit-intent).
    await solver.call(VERIFIER, "execute_intents", { signed: [{ standard: "erc191", payload: s.payload, signature: mpcToIntentsSignature(s.signature) }] }, { gas: 100 });
  }
  await oneclick.fill(solver, VERIFIER, q);
  return tx.tx;
}

async function cycle() {
  const state = await view(NET, VAULT, "get_state");
  const { vault_address: vaultAddress, usdc_token_id: usdcToken } = state.config;
  if (state.paused) return log("vault paused, skipping");
  if (BigInt(state.pending_usdc) > 0n) log("swept deposits, tx", (await keeperCall("sweep", {}, 150)).tx);
  const side = { refundTo: vaultAddress, refundType: "INTENTS", recipient: vaultAddress, recipientType: "INTENTS", depositType: "INTENTS" };
  const nowMs = Date.now();

  // 1. prices: sell ~1 USDC worth of each asset for USDC
  const [meta, ctxs] = await retry(() => info.metaAndAssetCtxs());
  const mark = (coin: string) => Number(ctxs[meta.universe.findIndex((u) => u.name === coin)]!.markPx);
  const priceQuotes = await Promise.all(
    ASSETS.map((a) => {
      const amount = (PRICE_SAMPLE_USDC * 10n ** BigInt(a.decimals)) / BigInt(Math.round(mark(a.hlCoin) * 1e6));
      return oneclick.quote({ dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: a.tokenId, destinationAsset: usdcToken, amount: amount.toString(), deadline: new Date(nowMs + 10 * 60_000).toISOString(), ...side });
    }),
  );
  await keeperCall("report_prices", { quotes: priceQuotes.map((r) => ({ message: msg(r), signature: r.signature })) });

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
  const stray = ASSETS.findIndex((a, i) => a.tokenId !== targetToken && usdValue(i) >= MIN_TRADE_USDC);
  const ti = ASSETS.findIndex((a) => a.tokenId === targetToken);
  const swapSlip = { slippageTolerance: 50, ...side }; // within the contract's max_slippage_bps of the oracle price
  const hlUsdc = state.config.hl_usdc_asset as string;

  // Withdrawals first: finish any signed-but-unexecuted payout (e.g. after a restart), then pay the
  // queue in order while idle USDC covers it. Whatever isn't covered becomes `reserve` above, so the
  // moves below unwind toward it and the rest is paid next cycle.
  for (const [id] of withdrawals.filter(([, w]) => w.status === "signed")) {
    try {
      log(`paid withdrawal #${id} (tx ${(await keeperCall("execute_withdraw", { id }, 200)).tx})`);
    } catch (e) {
      log(`withdrawal #${id} execute failed, will re-sign:`, (e as Error).message.slice(0, 160));
    }
  }
  let budget = idle, paid = 0;
  for (const [id, w] of queued) {
    const value = BigInt(Math.ceil(Number(w.shares) * navPerShare));
    if (value > budget || paid >= MAX_WITHDRAWALS_PER_CYCLE) break; // FIFO: don't let small ones jump the line
    const salt = await view<string>(NET, VERIFIER, "current_salt");
    await keeperCall("fulfill_withdraw", { id, salt_hex: salt }, 300);
    log(`paid withdrawal #${id} (tx ${(await keeperCall("execute_withdraw", { id }, 200)).tx})`);
    budget -= value;
    paid++;
  }

  if (paid > 0) {
    // State changed under the numbers above; rebalance next cycle.
  } else if (stray >= 0) {
    const value = usdValue(stray);
    const amount = value > cap ? (balances[stray + 1]! * cap) / value : balances[stray + 1]!;
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
  balances = await readBalances();

  // 4. hedge: short size per asset = spot held, rounded to Hyperliquid's size step
  hl = await retry(() => info.clearinghouseState({ user: vaultAddress }));
  // A failed hedge must not stop the report below: a stale NAV would block deposits.
  try {
    for (const [i, a] of ASSETS.entries()) {
      const idx = meta.universe.findIndex((u) => u.name === a.hlCoin);
      const szDec = meta.universe[idx]!.szDecimals;
      const step = 10 ** -szDec;
      const spot = Number(balances[i + 1]!) / 10 ** a.decimals;
      const short = -Number(hl.assetPositions.find((x) => x.position.coin === a.hlCoin)?.position.szi ?? 0);
      const delta = Math.floor((spot - short) / step) * step; // >0: short more, <0: buy back
      if (Math.abs(delta) * mark(a.hlCoin) < 1) continue;
      await retry(() => exchange.updateLeverage({ asset: idx, isCross: true, leverage: p.leverage }));
      const isBuy = delta < 0;
      const px = mark(a.hlCoin) * (isBuy ? 1.01 : 0.99);
      const size = Math.abs(delta).toFixed(szDec);
      const res = await retry(() =>
        exchange.order({
          orders: [{ a: idx, b: isBuy, p: Number(px.toPrecision(5)).toFixed(Math.max(0, 6 - szDec)).replace(/\.?0+$/, ""), s: size, r: isBuy, t: { limit: { tif: "Ioc" } } }],
          grouping: "na",
        }),
      );
      log(`${isBuy ? "reduced" : "shorted"} ${a.hlCoin} ${size} ->`, JSON.stringify(res.response.data.statuses));
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
  await keeperCall("report_position", { positions, account_value: accountValue });
  const after = await view(NET, VAULT, "get_state");
  log(`NAV ${Number(after.snapshot?.nav ?? 0) / 1e6} USDC | target ${p.target ?? "PARKED"} | HL ${Number(accountValue) / 1e6} | ${JSON.stringify(positions)} | paused ${after.paused}`);
}

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
