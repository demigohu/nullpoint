// Fetches real 1Click quotes and writes them as test fixtures for contracts/vault.
// Checks our message builder against the SDK's own hash before saving.
//   node --env-file=../.env fixtures-oneclick.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { base58 } from "@scure/base";
import { quoteHash, verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { getQuote, signedMessage } from "@nullpoint/core";

const VAULT = "0x5e33437e5b871f1aa9e252dd00a36c53dfcb9a8d";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const OUT = new URL("../contracts/vault/testdata/", import.meta.url);
const deadline = () => new Date(Date.now() + 30 * 60_000).toISOString();
const intentsSide = { refundTo: VAULT, refundType: "INTENTS", recipient: VAULT };

const cases = {
  // Spot buy executed from the vault's Intents balance.
  swap_usdc_btc: { dry: false, originAsset: USDC, destinationAsset: "nep141:nbtc.bridge.near", amount: "20000000", depositType: "INTENTS", recipientType: "INTENTS", ...intentsSide },
  // Price oracle sample: 0.001 BTC -> USDC.
  price_btc: { dry: true, originAsset: "nep141:nbtc.bridge.near", destinationAsset: USDC, amount: "100000", depositType: "INTENTS", recipientType: "INTENTS", ...intentsSide },
};

mkdirSync(OUT, { recursive: true });
for (const [name, c] of Object.entries(cases)) {
  const r = await getQuote({ swapType: "EXACT_INPUT", slippageTolerance: 100, deadline: deadline(), ...c }, process.env.NEAR_INTENTS_API_KEY);
  const msg = signedMessage(r);
  const ours = base58.encode(createHash("sha256").update(msg).digest());
  if (ours !== quoteHash(r as never)) throw new Error(`${name}: message builder disagrees with SDK quoteHash`);
  if (!verifyQuoteSignature(r as never)) throw new Error(`${name}: signature invalid`);
  writeFileSync(new URL(`${name}.json`, OUT), msg);
  writeFileSync(new URL(`${name}.sig`, OUT), r.signature);
  console.log(`${name}: ok (${msg.length} bytes)`);
}
