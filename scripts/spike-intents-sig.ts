// Spike (PRD gate G-G): will intents.near accept an ERC-191 intent signed by NEAR Chain Signatures?
//
//   node spike-intents-sig.ts local     -> sign with a throwaway local key (format check, no MPC)
//   node spike-intents-sig.ts mpc       -> sign with the MPC key of nullpoint.testnet/hl-master
//   node spike-intents-sig.ts tampered  -> MPC-sign, then alter the payload (must fail signature check)
//
// Everything is checked with the free `simulate_intents` view on mainnet intents.near; no funds move.
// The signer has no balance there, so a *balance* error means the signature itself was accepted.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { base58, base64 } from "@scure/base";
import { hexToBytes, keccak256, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const NEAR_ACCOUNT = process.env.NEAR_ACCOUNT ?? "nullpoint.testnet";
const MPC_CONTRACT = "v1.signer-prod.testnet";
const PATH = process.env.HL_PATH ?? "hl-master";
const MPC_ADDRESS = "0x5e33437E5b871F1Aa9E252Dd00a36C53DFcb9a8D"; // from spike-chainsig-hl.ts
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const BTC = "nep141:nbtc.bridge.near";

function near(args: string[]): string {
  return execFileSync("near", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const MAINNET_RPC = process.env.NEAR_MAINNET_RPC ?? "https://free.rpc.fastnear.com";

// View call over JSON-RPC; contract panics come back as `{ error }` instead of throwing.
async function viewMainnet(method: string, args: unknown): Promise<{ result?: any; error?: string }> {
  const res = await fetch(MAINNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: {
        request_type: "call_function", finality: "final", account_id: "intents.near",
        method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const body = await res.json();
  if (body.error) return { error: JSON.stringify(body.error) };
  if (body.result?.error) return { error: body.result.error };
  return { result: JSON.parse(Buffer.from(body.result.result).toString()) };
}

// MAGIC(5628f6c6) || V1(0x00) || salt(4) || deadline ns i64 LE(8) || random(15)
function versionedNonce(saltHex: string, deadline: Date): string {
  const buf = new Uint8Array(32);
  buf.set(hexToBytes("0x5628f6c6"), 0);
  buf[4] = 0;
  buf.set(hexToBytes(`0x${saltHex}`), 5);
  new DataView(buf.buffer).setBigInt64(9, BigInt(deadline.getTime()) * 1_000_000n, true);
  buf.set(randomBytes(15), 17);
  return base64.encode(buf);
}

function erc191Digest(message: string): Hex {
  const bytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  return keccak256(new Uint8Array([...prefix, ...bytes]));
}

function mpcSign(digest: Hex): Uint8Array {
  const out = near([
    "contract", "call-function", "as-transaction", MPC_CONTRACT, "sign",
    "json-args", JSON.stringify({ request: { payload_v2: { Ecdsa: digest.slice(2) }, path: PATH, domain_id: 0 } }),
    "prepaid-gas", "300.0 Tgas", "attached-deposit", "1 yoctoNEAR",
    "sign-as", NEAR_ACCOUNT, "network-config", "testnet", "sign-with-keychain", "send",
  ]);
  const sig = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  return new Uint8Array([
    ...hexToBytes(`0x${sig.big_r.affine_point.slice(2)}`),
    ...hexToBytes(`0x${sig.s.scalar.padStart(64, "0")}`),
    sig.recovery_id, // verifier wants v ∈ {0,1}
  ]);
}

async function main() {
  const mode = process.argv[2] ?? "local";
  const { state } = (await viewMainnet("simulate_intents", { signed: [] })).result as { state: { current_salt: string } };
  console.log(`current salt  ${state.current_salt}`);

  const local = privateKeyToAccount(generatePrivateKey());
  const signer = (mode === "local" ? local.address : MPC_ADDRESS).toLowerCase();
  const deadline = new Date(Date.now() + 5 * 60_000);

  const payload = JSON.stringify({
    signer_id: signer,
    verifying_contract: "intents.near",
    deadline: deadline.toISOString(),
    nonce: versionedNonce(state.current_salt, deadline),
    intents: [{ intent: "token_diff", diff: { [USDC]: "-20000000", [BTC]: "26000" } }],
  });
  const digest = erc191Digest(payload);
  console.log(`signer        ${signer}`);
  console.log(`digest        ${digest}`);

  let sig: Uint8Array;
  if (mode === "local") {
    const hex = await local.sign({ hash: digest });
    const raw = hexToBytes(hex);
    raw[64] = raw[64]! - 27;
    sig = raw;
  } else {
    sig = mpcSign(digest);
  }

  const submitted = mode === "tampered" ? payload.replace('"-20000000"', '"-20000001"') : payload;
  const signed = { standard: "erc191", payload: submitted, signature: `secp256k1:${base58.encode(sig)}` };
  if (process.env.DUMP_TO) {
    // Test vector for contracts/mock-verifier (recovers_known_signer).
    writeFileSync(`${process.env.DUMP_TO}/payload.json`, signed.payload);
    writeFileSync(`${process.env.DUMP_TO}/signature.txt`, signed.signature);
  }

  const { result, error } = await viewMainnet("simulate_intents", { signed: [signed] });
  if (error) console.log("simulate_intents rejected ->", error.slice(0, 600));
  else console.log("simulate_intents OK ->", JSON.stringify(result).slice(0, 600));
}

await main();
