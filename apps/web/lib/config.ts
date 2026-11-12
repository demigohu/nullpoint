import type { Network } from "@nullpoint/core";

export type NetConfig = {
  network: Network;
  /** False until the vault is live on this network; pages show an empty state instead of data. */
  deployed: boolean;
  vault: string;
  verifier: string;
  usdc: string;
  usdcDecimals: number;
  nearExplorer: string;
  hlApp: string;
  hlChain: "testnet" | "mainnet";
  /** Minutes between agent runs (INTERVAL_S) and between share-price records (nav_history_interval_s). */
  agentMin: number;
  navEveryMin: number;
};

export const NETS: Record<Network, NetConfig> = {
  testnet: {
    network: "testnet",
    deployed: true,
    vault: "vault.nullpoint.testnet",
    verifier: "verifier.nullpoint.testnet",
    usdc: "usdc.nullpoint.testnet",
    usdcDecimals: 6,
    nearExplorer: "https://testnet.nearblocks.io",
    hlApp: "https://app.hyperliquid-testnet.xyz",
    hlChain: "testnet",
    agentMin: 1,
    navEveryMin: 10,
  },
  mainnet: {
    network: "mainnet",
    deployed: true,
    vault: "vault.nullpoint.near",
    verifier: "intents.near",
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    usdcDecimals: 6,
    nearExplorer: "https://nearblocks.io",
    hlApp: "https://app.hyperliquid.xyz",
    hlChain: "mainnet",
    agentMin: 10,
    navEveryMin: 30,
  },
};

/** How long the agent takes, in words: it acts once per run, so a deposit or payout waits up to two runs. */
export const pace = (c: NetConfig) =>
  c.agentMin <= 1
    ? { hedge: "within a minute or so", payout: "within 1-3 minutes", stuckMin: 10 }
    : { hedge: `within about ${c.agentMin} minutes`, payout: `within ${c.agentMin}-${2 * c.agentMin} minutes`, stuckMin: 3 * c.agentMin };

export const NET_COOKIE = "np_net";
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3001";
export const DEFAULT_NET: Network = (process.env.NEXT_PUBLIC_DEFAULT_NET as Network) ?? "testnet";

export const links = (c: NetConfig) => ({
  account: (a: string) => `${c.nearExplorer}/address/${a}`,
  tx: (h: string) => `${c.nearExplorer}/txns/${h}`,
  hlAddress: (a: string) => `${c.hlApp}/explorer/address/${a}`,
  hlTx: (h: string) => `${c.hlApp}/explorer/tx/${h}`,
});
