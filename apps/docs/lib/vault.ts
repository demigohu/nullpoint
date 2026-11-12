// Live reads for the Verify page. Mirrors apps/web/lib/config.ts for the two networks.
import { hlInfo, view, type Network } from "@nullpoint/core";

export const NETS = {
  testnet: { network: "testnet" as Network, deployed: true, vault: "vault.nullpoint.testnet", explorer: "https://testnet.nearblocks.io", hlApp: "https://app.hyperliquid-testnet.xyz", hlChain: "testnet" as const },
  mainnet: { network: "mainnet" as Network, deployed: true, vault: "vault.nullpoint.near", explorer: "https://nearblocks.io", hlApp: "https://app.hyperliquid.xyz", hlChain: "mainnet" as const },
};
export type Net = (typeof NETS)[keyof typeof NETS];

export type State = {
  owner: string;
  agent: string;
  config: { vault_address: string; verifier: string; mpc: string; mpc_path: string; usdc_token_id: string };
  snapshot: { nav: string; ms: number } | null;
  signed_count: number;
  paused: boolean;
};
export type Decision = { ms: number; source: string; action: string; target: string | null; accepted: boolean; chat_id: string; signing_address: string };
export type Signed = { kind: string; payload: string; digest: string; signature: string | null; ms: number };

export async function readVault(n: Net) {
  const state = await view<State>(n.network, n.vault, "get_state");
  const [decisions, signed, agents] = await Promise.all([
    view<[number, Decision][]>(n.network, n.vault, "get_decisions", { from: "0", limit: 500 }).then((d) => d.map(([, x]) => x)),
    view<[number, Signed][]>(n.network, n.vault, "get_signed", { from: String(Math.max(0, state.signed_count - 4)), limit: 4 }).then((d) => d.map(([id, x]) => ({ id, ...x }))),
    hlInfo<{ name: string; address: string }[]>(n.hlChain, { type: "extraAgents", user: state.config.vault_address }).catch(() => []),
  ]);
  return { state, decisions, signed, agents };
}

// Production builds (Vercel) link the live sites; `npm run dev` links the local ones. Env vars override.
const prod = process.env.NODE_ENV === "production";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? (prod ? "https://nullpoint.fun" : "http://localhost:3000");
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? (prod ? "https://docs.nullpoint.fun" : "http://localhost:3001");
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/demigohu/nullpoint";
export const STATUS_URL = process.env.NEXT_PUBLIC_STATUS_URL ?? "https://status.nullpoint.fun";
