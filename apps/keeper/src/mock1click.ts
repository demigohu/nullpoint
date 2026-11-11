// Testnet stand-in for 1Click: quotes in 1Click's exact response shape, priced off Hyperliquid testnet
// mark prices minus a 0.3% fee, signed with a local ed25519 key whose public key the testnet vault
// trusts. `fill` plays the solver: credits outputs inside the mock verifier, and moves USDC on
// Hyperliquid testnet from/to a solver wallet for the `hypercore` (margin) routes.
import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { base58 } from "@scure/base";
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { assetByToken, fromUsdc, hlInfo, signedMessage, toUsdc, type QuoteResponse } from "@nullpoint/core";
import { mustCall } from "@nullpoint/core/node";

const FEE_BPS = 30n;
const keyFile = (f: string) => JSON.parse(readFileSync(new URL(`../../../.keys/${f}`, import.meta.url), "utf8"));
const KEY = keyFile("mock-1click.json");
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(KEY.seed_hex, "hex")]),
  format: "der",
  type: "pkcs8",
});
// The solver's Hyperliquid testnet wallet: receives margin pulled from the vault, sends margin to it.
const solver = privateKeyToAccount(keyFile("mock-solver-hl.json").privateKey);
const solverExchange = new ExchangeClient({ transport: new HttpTransport({ isTestnet: true }), wallet: solver });

const isHl = (asset: string) => asset.startsWith("1cs_v1:hypercore:");
const usdcDecimals = (asset: string) => (isHl(asset) ? 8 : 6);

async function markPrices(): Promise<Record<string, number>> {
  const [meta, ctxs] = await hlInfo("testnet", { type: "metaAndAssetCtxs" });
  return Object.fromEntries(meta.universe.map((u: { name: string }, i: number) => [u.name, Number(ctxs[i].markPx)]));
}

export async function quote(req: Record<string, any>): Promise<QuoteResponse> {
  const px = await markPrices();
  const amountIn = BigInt(req.amount);
  const from = assetByToken(req.originAsset);
  const to = assetByToken(req.destinationAsset);
  let out: bigint;
  if (from && !to) out = toUsdc(from, amountIn, px[from.hlCoin]!);
  else if (!from && to) out = fromUsdc(to, amountIn, px[to.hlCoin]!);
  else if (from && to) out = fromUsdc(to, toUsdc(from, amountIn, px[from.hlCoin]!), px[to.hlCoin]!);
  else {
    // USDC <-> USDC across chains: NEAR USDC has 6 decimals, Hyperliquid USDC 8.
    const shift = usdcDecimals(req.destinationAsset) - usdcDecimals(req.originAsset);
    out = shift >= 0 ? amountIn * 10n ** BigInt(shift) : amountIn / 10n ** BigInt(-shift);
  }
  out -= (out * FEE_BPS) / 10_000n;
  const minOut = out - (out * BigInt(req.slippageTolerance ?? 100)) / 10_000n;
  const depositAddress = isHl(req.originAsset) ? solver.address.toLowerCase() : randomBytes(32).toString("hex");
  const r: QuoteResponse = {
    quoteRequest: req,
    quote: {
      amountIn: amountIn.toString(),
      amountOut: out.toString(),
      minAmountOut: minOut.toString(),
      ...(req.dry ? {} : { depositAddress, deadline: req.deadline, timeEstimate: 5 }),
    },
    timestamp: new Date().toISOString(),
    signature: "",
  };
  const hash = base58.encode(createHash("sha256").update(signedMessage(r)).digest());
  r.signature = `ed25519:${base58.encode(sign(null, Buffer.from(hash), privateKey))}`;
  return r;
}

/** Solver side of a quote whose deposit already happened (intent executed, or sendAsset posted). */
export async function fill(owner: string, verifier: string, r: QuoteResponse) {
  const q = r.quoteRequest;
  if (isHl(q.destinationAsset)) {
    // Margin out: deliver USDC to the vault's Hyperliquid perp balance, as 1Click does
    // (perp -> perp usdSend; Hyperliquid rejects a cross-dex sendAsset to another user).
    await deliverMargin(q.recipient, Number(r.quote.amountOut) / 1e8);
    return;
  }
  await mustCall(owner, verifier, "solver_credit", { account_id: q.recipient, token_id: q.destinationAsset, amount: r.quote.amountOut }, { gas: 30 });
}

/** Solver pays `usd` of perp USDC to `destination`, topping its own perp balance up from spot first. */
export async function deliverMargin(destination: string, usd: number) {
  const perp = Number((await hlInfo("testnet", { type: "clearinghouseState", user: solver.address })).withdrawable);
  if (perp < usd) await solverExchange.usdClassTransfer({ amount: String(Math.ceil(usd - perp + 50)), toPerp: true });
  const res = await solverExchange.usdSend({ destination, amount: usd.toFixed(6).replace(/\.?0+$/, "") });
  if (res.status !== "ok") throw new Error(`solver usdSend failed: ${JSON.stringify(res)}`);
}
