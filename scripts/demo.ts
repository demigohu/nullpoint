// Dry-run walkthrough for reviewers: no keys, no funds, nothing is signed or sent.
//   npm run demo
// 1. live vault state on testnet          4. the live position repriced ±20%
// 2. the vault's MPC address, recomputed   5. the guardrail vs a compromised strategist
// 3. a real mainnet 1Click quote, signature verified the way the contract does it
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { ASSETS, ONECLICK_MANAGER_PUBKEY, deriveEvmAddress, getQuote, guardrail, hlInfo, signedMessage, view, type Context, type Market } from "@nullpoint/core";

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
// Same check as contracts/vault/src/quote.rs: ed25519 over the base58 text of sha256(message).
const b58 = (s: string) => base58.decode(s.replace(/^ed25519:/, ""));
const signedBy1Click = (message: string, signature: string) =>
  ed25519.verify(b58(signature), new TextEncoder().encode(base58.encode(createHash("sha256").update(message).digest())), b58(ONECLICK_MANAGER_PUBKEY));
const vaultAddr = s.config.vault_address;
let message = "", signature = "", source = "";
for (let i = 0; i < 2 && !message; i++) {
  try {
    const q = await getQuote({
      dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      destinationAsset: "nep141:nbtc.bridge.near", amount: "20000000", depositType: "INTENTS", refundTo: vaultAddr, refundType: "INTENTS",
      recipient: vaultAddr, recipientType: "INTENTS", deadline: new Date(Date.now() + 600_000).toISOString(),
    });
    [message, signature, source] = [signedMessage(q), q.signature, `fetched now: 20 USDC -> ${q.quote.amountOutFormatted} BTC`];
  } catch (e) {
    console.log(`   1Click didn't answer (${(e as Error).message.slice(0, 80)}…), ${i < 1 ? "retrying" : "using a recorded one"}`);
  }
}
if (!message) {
  // 1Click times out now and then; the contract's test fixture is a real 1Click quote, signature included.
  const dir = new URL("../contracts/vault/testdata/", import.meta.url);
  [message, signature, source] = [readFileSync(new URL("swap_usdc_btc.json", dir), "utf8").trim(), readFileSync(new URL("swap_usdc_btc.sig", dir), "utf8").trim(), "recorded real quote from contracts/vault/testdata"];
}
console.log(`   ${source}, recipient ${JSON.parse(message).recipient}`);
console.log(`   signed bytes = base58(sha256(message)) = ${base58.encode(createHash("sha256").update(message).digest())}`);
console.log(`   ed25519 signature by 1Click's manager key: ${ok(signedBy1Click(message, signature))}`);
const forged = message.replace(/"recipient":"[^"]*"/, '"recipient":"0x000000000000000000000000000000000000dead"');
console.log(`   same quote with the recipient swapped to an attacker: ${ok(!signedBy1Click(forged, signature))} rejected`);

h("4. The live position, with the price moved ±20%: spot and short cancel");
// Today's holdings (the contract's last snapshot) and short (Hyperliquid), repriced at the mark ±20%.
const [meta, ctxs] = await hlInfo<[{ universe: { name: string }[] }, { markPx: string }[]]>("testnet", { type: "metaAndAssetCtxs" });
const nav = Number(s.snapshot?.nav ?? 0) / 1e6;
const legs = ASSETS.map((a, i) => ({
  coin: a.hlCoin,
  held: Number(BigInt(s.snapshot?.spot?.[i] ?? "0")) / 10 ** a.decimals,
  short: Number(hl.assetPositions.find((p: any) => p.position.coin === a.hlCoin)?.position.szi ?? 0),
  px: Number(ctxs[meta.universe.findIndex((u) => u.name === a.hlCoin)]?.markPx ?? 0),
})).filter((l) => l.held || l.short);
if (!legs.length) console.log("   nothing held right now, so nothing to move");
for (const l of legs) console.log(`   ${l.held} ${l.coin} held, ${l.short} ${l.coin} short, mark $${l.px.toLocaleString()}`);
for (const move of [-0.2, 0.2]) {
  const spotPnl = legs.reduce((t, l) => t + l.held * l.px * move, 0);
  const shortPnl = legs.reduce((t, l) => t + l.short * l.px * move, 0);
  const sign = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(2)}`;
  console.log(`   ${move > 0 ? "+" : ""}${move * 100}%: spot ${sign(spotPnl)}, short ${sign(shortPnl)} -> NAV $${nav.toFixed(2)} -> $${(nav + spotPnl + shortPnl).toFixed(2)}`);
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
