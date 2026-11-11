import { VaultPanel } from "@/components/vault-panel";
import { currentNet, vaultOverview } from "@/lib/data";

export default async function AppPage() {
  const net = await currentNet();
  const ov = await vaultOverview(net).catch(() => null);
  return (
    <main className="mx-auto max-w-7xl px-4 pt-12 md:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Vault</h1>
      <p className="mt-2 max-w-[60ch] text-text-2">Deposit USDC for shares. Their value tracks the vault&apos;s NAV: spot plus the Hyperliquid account, priced on-chain.</p>
      <div className="mt-8">
        {ov ? (
          <VaultPanel
            net={net}
            sharePrice={ov.sharePrice}
            navAgeS={ov.state.snapshot ? Math.round((Date.now() - ov.state.snapshot.ms) / 1000) : null}
            maxNavAgeS={ov.state.params.max_nav_age_s}
            withdrawalCount={ov.state.withdrawal_count}
          />
        ) : (
          <div className="rounded-panel border border-line bg-surface p-8">
            <p className="font-medium">The {net.network} vault isn&apos;t live yet.</p>
            <p className="mt-1 text-text-2">Switch to testnet in the top bar to use the running vault.</p>
          </div>
        )}
      </div>
    </main>
  );
}
