// Signs function calls with near-cli-rs, so keys stay in the OS keychain (or the legacy key file).
import { spawnSync } from "node:child_process";
import { RPC, type Network } from "./near.ts";

export type CallResult = { ok: boolean; tx?: string; output: string };

export function call(
  signer: string,
  contract: string,
  method: string,
  args: object,
  opts: { gas?: number; deposit?: string; network?: string; legacy?: boolean } = {},
): CallResult {
  // near-cli-rs prints the transaction log to stderr even on success, so read both streams.
  const r = spawnSync(
    "near",
    [
      "contract", "call-function", "as-transaction", contract, method, "json-args", JSON.stringify(args),
      "prepaid-gas", `${opts.gas ?? 100}.0 Tgas`, "attached-deposit", opts.deposit ?? "0 NEAR",
      "sign-as", signer, "network-config", opts.network ?? "testnet",
      opts.legacy ? "sign-with-legacy-keychain" : "sign-with-keychain", "send",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const output = `${r.stdout}${r.stderr}`;
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
  const tx = plain.match(/Transaction ID: (\w+)/)?.[1];
  return { ok: /succeeded/.test(plain) && !/panicked|Failure/.test(plain), tx, output: plain };
}

/** Every receipt failure in a transaction (a panic in a cross-contract callee isn't visible in the CLI output). */
export async function receiptFailures(tx: string, signer: string, network: Network = "testnet"): Promise<string[]> {
  const res = await fetch(RPC[network], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: tx, sender_account_id: signer, wait_until: "FINAL" } }),
  }).then((r) => r.json());
  return (res.result?.receipts_outcome ?? [])
    .filter((o: any) => o.outcome.status.Failure)
    .map((o: any) => `${o.outcome.executor_id}: ${JSON.stringify(o.outcome.status.Failure).match(/panicked: ([^"\\]*)/)?.[1] ?? JSON.stringify(o.outcome.status.Failure)}`);
}

/** Throws with the contract's panic message if the call, or any receipt it spawned, failed. */
export async function mustCall(...a: Parameters<typeof call>): Promise<CallResult> {
  const r = call(...a);
  const failures = r.tx ? await receiptFailures(r.tx, a[0], (a[4]?.network ?? "testnet") as Network) : [];
  if (!r.ok || failures.length) {
    const reason = failures.join("; ") || r.output.match(/(Smart contract panicked: [^\n]*|ExecutionError\([^\n]*)/)?.[0] || r.output.slice(-600);
    throw new Error(`${a[1]}.${a[2]} failed (tx ${r.tx ?? "?"}): ${reason}`);
  }
  return r;
}
