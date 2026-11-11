// Testnet stand-in for 1Click: quotes in 1Click's exact response shape, priced off Hyperliquid testnet
// mark prices minus a 0.3% fee, signed with a local ed25519 key whose public key the testnet vault
// trusts. `fill` plays the solver: credits the swap output inside the mock verifier.
import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { base58 } from "@scure/base";
import { assetByToken, fromUsdc, hlInfo, signedMessage, toUsdc, type QuoteResponse } from "@nullpoint/core";
import { mustCall } from "@nullpoint/core/node";

const FEE_BPS = 30n;
const KEY = JSON.parse(readFileSync(new URL("../../../.keys/mock-1click.json", import.meta.url), "utf8"));
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(KEY.seed_hex, "hex")]),
  format: "der",
  type: "pkcs8",
});

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
  else out = amountIn; // USDC -> USDC
  out -= (out * FEE_BPS) / 10_000n;
  const minOut = out - (out * BigInt(req.slippageTolerance ?? 100)) / 10_000n;
  const r: QuoteResponse = {
    quoteRequest: req,
    quote: {
      amountIn: amountIn.toString(),
      amountOut: out.toString(),
      minAmountOut: minOut.toString(),
      ...(req.dry ? {} : { depositAddress: randomBytes(32).toString("hex"), deadline: req.deadline, timeEstimate: 5 }),
    },
    timestamp: new Date().toISOString(),
    signature: "",
  };
  const hash = base58.encode(createHash("sha256").update(signedMessage(r)).digest());
  r.signature = `ed25519:${base58.encode(sign(null, Buffer.from(hash), privateKey))}`;
  return r;
}

/** Solver side of a swap whose transfer the verifier already executed. */
export async function fill(owner: string, verifier: string, r: QuoteResponse) {
  const q = r.quoteRequest;
  await mustCall(owner, verifier, "solver_credit", { account_id: q.recipient, token_id: q.destinationAsset, amount: r.quote.amountOut }, { gas: 30 });
}
