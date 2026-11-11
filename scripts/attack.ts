// Tries to steal from the testnet vault with the agent's own keys. Every attempt must be rejected.
//   node attack.ts
// Hyperliquid: the agent wallet tries withdraw3, usdSend and agentSendAsset to an outside address.
// NEAR: the agent tries to sign a 1Click quote whose recipient was swapped for the attacker's.
import { readFileSync } from "node:fs";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { view } from "@nullpoint/core";
import { call } from "@nullpoint/core/node";

const OWNER = process.env.OWNER ?? "nullpoint.testnet";
const ATTACKER = "0x000000000000000000000000000000000000dEaD";
const hlAgent = privateKeyToAccount(JSON.parse(readFileSync(new URL("../.keys/hl-agent.json", import.meta.url), "utf8")).privateKey);
const transport = new HttpTransport({ isTestnet: true });
const exchange = new ExchangeClient({ transport, wallet: hlAgent });
const info = new InfoClient({ transport });
const { config } = await view("testnet", `vault.${OWNER}`, "get_state");
const master = config.vault_address;

let failures = 0;
async function expectRejected(name: string, fn: () => Promise<unknown> | unknown) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fn();
      console.log(`❌ ${name}: NOT rejected -> ${JSON.stringify(r).slice(0, 200)}`);
      failures++;
      return;
    } catch (e) {
      const m = (e as Error).message;
      if (m.includes("fetch failed") && i < 3) continue;
      console.log(`✅ ${name}: rejected — ${m.split("\n")[0].slice(0, 160)}`);
      return;
    }
  }
}

const before = (await info.clearinghouseState({ user: master })).marginSummary.accountValue;
console.log(`vault master ${master} (perp ${before} USDC), agent ${hlAgent.address}\n`);

await expectRejected("agent withdraw3 to attacker", () => exchange.withdraw3({ destination: ATTACKER, amount: "1" }));
await expectRejected("agent usdSend to attacker", () => exchange.usdSend({ destination: ATTACKER, amount: "1" }));
await expectRejected("agent agentSendAsset to attacker", () =>
  exchange.agentSendAsset({ destination: ATTACKER, sourceDex: "", destinationDex: "", token: "USDC", amount: "1" }));

// A real signed quote from the fixtures, with the recipient rewritten to the attacker.
const quote = readFileSync(new URL("../contracts/vault/testdata/swap_usdc_btc.json", import.meta.url), "utf8");
const forged = quote.replace("0x5e33437e5b871f1aa9e252dd00a36c53dfcb9a8d", ATTACKER.toLowerCase());
const signature = readFileSync(new URL("../contracts/vault/testdata/swap_usdc_btc.sig", import.meta.url), "utf8").trim();
await expectRejected("agent signs a 1Click quote paying the attacker", () => {
  const r = call(`keeper.${OWNER}`, `vault.${OWNER}`, "sign_quote", { message: forged, signature, salt_hex: "00000000" }, { gas: 300, legacy: true });
  if (r.ok) return r.tx;
  throw new Error(r.output.match(/Smart contract panicked: [^\n]*/)?.[0] ?? "failed");
});

const after = (await info.clearinghouseState({ user: master })).marginSummary.accountValue;
console.log(`\nmaster perp ${before} -> ${after} USDC (moves only with funding/PnL)`);
if (failures) process.exitCode = 1;
