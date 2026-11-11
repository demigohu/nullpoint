import { paybackHours } from "@nullpoint/core";
import { FieldCanvas } from "@/components/field/field-canvas";
import { LineChart } from "@/components/line-chart";
import { Term } from "@/components/term";
import { describeDecision, describeSigned } from "@/lib/activity";
import { links } from "@/lib/config";
import { currentNet, fundingRadar, vaultOverview } from "@/lib/data";
import { MODES, modeOf } from "@/lib/modes";

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const money = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function Dashboard() {
  const net = await currentNet();
  const [ov, radar] = await Promise.all([vaultOverview(net).catch(() => null), fundingRadar("mainnet").catch(() => [])]);
  if (!ov) {
    return (
      <main className="p-[var(--pad)] pt-28">
        <h1 className="wdth-118 text-[clamp(2.2rem,4.6vw,5.4rem)] font-extrabold leading-[0.9] tracking-[-0.045em]">What the vault is doing right now</h1>
        <p className="mt-4">The {net.network} vault isn&apos;t live yet. Switch to testnet in the top bar.</p>
      </main>
    );
  }
  const { state, decisions, signed, nav, hl, spot, hedge } = ov;
  const L = links(net);
  const active = hedge.symbol;
  const activeRate = radar.find((r) => r.symbol === active)?.apr8h ?? 0;
  const tvl = Number(state.snapshot?.nav ?? 0) / 1e6;
  const shorts: { coin: string; szi: string; entryPx: string; liquidationPx: string | null }[] = hl?.assetPositions?.map((p: { position: never }) => p.position) ?? [];
  const feed = [...signed.map((s) => describeSigned(s, state.config.usdc_token_id)), ...decisions.slice(-20).map(describeDecision)].sort((a, b) => b.ms - a.ms).slice(0, 14);

  const stats = [
    ["Share price", `$${ov.sharePrice.toFixed(4)}`, `Recorded ${state.snapshot ? ago(state.snapshot.ms) : "never"}`],
    ["Total deposits", money(tvl), `${(Number(state.total_shares) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} shares`],
    ["Funding now", active ? `${activeRate.toFixed(1)}%` : "0%", active ? `a year, on ${active} (8h average)` : "Parked in USDC"],
    ["Hedge gap (Δ)", active ? `${hedge.delta >= 0 ? "+" : "−"}${Math.abs(hedge.delta).toFixed(4)}` : "0", "Coin held minus the short. Near zero means fully hedged."],
  ] as const;

  return (
    <main className="grid gap-[var(--pad)] p-[var(--pad)] pt-28">
      <header className="grid gap-4 md:grid-cols-12 md:items-end">
        <h1 className="wdth-118 text-[clamp(2.2rem,4.6vw,5.4rem)] font-extrabold leading-[0.9] tracking-[-0.045em] md:col-span-8">What the vault is doing right now</h1>
        <p className="font-mono text-[12px] leading-[1.6] md:col-span-4 md:text-right">
          {net.network} · {state.paused ? <span className="bg-alarm px-1 text-fc">vault paused</span> : "running"} ·{" "}
          {active ? `hedging ${active}` : "parked in USDC"}
          <br />
          <a href={L.hlAddress(state.config.vault_address)} target="_blank" rel="noreferrer" className="underline underline-offset-2">The vault&apos;s Hyperliquid account ↗</a>
        </p>
      </header>

      <section className="grid gap-[var(--pad)] sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, sub]) => (
          <div key={label} className="border-t border-tc pt-3">
            <p className="chip">{label}</p>
            <p className="num mt-3 text-[clamp(2.2rem,4vw,4rem)] font-bold leading-none tracking-[-0.04em]">{value}</p>
            <p className="mt-2 text-[13px] leading-[1.4]">{sub}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-[var(--pad)] lg:grid-cols-12">
        <div className="panel p-[var(--pad)] lg:col-span-8">
          <h2 className="wdth-110 text-[clamp(1.3rem,1.8vw,1.8rem)] font-bold tracking-[-0.03em]">
            <Term k="share price">Share price</Term> over time
          </h2>
          <div className="mt-4">
            {nav.length > 1 ? (
              <LineChart
                series={[{ key: "share", label: "Share", points: nav.map((p) => ({ x: p.ms, y: Number(p.nav) / Number(p.total_shares) })) }]}
                yFormat="usd3"
                xFormat="datetime"
                caption="Recorded on-chain every 10 minutes."
              />
            ) : (
              <p className="py-16 text-center text-[14px]">One point so far. The vault records the share price every 10 minutes while the keeper runs.</p>
            )}
          </div>
        </div>

        <div className="grid gap-[var(--pad)] lg:col-span-4">
          <div className="panel p-[var(--pad)]">
            <h2 className="wdth-110 text-[clamp(1.3rem,1.8vw,1.8rem)] font-bold tracking-[-0.03em]">
              <Term k="funding">Funding</Term> across the three coins
            </h2>
            <p className="mt-1 text-[13px]">Hyperliquid mainnet, a year. The short earns it when positive.</p>
            <ul className="mt-4 grid grid-cols-3 gap-2">
              {radar.map((r) => {
                const m = modeOf(r.symbol);
                const pb = active && r.symbol !== active ? paybackHours(40, r.apr8h - activeRate) : null;
                return (
                  <li key={r.symbol} style={{ "--t": MODES[m].t, "--f": MODES[m].f } as React.CSSProperties} className="bg-fc text-tc">
                    <div className="relative aspect-square border border-tc">
                      <FieldCanvas mode={m} cell={14} speed={0.35} />
                    </div>
                    <div className="p-2 font-mono text-[12px] leading-[1.4]">
                      <p className="font-bold">{r.symbol}{r.symbol === active && " · held"}</p>
                      <p>{r.apr8h.toFixed(1)}%</p>
                      <p>{pb === null ? "" : Number.isFinite(pb) ? `payback ${Math.round(pb)}h` : "never pays back"}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[12px] leading-[1.4]">Payback: hours of extra funding needed to recover a switch (0.4%). The limits allow 168h at most.</p>
          </div>

          <div className="panel p-[var(--pad)]">
            <h2 className="chip">The two legs</h2>
            <dl className="num mt-3 grid gap-2 text-[13px]">
              <div className="flex justify-between gap-3"><dt>Long (NEAR Intents)</dt><dd>{spot.filter((s) => s.qty).map((s) => `${s.qty.toPrecision(4)} ${s.symbol}`).join(", ") || "none"}</dd></div>
              {shorts.map((p) => (
                <div key={p.coin} className="flex justify-between gap-3"><dt>Short (Hyperliquid)</dt><dd>{p.szi} {p.coin} @ {Number(p.entryPx).toPrecision(5)}</dd></div>
              ))}
              <div className="flex justify-between gap-3"><dt>Hyperliquid account</dt><dd>{money(Number(state.account_value) / 1e6)}</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="panel p-[var(--pad)]">
        <h2 className="wdth-110 text-[clamp(1.3rem,1.8vw,1.8rem)] font-bold tracking-[-0.03em]">What happened, in order</h2>
        <p className="mt-1 text-[13px]">
          Every <Term k="MPC signature" /> the vault requested and every strategist decision, newest first.
        </p>
        <ol className="mt-4">
          {feed.map((a, i) => (
            <li key={i} className="grid gap-1 border-t border-tc py-3 md:grid-cols-12">
              <span className="font-mono text-[12px] md:col-span-2">{ago(a.ms)}</span>
              <div className="md:col-span-10">
                <p className={`text-[15px] leading-[1.45] ${a.ok ? "" : "text-alarm"}`}>{a.text}</p>
                <p className="num mt-1 break-all text-[11px]">{a.tech}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
