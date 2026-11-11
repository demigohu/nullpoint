// Hedgeable assets: NEP-141 token held in the vault's Intents account + Hyperliquid perp.
// Testnet uses the same token ids; the mock verifier keeps them as an internal ledger.
export type Asset = { symbol: string; tokenId: string; decimals: number; hlCoin: string };

export const ASSETS: Asset[] = [
  { symbol: "BTC", tokenId: "nep141:nbtc.bridge.near", decimals: 8, hlCoin: "BTC" },
  { symbol: "ETH", tokenId: "nep141:eth.bridge.near", decimals: 18, hlCoin: "ETH" },
  { symbol: "NEAR", tokenId: "nep141:wrap.near", decimals: 24, hlCoin: "NEAR" },
];

export const USDC_DECIMALS = 6;

export const assetBySymbol = (s: string) => ASSETS.find((a) => a.symbol === s) ?? (() => { throw new Error(`unknown asset ${s}`); })();
export const assetByToken = (t: string) => ASSETS.find((a) => a.tokenId === t);

/** USDC base units (6 dp) for `amount` base units of `asset` at `px` USD per coin. */
export function toUsdc(asset: Asset, amount: bigint, px: number): bigint {
  return (amount * BigInt(Math.round(px * 1e8)) * 10n ** 6n) / (10n ** BigInt(asset.decimals) * 10n ** 8n);
}

/** Asset base units bought with `usdc` (6 dp) at `px` USD per coin. */
export function fromUsdc(asset: Asset, usdc: bigint, px: number): bigint {
  return (usdc * 10n ** BigInt(asset.decimals) * 10n ** 8n) / (BigInt(Math.round(px * 1e8)) * 10n ** 6n);
}
