// Minimal NEAR JSON-RPC view helper (no keys needed). Shared by keeper, scripts and the web app.
export const RPC = {
  testnet: "https://rpc.testnet.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
} as const;

export type Network = keyof typeof RPC;

export async function view<T = any>(network: Network, contract: string, method: string, args: object = {}): Promise<T> {
  const res = await fetch(RPC[network], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: {
        request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const body = await res.json();
  const error = body.error ? JSON.stringify(body.error) : body.result?.error;
  if (error) throw new Error(`${contract}.${method}: ${error}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result)));
}
