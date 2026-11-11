import { LineChart } from "@/components/line-chart";
import { links } from "@/lib/config";
import { currentNet, fundingRadar, vaultOverview } from "@/lib/data";
import { paybackHours } from "@nullpoint/core";

const usd = (raw: string | number) => `$${(Number(raw) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export default async function Dashboard() {
  const net = await currentNet();
  const [ov, radar] = await Promise.all([vaultOverview(net).catch(() => null), fundingRadar("mainnet")]);
  if (!ov) {
    return (
      <main className="mx-auto max-w-7xl px-4 pt-12 md:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-4 text-text-2">The {net.network} vault isn&apos;t live yet. Switch to testnet in the top bar.</p>
      </main>
    );
  }
  const { state, decisions, signed, nav, hl, spot } = ov;
  const L = links(net);
  const active = state.positions[0]?.symbol ?? null;
  const spotUsd = spot.reduce((s, x) => s + x.usd, 0);
  const hlPos = hl?.assetPositions?.map((p: any) => p.position) ?? [];
  const activeRate = radar.find((r) => r.symbol === active)?.apr8h ?? 0;
  const navAge = state.snapshot ? ago(state.snapshot.ms) : "never";

  return (
    <main className="mx-auto max-w-7xl px-4 pt-12 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-text-3">
            {net.network} · NAV posted {navAge} · {state.paused ? <span className="text-danger">vault paused</span> : "vault running"}
          </p>
        </div>
        <a href={L.hlAddress(state.config.vault_address)} target="_blank" rel="noreferrer" className="text-sm text-text-2 underline-offset-2 hover:text-text hover:underline">
          Hyperliquid account of the vault
        </a>
      </div>

      <section className="mt-8 grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="NAV" value={state.snapshot ? usd(state.snapshot.nav) : "-"} />
        <Tile label="Share price" value={`$${ov.sharePrice.toFixed(4)}`} />
        <Tile label="Spot held (NEAR Intents)" value={`$${spotUsd.toFixed(2)}`} sub={spot.filter((s) => s.qty).map((s) => `${s.qty.toPrecision(4)} ${s.symbol}`).join(", ") || "none"} />
        <Tile label="Hyperliquid account" value={usd(state.account_value)} sub={hlPos.map((p: any) => `short ${Math.abs(Number(p.szi))} ${p.coin} @ ${Number(p.entryPx).toPrecision(5)}, liq ${p.liquidationPx ? Number(p.liquidationPx).toPrecision(5) : "none"}`).join("; ") || "no position"} />
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-panel border border-line bg-surface p-5">
          <h2 className="font-medium">NAV per share</h2>
          <div className="mt-4">
            {nav.length > 1 ? (
              <LineChart
                series={[{ key: "share", label: "Share", color: "var(--series-nav)", points: nav.map((p) => ({ x: p.ms, y: Number(p.nav) / Number(p.total_shares) })) }]}
                yFormat="usd3"
                xFormat="datetime"
                caption="Recorded on-chain by the vault at most every 10 minutes."
              />
            ) : (
              <p className="py-16 text-center text-sm text-text-3">One NAV point so far. The vault records one at most every 10 minutes while the keeper runs.</p>
            )}
          </div>
        </div>

        <div className="rounded-panel border border-line bg-surface p-5">
          <h2 className="font-medium">Funding radar</h2>
          <p className="text-xs text-text-3">Hyperliquid mainnet, annualised. Shorts earn positive funding.</p>
          <table className="num mt-4 w-full text-sm">
            <thead className="text-xs text-text-3">
              <tr>
                <th className="py-1 text-left font-normal">Asset</th>
                <th className="py-1 text-right font-normal">Now</th>
                <th className="py-1 text-right font-normal">8h avg</th>
                <th className="py-1 text-right font-normal">Payback</th>
              </tr>
            </thead>
            <tbody>
              {radar.map((r) => {
                const pb = active && r.symbol !== active ? paybackHours(40, r.apr8h - activeRate) : null;
                return (
                  <tr key={r.symbol} className="border-t border-line">
                    <td className="py-2">
                      {r.symbol}
                      {r.symbol === active && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">active</span>}
                    </td>
                    <td className="py-2 text-right">{r.aprNow.toFixed(1)}%</td>
                    <td className="py-2 text-right">{r.apr8h.toFixed(1)}%</td>
                    <td className="py-2 text-right text-text-2">{pb === null ? "-" : Number.isFinite(pb) ? `${Math.round(pb)}h` : "never"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-text-3">Payback: hours of extra funding to recover a 40 bps rotation. Rotations need ≤ 168h.</p>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-panel border border-line bg-surface p-5">
          <h2 className="font-medium">Strategist decisions</h2>
          <p className="text-xs text-text-3">Recorded on-chain with the NEAR AI Cloud chat id and the TEE address that signed the answer.</p>
          {decisions.length === 0 ? (
            <p className="mt-6 text-sm text-text-3">No decisions yet.</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {decisions.slice(-12).reverse().map((d) => (
                <li key={d.id} className="rounded-control bg-surface-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{d.action}{d.target ? ` ${d.target}` : ""}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${d.accepted ? "bg-accent-soft text-accent" : "bg-surface text-danger"}`}>{d.accepted ? "accepted" : "rejected"}</span>
                    <span className="text-xs text-text-3">{d.source === "llm" ? "LLM" : "rule"} · {ago(d.ms)}</span>
                  </div>
                  <p className="mt-1 text-text-2">{d.note}</p>
                  {d.chat_id && <p className="num mt-1 text-xs text-text-3">{short(d.chat_id)} signed by {short(d.signing_address)}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-panel border border-line bg-surface p-5">
          <h2 className="font-medium">Signed by MPC</h2>
          <p className="text-xs text-text-3">Everything the vault asked NEAR&apos;s MPC network to sign.</p>
          <ul className="mt-4 grid gap-2 text-sm">
            {signed.slice().reverse().map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                <span>{KIND[s.kind] ?? s.kind}</span>
                <span className="num text-xs text-text-3">{s.signature && s.signature !== "error" ? "signed" : "pending"} · {ago(s.ms)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}

const KIND: Record<string, string> = {
  intent_transfer: "Swap / margin via 1Click",
  intent_ft_withdraw: "User withdrawal",
  hl_approve_agent: "Approve Hyperliquid agent",
  hl_send_asset: "Pull margin from Hyperliquid",
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface p-5">
      <p className="text-sm text-text-3">{label}</p>
      <p className="num mt-1 text-2xl">{value}</p>
      {sub && <p className="num mt-1 truncate text-xs text-text-3" title={sub}>{sub}</p>}
    </div>
  );
}
