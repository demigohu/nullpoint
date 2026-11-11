// Spike (PRD gate G-A): can a NEAR Chain Signatures key act as a Hyperliquid master account?
//
//   node spike-chainsig-hl.ts address   -> print the derived EVM address (fund this on HL testnet)
//   node spike-chainsig-hl.ts approve   -> MPC-sign approveAgent for a fresh local agent key
//   node spike-chainsig-hl.ts attack    -> agent key tries withdraw3 / usdSend (must be rejected)
//
// The NEAR transaction to the MPC contract is signed by near-cli-rs with the OS keychain,
// so no NEAR private key ever touches this script.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { bytesToHex, getAddress, hashTypedData, keccak256, recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const NEAR_ACCOUNT = process.env.NEAR_ACCOUNT ?? "nullpoint.testnet";
const MPC_CONTRACT = "v1.signer-prod.testnet";
const PATH = process.env.HL_PATH ?? "hl-master";
const STATE_DIR = new URL("./.spike/", import.meta.url);
const AGENT_FILE = new URL("agent.json", STATE_DIR);

const transport = new HttpTransport({ isTestnet: true });
const info = new InfoClient({ transport });

// Root secp256k1 key of v1.signer-prod.testnet (same constant chainsig.js ships).
const MPC_ROOT_KEY =
  "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3";

// child = root + epsilon·G, epsilon = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:{predecessor},{path}")
function deriveMaster(): Hex {
  const root = secp256k1.Point.fromBytes(
    new Uint8Array([4, ...base58.decode(MPC_ROOT_KEY.split(":")[1]!)]),
  );
  const epsilon = sha3_256(
    new TextEncoder().encode(`near-mpc-recovery v0.1.0 epsilon derivation:${NEAR_ACCOUNT},${PATH}`),
  );
  const child = root.add(secp256k1.Point.BASE.multiply(secp256k1.Point.Fn.create(BigInt(bytesToHex(epsilon)))));
  return getAddress(`0x${keccak256(child.toBytes(false).slice(1)).slice(-40)}`);
}

// Cross-check the local derivation against the MPC contract's own view method.
function deriveMasterOnChain(): Hex {
  const out = execFileSync(
    "near",
    [
      "contract", "call-function", "as-read-only", MPC_CONTRACT, "derived_public_key",
      "json-args", JSON.stringify({ path: PATH, predecessor: NEAR_ACCOUNT, domain_id: 0 }),
      "network-config", "testnet", "now",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const key = out.match(/secp256k1:[1-9A-HJ-NP-Za-km-z]+/)![0];
  const raw = base58.decode(key.split(":")[1]!);
  return getAddress(`0x${keccak256(raw).slice(-40)}`);
}

// Ask the MPC network to sign a 32-byte digest, via near-cli-rs + keychain.
function mpcSign(digest: Hex): { r: Hex; s: Hex; v: 27 | 28 } {
  const args = JSON.stringify({
    request: { payload_v2: { Ecdsa: digest.slice(2) }, path: PATH, domain_id: 0 },
  });
  const out = execFileSync(
    "near",
    [
      "contract", "call-function", "as-transaction", MPC_CONTRACT, "sign",
      "json-args", args,
      "prepaid-gas", "300.0 Tgas",
      "attached-deposit", "1 yoctoNEAR",
      "sign-as", NEAR_ACCOUNT,
      "network-config", "testnet",
      "sign-with-keychain", "send",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  const sig = JSON.parse(json);
  const r = sig.big_r.affine_point.slice(2);
  return { r: `0x${r}`, s: `0x${sig.s.scalar}`, v: (sig.recovery_id + 27) as 27 | 28 };
}

// A viem-local-account-shaped wallet whose signTypedData goes through NEAR MPC.
function mpcWallet(address: Hex) {
  return {
    address,
    async signTypedData(params: Parameters<typeof hashTypedData>[0]): Promise<Hex> {
      const digest = hashTypedData(params);
      console.log(`  digest      ${digest}`);
      const { r, s, v } = mpcSign(digest);
      const signature = `${r}${s.slice(2).padStart(64, "0")}${v.toString(16)}` as Hex;
      const recovered = await recoverTypedDataAddress({ ...params, signature } as never);
      console.log(`  recovered   ${recovered} ${recovered.toLowerCase() === address.toLowerCase() ? "✅ matches master" : "❌ MISMATCH"}`);
      return signature;
    },
  };
}

function loadOrCreateAgent() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR);
  if (!existsSync(AGENT_FILE)) {
    writeFileSync(AGENT_FILE, JSON.stringify({ privateKey: generatePrivateKey() }, null, 2));
  }
  return privateKeyToAccount(JSON.parse(readFileSync(AGENT_FILE, "utf8")).privateKey);
}

async function main() {
  const cmd = process.argv[2] ?? "address";
  const master = deriveMaster();
  console.log(`NEAR account  ${NEAR_ACCOUNT}  path "${PATH}"`);
  console.log(`HL master     ${master}`);

  if (cmd === "address") {
    const onChain = deriveMasterOnChain();
    console.log(`MPC view      ${onChain} ${onChain === master ? "✅ matches" : "❌ MISMATCH"}`);
    const state = await info.clearinghouseState({ user: master });
    console.log(`HL testnet account value: ${state.marginSummary.accountValue} USDC`);
    return;
  }

  const agent = loadOrCreateAgent();
  console.log(`HL agent      ${agent.address}`);

  if (cmd === "approve") {
    const exchange = new ExchangeClient({ transport, wallet: mpcWallet(master) });
    const res = await exchange.approveAgent({ agentAddress: agent.address, agentName: "nullpoint-keeper" });
    console.log("approveAgent ->", JSON.stringify(res));
    console.log("extraAgents  ->", JSON.stringify(await info.extraAgents({ user: master })));
    return;
  }

  if (cmd === "attack") {
    const exchange = new ExchangeClient({ transport, wallet: agent });
    for (const [name, fn] of [
      ["withdraw3", () => exchange.withdraw3({ destination: agent.address, amount: "1" })],
      ["usdSend", () => exchange.usdSend({ destination: agent.address, amount: "1" })],
    ] as const) {
      try {
        console.log(`${name} ->`, JSON.stringify(await fn()), "❌ NOT BLOCKED");
      } catch (e) {
        console.log(`${name} -> rejected ✅  ${(e as Error).message}`);
      }
    }
    return;
  }

  if (cmd === "fund-perp") {
    const exchange = new ExchangeClient({ transport, wallet: mpcWallet(master) });
    const res = await exchange.usdClassTransfer({ amount: process.argv[3] ?? "50", toPerp: true });
    console.log("usdClassTransfer ->", JSON.stringify(res));
    return;
  }

  if (cmd === "trade") {
    // Agent signs an L1 order; Hyperliquid books it on the master account.
    const coin = process.argv[3] ?? "ETH";
    const size = process.argv[4] ?? "0.01";
    const [meta, ctxs] = await info.metaAndAssetCtxs();
    const asset = meta.universe.findIndex((u) => u.name === coin);
    const mark = Number(ctxs[asset]!.markPx);
    const exchange = new ExchangeClient({ transport, wallet: agent });
    const res = await exchange.order({
      orders: [{ a: asset, b: false, p: (mark * 0.97).toPrecision(5), s: size, r: false, t: { limit: { tif: "Ioc" } } }],
      grouping: "na",
    });
    console.log("order (short) ->", JSON.stringify(res.response.data.statuses));
    const state = await info.clearinghouseState({ user: master });
    console.log("master positions ->", JSON.stringify(state.assetPositions.map((p) => p.position)));
    return;
  }

  throw new Error(`unknown command ${cmd}`);
}

await main();
