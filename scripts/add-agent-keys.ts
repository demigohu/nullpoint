// One-time, from the owner's laptop: create restricted keys for the agent host and store them in ../.env.
//   AGENT_*  function-call key on agent.<owner>, may only call the vault contract
//   SOLVER_*  testnet only: function-call key on <owner>, may only call the mock verifier's
//             solver_credit / execute_intents (the mock 1Click solver)
// Neither is a full-access key, so a leaked VPS can't move NEAR or call anything else.
//   node add-agent-keys.ts [--network testnet|mainnet]
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { generateKey } from "near-kit";

const network = process.argv.includes("--network") ? process.argv[process.argv.indexOf("--network") + 1]! : "testnet";
const OWNER = process.env.OWNER ?? (network === "mainnet" ? "nullpoint.near" : "nullpoint.testnet");
const ENV = new URL("../.env", import.meta.url);
const env = readFileSync(ENV, "utf8");

function addKey(account: string, contract: string, methods: string, signWith: string, envPrefix: string) {
  if (new RegExp(`^${envPrefix}_PRIVATE_KEY=.+`, "m").test(env)) return console.log(`${envPrefix}: already in .env, skipped`);
  const key = generateKey();
  const r = spawnSync("near", [
    "account", "add-key", account, "grant-function-call-access", "--allowance", "unlimited",
    "--contract-account-id", contract, "--function-names", methods,
    "use-manually-provided-public-key", String(key.publicKey), "network-config", network, signWith, "send",
  ], { encoding: "utf8" });
  if (!/added|successfully/i.test(r.stdout + r.stderr)) throw new Error(`add-key failed for ${account}: ${(r.stdout + r.stderr).slice(-400)}`);
  appendFileSync(ENV, `\n${envPrefix}_ACCOUNT=${account}\n${envPrefix}_PRIVATE_KEY=${key.secretKey}\n`);
  console.log(`${envPrefix}: ${key.publicKey} on ${account} -> ${contract}${methods ? ` (${methods})` : " (any method)"}`);
}

// The testnet account predates the keeper -> agent rename; mainnet uses agent.<owner>.
const AGENT_ACCOUNT = network === "mainnet" ? `agent.${OWNER}` : `keeper.${OWNER}`;
addKey(AGENT_ACCOUNT, `vault.${OWNER}`, "", "sign-with-legacy-keychain", "AGENT");
if (network === "testnet") addKey(OWNER, `verifier.${OWNER}`, "solver_credit, execute_intents", "sign-with-keychain", "SOLVER");
