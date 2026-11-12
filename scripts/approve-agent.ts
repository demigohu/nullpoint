// Owner approves the agent's Hyperliquid agent wallet through the vault contract:
// the contract builds the approveAgent EIP-712 digest, MPC signs it, and we relay it to Hyperliquid.
//   node approve-agent.ts [--network mainnet]   (agent key in ../.keys/[mainnet/]hl-agent.json, created if missing)
// On mainnet the vault's Hyperliquid account must exist first: run it after the first margin landed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hlInfo, postSignedAction, view } from "@nullpoint/core";
import { mustCall } from "@nullpoint/core/node";

const NET = process.argv.includes("--network") ? (process.argv[process.argv.indexOf("--network") + 1] as "testnet" | "mainnet") : "testnet";
const OWNER = process.env.OWNER ?? (NET === "mainnet" ? "nullpoint.near" : "nullpoint.testnet");
const VAULT = `vault.${OWNER}`;
const KEY_FILE = new URL(`../.keys/${NET === "mainnet" ? "mainnet/" : ""}hl-agent.json`, import.meta.url);

mkdirSync(new URL(".", KEY_FILE), { recursive: true });
if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, JSON.stringify({ privateKey: generatePrivateKey() }), { mode: 0o600 });
const hlAgent = privateKeyToAccount(JSON.parse(readFileSync(KEY_FILE, "utf8")).privateKey);

const { config } = await view(NET, VAULT, "get_state");
console.log(`master ${config.vault_address}  agent ${hlAgent.address}`);
const role = (await hlInfo(NET, { type: "userRole", user: config.vault_address })).role;
if (role === "missing") throw new Error("the vault has no Hyperliquid account yet: wait for the agent's first margin transfer");

const r = await mustCall(OWNER, VAULT, "approve_agent", { agent: hlAgent.address, name: "nullpoint-agent" }, { gas: 300, network: NET });
const { signed_count } = await view(NET, VAULT, "get_state");
const [[, signed]] = await view(NET, VAULT, "get_signed", { from: String(signed_count - 1), limit: 1 });
if (signed.kind !== "hl_approve_agent" || !signed.signature || signed.signature === "error") {
  throw new Error(`MPC signature missing: ${JSON.stringify(signed)}`);
}
console.log(`NEAR tx ${r.tx}\naction  ${signed.payload}`);
console.log("hyperliquid ->", JSON.stringify(await postSignedAction(NET, signed.payload, signed.signature)));
console.log("extraAgents ->", JSON.stringify(await hlInfo(NET, { type: "extraAgents", user: config.vault_address })));
