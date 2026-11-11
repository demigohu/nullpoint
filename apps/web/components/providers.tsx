"use client";
import { NearProvider } from "near-connect-hooks";
import type { Network } from "@nullpoint/core";

// Keyed by network: switching testnet/mainnet remounts the wallet connector.
export function Providers({ network, children }: { network: Network; children: React.ReactNode }) {
  return (
    <NearProvider key={network} config={{ network }}>
      {children}
    </NearProvider>
  );
}
