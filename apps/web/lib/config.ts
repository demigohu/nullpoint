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
  },
  mainnet: {
    network: "mainnet",
    deployed: false,
    vault: "vault.nullpoint.near",
    verifier: "intents.near",
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    usdcDecimals: 6,
    nearExplorer: "https://nearblocks.io",
    hlApp: "https://app.hyperliquid.xyz",
    hlChain: "mainnet",
  },
};

export const NET_COOKIE = "np_net";
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3001";
export const DEFAULT_NET: Network = (process.env.NEXT_PUBLIC_DEFAULT_NET as Network) ?? "testnet";

export const links = (c: NetConfig) => ({
  account: (a: string) => `${c.nearExplorer}/address/${a}`,
  tx: (h: string) => `${c.nearExplorer}/txns/${h}`,
  hlAddress: (a: string) => `${c.hlApp}/explorer/address/${a}`,
});
