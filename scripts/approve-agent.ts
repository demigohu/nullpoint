// Owner approves the agent's Hyperliquid agent wallet through the vault contract:
// the contract builds the approveAgent EIP-712 digest, MPC signs it, and we relay it to Hyperliquid.
//   node approve-agent.ts            (testnet; agent key in ../.keys/hl-agent.json, created if missing)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hlInfo, postSignedAction, view } from "@nullpoint/core";
import { mustCall } from "@nullpoint/core/node";

const OWNER = process.env.OWNER ?? "nullpoint.testnet";
const VAULT = `vault.${OWNER}`;
const KEY_FILE = new URL("../.keys/hl-agent.json", import.meta.url);

if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, JSON.stringify({ privateKey: generatePrivateKey() }));
const hlAgent = privateKeyToAccount(JSON.parse(readFileSync(KEY_FILE, "utf8")).privateKey);

const { config } = await view("testnet", VAULT, "get_state");
console.log(`master ${config.vault_address}  agent ${hlAgent.address}`);

const r = await mustCall(OWNER, VAULT, "approve_agent", { agent: hlAgent.address, name: "nullpoint-agent" }, { gas: 300 });
const { signed_count } = await view("testnet", VAULT, "get_state");
const [[, signed]] = await view("testnet", VAULT, "get_signed", { from: String(signed_count - 1), limit: 1 });
if (signed.kind !== "hl_approve_agent" || !signed.signature || signed.signature === "error") {
  throw new Error(`MPC signature missing: ${JSON.stringify(signed)}`);
}
console.log(`NEAR tx ${r.tx}\naction  ${signed.payload}`);
console.log("hyperliquid ->", JSON.stringify(await postSignedAction("testnet", signed.payload, signed.signature)));
console.log("extraAgents ->", JSON.stringify(await hlInfo("testnet", { type: "extraAgents", user: config.vault_address })));
