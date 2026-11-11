// NullPoint keeper v1 (rule-based, testnet). Each cycle:
//   1. report verified prices (1Click quotes; mock on testnet)
//   2. idle USDC in the vault's Intents account -> buy spot of the target asset via sign_quote
//   3. size the Hyperliquid short to match spot (agent wallet, leverage <= 2x)
//   4. report the Hyperliquid side; the contract checks it and recomputes NAV
//   node src/index.ts [--once]          env: OWNER, TARGET (BTC|ETH|NEAR), INTERVAL_S
import { readFileSync } from "node:fs";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { ASSETS, assetBySymbol, mpcToIntentsSignature, signedMessage as msg, view } from "@nullpoint/core";
import { mustCall } from "@nullpoint/core/node";
import * as oneclick from "./mock1click.ts";

const NET = "testnet";
const OWNER = process.env.OWNER ?? "nullpoint.testnet";
const [VAULT, VERIFIER, KEEPER] = ["vault", "verifier", "keeper"].map((p) => `${p}.${OWNER}`);
const TARGET = assetBySymbol(process.env.TARGET ?? "BTC");
const LEVERAGE = 2;
const MIN_TRADE_USDC = 12_000_000n; // Hyperliquid rejects orders under $10, so spot is bought in hedgeable chunks
const PRICE_SAMPLE_USDC = 1_000_000n; // quote ~1 USDC worth of each asset for pricing

const agent = privateKeyToAccount(JSON.parse(readFileSync(new URL("../../../.keys/hl-agent.json", import.meta.url), "utf8")).privateKey);
const transport = new HttpTransport({ isTestnet: true });
const info = new InfoClient({ transport });
const exchange = new ExchangeClient({ transport, wallet: agent });

const keeperCall = (method: string, args: object, gas = 100) => mustCall(KEEPER, VAULT, method, args, { gas, legacy: true });
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

async function cycle() {
  const state = await view(NET, VAULT, "get_state");
  const { vault_address: vaultAddress, usdc_token_id: usdcToken } = state.config;
  if (state.paused) return log("vault paused, skipping");
  if (BigInt(state.pending_usdc) > 0n) log("swept deposits, tx", (await mustCall(KEEPER, VAULT, "sweep", {}, { gas: 150, legacy: true })).tx);
  const intentsSide = { refundTo: vaultAddress, refundType: "INTENTS", recipient: vaultAddress, recipientType: "INTENTS", depositType: "INTENTS" };
  const deadline = () => new Date(Date.now() + 10 * 60_000).toISOString();

  // 1. prices: sell ~1 USDC worth of each asset for USDC
  const [meta, ctxs] = await retry(() => info.metaAndAssetCtxs());
  const mark = (coin: string) => Number(ctxs[meta.universe.findIndex((u) => u.name === coin)]!.markPx);
  const priceQuotes = await Promise.all(
    ASSETS.map((a) => {
      const amount = (PRICE_SAMPLE_USDC * 10n ** BigInt(a.decimals)) / BigInt(Math.round(mark(a.hlCoin) * 1e6));
      return oneclick.quote({ dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: a.tokenId, destinationAsset: usdcToken, amount: amount.toString(), deadline: deadline(), ...intentsSide });
    }),
  );
  await keeperCall("report_prices", { quotes: priceQuotes.map((r) => ({ message: msg(r), signature: r.signature })) });

  // 2. idle USDC -> spot
  const tokens = [usdcToken, ...ASSETS.map((a) => a.tokenId)];
  let balances = (await view<string[]>(NET, VERIFIER, "mt_batch_balance_of", { account_id: vaultAddress, token_ids: tokens })).map(BigInt);
  const idle = balances[0]! - BigInt(state.owed_usdc);
  if (idle >= MIN_TRADE_USDC) {
    const amount = idle < BigInt(state.params.max_swap_usdc) ? idle : BigInt(state.params.max_swap_usdc);
    // 0.5%: minAmountOut must stay within the contract's max_slippage_bps of the oracle price.
    const q = await oneclick.quote({ dry: false, swapType: "EXACT_INPUT", slippageTolerance: 50, originAsset: usdcToken, destinationAsset: TARGET.tokenId, amount: amount.toString(), deadline: deadline(), ...intentsSide });
    const salt = await view<string>(NET, VERIFIER, "current_salt");
    const signedTx = await keeperCall("sign_quote", { message: msg(q), signature: q.signature, salt_hex: salt }, 300);
    const { signed_count } = await view(NET, VAULT, "get_state");
    const [[, s]] = await view(NET, VAULT, "get_signed", { from: String(signed_count - 1), limit: 1 });
    // Testnet: submit the vault-signed intent to the mock verifier, then the mock solver fills it.
    await mustCall(KEEPER, VERIFIER, "execute_intents", { signed: [{ standard: "erc191", payload: s.payload, signature: mpcToIntentsSignature(s.signature) }] }, { gas: 100, legacy: true });
    await oneclick.fill(OWNER, VERIFIER, q);
    log(`bought ${TARGET.symbol} with ${Number(amount) / 1e6} USDC (sign tx ${signedTx.tx})`);
    balances = (await view<string[]>(NET, VERIFIER, "mt_batch_balance_of", { account_id: vaultAddress, token_ids: tokens })).map(BigInt);
  }

  // 3. hedge: short size per asset = spot held, rounded to Hyperliquid's size step
  let hl = await retry(() => info.clearinghouseState({ user: vaultAddress }));
  // A failed hedge must not stop the report below: a stale NAV would block deposits.
  try {
    for (const [i, a] of ASSETS.entries()) {
      const idx = meta.universe.findIndex((u) => u.name === a.hlCoin);
      const step = 10 ** -meta.universe[idx]!.szDecimals;
      const spot = Number(balances[i + 1]!) / 10 ** a.decimals;
      const short = -Number(hl.assetPositions.find((p) => p.position.coin === a.hlCoin)?.position.szi ?? 0);
      const delta = Math.floor((spot - short) / step) * step; // >0: short more, <0: buy back
      if (Math.abs(delta) * mark(a.hlCoin) < 1) continue;
      await retry(() => exchange.updateLeverage({ asset: idx, isCross: true, leverage: LEVERAGE }));
      const isBuy = delta < 0;
      const px = mark(a.hlCoin) * (isBuy ? 1.01 : 0.99);
      const res = await retry(() =>
        exchange.order({
          orders: [{ a: idx, b: isBuy, p: Number(px.toPrecision(5)).toFixed(Math.max(0, 6 - meta.universe[idx]!.szDecimals)).replace(/\.?0+$/, ""), s: Math.abs(delta).toFixed(meta.universe[idx]!.szDecimals), r: isBuy, t: { limit: { tif: "Ioc" } } }],
          grouping: "na",
        }),
      );
      log(`${isBuy ? "reduced" : "shorted"} ${a.hlCoin} ${Math.abs(delta)} ->`, JSON.stringify(res.response.data.statuses));
    }
  } catch (e) {
    log("hedge failed:", (e as Error).message);
  }

  // 4. report the Hyperliquid side
  hl = await retry(() => info.clearinghouseState({ user: vaultAddress }));
  const positions = hl.assetPositions
    .filter((p) => Number(p.position.szi) < 0)
    .map(({ position: p }) => {
      const a = ASSETS.find((x) => x.hlCoin === p.coin)!;
      const size = -Number(p.szi);
      return {
        symbol: a.symbol,
        size: BigInt(Math.round(size * 10 ** Math.min(a.decimals, 12))) * 10n ** BigInt(Math.max(0, a.decimals - 12)) + "",
        entry_notional: Math.round(size * Number(p.entryPx) * 1e6).toString(),
      };
    });
  const accountValue = Math.round(Number(hl.marginSummary.accountValue) * 1e6).toString();
  await keeperCall("report_position", { positions, account_value: accountValue });
  const after = await view(NET, VAULT, "get_state");
  log(`NAV ${Number(after.snapshot?.nav ?? 0) / 1e6} USDC | HL account ${Number(accountValue) / 1e6} | positions ${JSON.stringify(positions)} | paused ${after.paused}`);
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
