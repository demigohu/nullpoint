// Signs NEAR function calls from a private key in the environment (no CLI, no keychain).
// Waits for FINAL so every receipt is in the outcome, and throws on any failed receipt:
// a panic in a cross-contract callee doesn't fail the outer transaction on its own.
import { Near } from "near-kit";
import { RPCS, type Network } from "@nullpoint/core";

export type Signer = {
  accountId: string;
  call(contract: string, method: string, args: object, opts?: { gas?: number; deposit?: string }): Promise<{ tx: string }>;
};

export function signer(network: Network, accountId: string, privateKey: string): Signer {
  const clients = RPCS[network].map(
    (rpcUrl) => new Near({ network: { networkId: network, rpcUrl }, privateKey: privateKey as `ed25519:${string}`, defaultSignerId: accountId }),
  );
  // Fall through to the next RPC only on 429: the endpoint refused the request, so nothing was
  // broadcast. Any other failure is surfaced, since re-signing would use a new nonce and could
  // execute the same action twice.
  const send = async (contract: string, method: string, args: object, opts: object) => {
    for (const [i, near] of clients.entries()) {
      try {
        return await near.call(contract, method, args, opts);
      } catch (e) {
        if ((e as { statusCode?: number }).statusCode !== 429 || i === clients.length - 1) throw e;
      }
    }
  };
  return {
    accountId,
    async call(contract, method, args, { gas = 100, deposit = "0 yocto" } = {}) {
      const out: any = await send(contract, method, args, { gas: `${gas} Tgas`, attachedDeposit: deposit as `${number} yocto`, waitUntil: "FINAL" });
      const tx: string = out.transaction?.hash ?? out.transaction_outcome?.id;
      const failures = (out.receipts_outcome ?? [])
        .filter((o: any) => o.outcome.status.Failure)
        .map((o: any) => `${o.outcome.executor_id}: ${JSON.stringify(o.outcome.status.Failure).match(/panicked: ([^"\\]*)/)?.[1] ?? JSON.stringify(o.outcome.status.Failure)}`);
      if (failures.length) throw new Error(`${contract}.${method} failed (tx ${tx}): ${failures.join("; ")}`);
      return { tx };
    },
  };
}

/** Signer from <PREFIX>_ACCOUNT / <PREFIX>_PRIVATE_KEY. */
export function signerFromEnv(network: Network, prefix: string): Signer {
  const account = process.env[`${prefix}_ACCOUNT`], key = process.env[`${prefix}_PRIVATE_KEY`];
  if (!account || !key) throw new Error(`set ${prefix}_ACCOUNT and ${prefix}_PRIVATE_KEY (scripts/add-keeper-keys.ts creates them)`);
  return signer(network, account, key);
}
