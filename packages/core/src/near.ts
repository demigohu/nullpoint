// Minimal NEAR JSON-RPC helpers (no keys needed). Shared by agent, scripts and the web app.
// Free public endpoints rate-limit, so each call falls through a list on 429 / 5xx / network errors.
export const RPCS = {
  testnet: ["https://rpc.testnet.near.org", "https://near-testnet.drpc.org", "https://rpc.testnet.fastnear.com"],
  mainnet: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org", "https://near.drpc.org"],
} as const;

export type Network = keyof typeof RPCS;

/** NEAR_RPC_URLS (comma-separated, server-side only) is tried before the public endpoints. */
const endpoints = (network: Network) => {
  const extra = typeof process !== "undefined" ? (process.env?.NEAR_RPC_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean) : [];
  return [...new Set([...extra, ...RPCS[network]])];
};

export async function rpc(network: Network, method: string, params: object): Promise<any> {
  let last: unknown;
  for (const url of endpoints(network)) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const body = await res.json().catch(() => null);
      if (res.status === 429 || res.status >= 500 || !body || body.error?.code === -429) {
        last = new Error(`${url} [${res.status}]`);
        continue;
      }
      return body;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`all ${network} RPCs failed: ${String((last as Error)?.message ?? last)}`);
}

export async function view<T = any>(network: Network, contract: string, method: string, args: object = {}): Promise<T> {
  const body = await rpc(network, "query", {
    request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  const error = body.error ? JSON.stringify(body.error) : body.result?.error;
  if (error) throw new Error(`${contract}.${method}: ${error}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result)));
}
