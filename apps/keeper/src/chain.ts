// Signs NEAR function calls from a private key in the environment (no CLI, no keychain).
//
// Sign once, then broadcast and wait separately. Calls that ask MPC to sign take several blocks,
// and public RPCs time out (HTTP 500) while waiting for FINAL even though the transaction runs.
// Knowing the hash up front makes both steps safe to retry on any endpoint: re-sending the same
// signed bytes can't execute twice (same nonce), and polling status is read-only.
import { Near } from "near-kit";
import { RPCS, rpc, type Network } from "@nullpoint/core";

export type Signer = {
  accountId: string;
  call(contract: string, method: string, args: object, opts?: { gas?: number; deposit?: string }): Promise<{ tx: string }>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FINAL_TIMEOUT_MS = 180_000;

/** RPC endpoints: NEAR_RPC_URLS (comma-separated, tried first) + the public defaults. */
export function rpcUrls(network: Network): string[] {
  const extra = (process.env.NEAR_RPC_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  return [...new Set([...extra, ...RPCS[network]])];
}

export function signer(network: Network, accountId: string, privateKey: string): Signer {
  const clients = rpcUrls(network).map(
    (rpcUrl) => new Near({ network: { networkId: network, rpcUrl }, privateKey: privateKey as `ed25519:${string}`, defaultSignerId: accountId }),
  );
  const urls = rpcUrls(network);

  async function sign(contract: string, method: string, args: object, gas: number, deposit: string) {
    let last: unknown;
    // Signing only reads (nonce, block hash), so any endpoint error is safe to retry elsewhere.
    for (const near of clients) {
      try {
        return await near.transaction(accountId).functionCall(contract, method, args, { gas: `${gas} Tgas`, attachedDeposit: deposit as `${number} yocto` }).sign();
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  async function post(method: string, params: object) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const body = await res.json().catch(() => null);
        if (body && res.status !== 429 && res.status < 500 && body.error?.code !== -429) return body;
      } catch {
        // next endpoint
      }
    }
    return null;
  }

  return {
    accountId,
    async call(contract, method, args, { gas = 100, deposit = "0 yocto" } = {}) {
      const signed = await sign(contract, method, args, gas, deposit);
      const tx = signed.getHash()!;
      const signedTxBase64 = Buffer.from(signed.serialize()).toString("base64");
      const deadline = Date.now() + FINAL_TIMEOUT_MS;
      let broadcastError = "";
      for (let attempt = 0; Date.now() < deadline; attempt++) {
        // Re-broadcasting identical bytes is idempotent; it also covers a first send that was lost.
        const sent = await post("send_tx", { signed_tx_base64: signedTxBase64, wait_until: "INCLUDED" });
        if (sent?.error) broadcastError = JSON.stringify(sent.error).slice(0, 300);
        const status = await post("tx", { tx_hash: tx, sender_account_id: accountId, wait_until: "FINAL" });
        const outcome = status?.result;
        if (outcome?.receipts_outcome && outcome.final_execution_status === "FINAL") {
          const failures = outcome.receipts_outcome
            .filter((o: any) => o.outcome.status.Failure)
            .map((o: any) => `${o.outcome.executor_id}: ${JSON.stringify(o.outcome.status.Failure).match(/panicked: ([^"\\]*)/)?.[1] ?? JSON.stringify(o.outcome.status.Failure)}`);
          if (failures.length) throw new Error(`${contract}.${method} failed (tx ${tx}): ${failures.join("; ")}`);
          return { tx };
        }
        // The transaction itself was rejected (bad nonce, no allowance, …) and never landed.
        if (attempt >= 3 && /INVALID_TRANSACTION/.test(broadcastError) && /UNKNOWN_TRANSACTION/.test(JSON.stringify(status?.error ?? ""))) {
          throw new Error(`${contract}.${method} rejected (tx ${tx}): ${broadcastError}`);
        }
        await sleep(3000);
      }
      throw new Error(`${contract}.${method}: no final status after ${FINAL_TIMEOUT_MS / 1000}s (tx ${tx}; check before retrying)`);
    },
  };
}

/** Signer from <PREFIX>_ACCOUNT / <PREFIX>_PRIVATE_KEY. */
export function signerFromEnv(network: Network, prefix: string): Signer {
  const account = process.env[`${prefix}_ACCOUNT`], key = process.env[`${prefix}_PRIVATE_KEY`];
  if (!account || !key) throw new Error(`set ${prefix}_ACCOUNT and ${prefix}_PRIVATE_KEY (scripts/add-keeper-keys.ts creates them)`);
  return signer(network, account, key);
}
