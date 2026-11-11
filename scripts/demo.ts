// Dry-run walkthrough for reviewers: no keys, no funds, nothing is signed or sent.
//   npm run demo
// 1. live vault state on testnet          4. a ±20% BTC move against the hedge
// 2. the vault's MPC address, recomputed   5. the guardrail vs a compromised strategist
// 3. a real mainnet 1Click quote, signature verified the way the contract does it
import { createHash } from "node:crypto";
import { base58 } from "@scure/base";
import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { deriveEvmAddress, getQuote, guardrail, hlInfo, signedMessage, view, type Context, type Market } from "@nullpoint/core";

const VAULT = "vault.nullpoint.testnet";
const ok = (b: boolean) => (b ? "✅" : "❌");
const h = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

h("1. Live vault on NEAR testnet");
const s = await view("testnet", VAULT, "get_state");
const hl = await hlInfo("testnet", { type: "clearinghouseState", user: s.config.vault_address });
const navAge = s.snapshot ? Math.round((Date.now() - s.snapshot.ms) / 1000) : null;
console.log(`   NAV ${(Number(s.snapshot?.nav ?? 0) / 1e6).toFixed(2)} USDC (posted ${navAge}s ago), ${(Number(s.total_shares) / 1e6).toFixed(2)} shares, paused: ${s.paused}`);
console.log(`   short on Hyperliquid: ${hl.assetPositions.map((p: any) => `${p.position.szi} ${p.position.coin}`).join(", ") || "none"}; account ${hl.marginSummary.accountValue} USDC`);

h("2. One EVM address, controlled by the vault contract through NEAR Chain Signatures");
const derived = deriveEvmAddress("testnet", VAULT, s.config.mpc_path);
console.log(`   recomputed from the MPC root key: ${derived}`);
console.log(`   configured in the contract:       ${s.config.vault_address} ${ok(derived === s.config.vault_address)}`);
const agents = await hlInfo<{ name: string; address: string }[]>("testnet", { type: "extraAgents", user: s.config.vault_address });
console.log(`   Hyperliquid agents approved by that address (signed by MPC): ${agents.map((a) => `${a.name} ${a.address}`).join(", ")}`);

h("3. A real 1Click quote (mainnet), verified like vault.sign_quote verifies it");
const vaultAddr = s.config.vault_address;
const q = await getQuote({
  dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  destinationAsset: "nep141:nbtc.bridge.near", amount: "20000000", depositType: "INTENTS", refundTo: vaultAddr, refundType: "INTENTS",
  recipient: vaultAddr, recipientType: "INTENTS", deadline: new Date(Date.now() + 600_000).toISOString(),
});
const message = signedMessage(q);
console.log(`   20 USDC -> ${q.quote.amountOutFormatted} BTC, recipient ${q.quoteRequest.recipient}`);
console.log(`   signed bytes = base58(sha256(message)) = ${base58.encode(createHash("sha256").update(message).digest())}`);
console.log(`   ed25519 signature by 1Click's manager key: ${ok(verifyQuoteSignature(q as never))}`);
const forged = structuredClone(q);
forged.quoteRequest.recipient = "0x000000000000000000000000000000000000dead";
console.log(`   same quote with the recipient swapped to an attacker: ${ok(!verifyQuoteSignature(forged as never))} rejected`);

h("4. BTC moves ±20% in a day: spot and short cancel");
for (const move of [-0.2, 0.2]) {
  const qty = 666.67 / 74_000, px = 74_000 * (1 + move);
  const nav = qty * px + 333.33 + qty * (74_000 - px) + (qty * px * 0.1) / 365;
  console.log(`   BTC ${move > 0 ? "+" : ""}${move * 100}%: $1000 deposit -> NAV $${nav.toFixed(2)}`);
}

h("5. A compromised strategist asks for the attacker's wish list");
const now = Date.now();
const ctx: Context = { active: "BTC", heldSinceMs: now - 30 * 3_600_000, nowMs: now, rotationsLast24h: 0, rotationCostBps: 40, allowlist: ["BTC", "ETH", "NEAR"] };
const mkts: Market[] = ["BTC", "ETH", "NEAR"].map((symbol, i) => ({ symbol, fundingAprNow: [9, 4, 12][i]!, fundingApr8h: [9, 4, 11][i]!, openInterestUsd: 1e8 }));
for (const evil of [
  { action: "ROTATE", target: "SOL", confidence: 1, reasoning: "" },
  { action: "SET_LEVERAGE", leverage: 20, confidence: 1, reasoning: "" },
  { action: "WITHDRAW", target: "0xdead", confidence: 1, reasoning: "" },
]) {
  const g = guardrail(evil as never, ctx, mkts);
  console.log(`   ${ok(!g.ok)} blocked ${JSON.stringify(evil).slice(0, 60)} -> ${(g as { reason: string }).reason}`);
}

console.log(`\nMore: npm run attack (needs testnet keys) · npm run simulate:strategy · https://testnet.nearblocks.io/address/${VAULT}`);
