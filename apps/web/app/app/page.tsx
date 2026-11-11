import { FieldCanvas } from "@/components/field/field-canvas";
import { Term } from "@/components/term";
import { VaultPanel } from "@/components/vault-panel";
import { currentNet, vaultOverview } from "@/lib/data";

export default async function AppPage() {
  const net = await currentNet();
  const ov = await vaultOverview(net).catch(() => null);
  return (
    <main className="grid min-h-[100dvh] md:grid-cols-2">
      <section className="relative min-h-[40dvh] overflow-hidden md:sticky md:top-0 md:h-[100dvh]">
        <FieldCanvas longShare={ov?.hedge.longShare ?? 0.5} speed={0.35} interactive />
        <div className="absolute bottom-[var(--pad)] left-[var(--pad)] right-[var(--pad)] max-w-[30rem]">
          <div className="panel p-[var(--pad)]">
            <h1 className="wdth-118 text-[clamp(2rem,3.6vw,4rem)] font-extrabold leading-[0.9] tracking-[-0.045em]">Your vault</h1>
            <p className="mt-3 text-[15px] leading-[1.5]">
              Deposit USDC for <Term k="share">shares</Term>. The vault <Term k="hedge">hedges</Term> it and collects <Term k="funding">funding</Term>, so the{" "}
              <Term k="share price" /> rises while price moves cancel.
            </p>
            {ov && (
              <p className="num mt-3 text-[12px]">
                Field: long {(ov.hedge.longShare * 100).toFixed(1)}%, short {(100 - ov.hedge.longShare * 100).toFixed(1)}%
                {ov.hedge.symbol ? ` · hedging ${ov.hedge.symbol}` : " · parked in USDC"}
              </p>
            )}
          </div>
        </div>
      </section>
      <section className="p-[var(--pad)] md:pt-28">
        {ov ? (
          <VaultPanel net={net} withdrawalCount={ov.state.withdrawal_count} />
        ) : (
          <div className="panel p-[var(--pad)]">
            <p className="font-bold">The {net.network} vault isn&apos;t live yet.</p>
            <p className="mt-1 text-[15px]">Switch to testnet in the top bar to use the running vault.</p>
          </div>
        )}
      </section>
    </main>
  );
}
