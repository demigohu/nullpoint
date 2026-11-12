import { LIMITS, guardrail, paybackHours, ruleDecision, type Context } from "@nullpoint/core";
import { ActivityFeed } from "@/components/activity-feed";
import { FieldCanvas } from "@/components/field/field-canvas";
import { LineChart } from "@/components/line-chart";
import { Term } from "@/components/term";
import { describeDecision, describeSigned } from "@/lib/activity";
import { links } from "@/lib/config";
import { currentNet, fundingRadar, vaultOverview } from "@/lib/data";
import { MODES, modeOf } from "@/lib/modes";

// Copy: COPY.md "/dashboard". Layout: DESIGN.md §7.
const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const money = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const H1 = "wdth-118 text-[clamp(2rem,3.6vw,3.8rem)] font-extrabold leading-[0.95] tracking-[-0.04em]";
const H2 = "wdth-110 text-[clamp(1.25rem,1.6vw,1.6rem)] font-bold tracking-[-0.03em]";
const MOVES: Record<string, (t: string | null) => string> = { ROTATE: (t) => `Switched to ${t}`, RESUME: (t) => `Started hedging ${t}`, PARK: () => "Parked in USDC" };

export default async function Dashboard() {
  const net = await currentNet();
  const [ov, radar, seen] = await Promise.all([
    vaultOverview(net).catch(() => null),
    fundingRadar("mainnet").catch(() => []),
    // The funding the agent itself acts on (testnet agent reads Hyperliquid testnet).
    fundingRadar(net.hlChain).catch(() => []),
  ]);
  if (!ov) {
    return (
      <main className="p-[var(--pad)] pt-28">
        <h1 className={H1}>What the vault is doing right now</h1>
        <p className="mt-4">The {net.network} vault isn&apos;t live yet. Switch to testnet in the account menu.</p>
      </main>
    );
  }
  const { state, decisions, signed, nav, hl, spot, hedge } = ov;
  const L = links(net);
  const active = hedge.symbol;
  const activeRate = radar.find((r) => r.symbol === active)?.apr8h ?? 0;
  const tvl = Number(state.snapshot?.nav ?? 0) / 1e6;
  const shorts: { coin: string; szi: string; entryPx: string; positionValue: string; liquidationPx: string | null }[] = hl?.assetPositions?.map((p: { position: never }) => p.position) ?? [];
  const main = shorts.slice().sort((a, b) => Number(b.positionValue) - Number(a.positionValue))[0];
  const accountValue = Number(hl?.marginSummary?.accountValue ?? 0);
  const shortUsd = shorts.reduce((t, p) => t + Number(p.positionValue), 0);
  const spotUsd = spot.reduce((t, x) => t + x.usd, 0);
  const leverage = accountValue > 0 ? shortUsd / accountValue : 0;
  const mainMark = main ? Number(main.positionValue) / Math.abs(Number(main.szi)) : 0;
  const toLiq = main?.liquidationPx ? (Number(main.liquidationPx) / mainMark - 1) * 100 : null;

  // AI vs the backup rule, on the funding the agent sees right now.
  const moves = decisions.filter((d) => d.accepted && ["ROTATE", "RESUME", "PARK"].includes(d.action));
  const ctx: Context = {
    active: hedge.mode === "park" ? null : (moves.at(-1)?.target ?? "BTC"),
    heldSinceMs: moves.at(-1)?.ms ?? 0,
    nowMs: Date.now(),
    rotationsLast24h: moves.filter((d) => d.action === "ROTATE" && Date.now() - d.ms < 86_400_000).length,
    rotationCostBps: 40,
    allowlist: ["BTC", "ETH", "NEAR"],
  };
  const rule = seen.length ? ruleDecision(ctx, seen.map((r) => ({ symbol: r.symbol, fundingAprNow: r.aprNow, fundingApr8h: r.apr8h, openInterestUsd: r.oiUsd }))) : null;
  const ruleOk = rule ? guardrail(rule, ctx, seen.map((r) => ({ symbol: r.symbol, fundingAprNow: r.aprNow, fundingApr8h: r.apr8h, openInterestUsd: r.oiUsd }))).ok : false;
  const lastAi = decisions.filter((d) => d.source === "llm").at(-1);
  const said = (a: string, t: string | null) => `${a}${t ? ` ${t}` : ""}`;
  // Where each answer leaves the vault: HOLD keeps the current coin, PARK means USDC.
  const holding = (a: string, t: string | null | undefined, cur: string | null) => (a === "PARK" ? "USDC" : a === "ROTATE" || a === "RESUME" ? (t ?? cur) : cur ?? "USDC");
  const feed = [...signed.map((s) => describeSigned(s, state.config.usdc_token_id)), ...decisions.map(describeDecision)].sort((a, b) => b.ms - a.ms);
  const markers = decisions.filter((d) => d.accepted && d.action in MOVES).map((d) => ({ x: d.ms, label: MOVES[d.action]!(d.target) }));
  const firstPrice = nav.length ? Number(nav[0]!.nav) / Number(nav[0]!.total_shares) : ov.sharePrice;

  const stats = [
    ["Share price", `$${ov.sharePrice.toFixed(4)}`, `Updated ${state.snapshot ? ago(state.snapshot.ms) : "never"}. ${((ov.sharePrice / firstPrice - 1) * 100).toFixed(2)}% since the first record.`],
    ["Vault size", money(tvl), `${(Number(state.total_shares) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} shares outstanding`],
    ["Funding now", active ? `${activeRate.toFixed(1)}%` : "0%", active ? `A year, on ${active}, averaged over the last 8 hours` : "Waiting in USDC, earning nothing"],
    ["Hedge gap", active ? `${hedge.delta >= 0 ? "+" : "−"}${Math.abs(hedge.delta).toFixed(4)}` : "0", active ? `${active} held minus ${active} shorted. Close to zero means fully hedged.` : "No coin held, nothing to hedge."],
  ] as const;

  return (
    <main className="grid gap-[clamp(1.5rem,3vw,2.5rem)] p-[var(--pad)] pt-28">
      <header className="grid gap-3">
        <h1 className={H1}>What the vault is doing right now</h1>
        <div className="flex flex-wrap gap-2 font-mono text-[12px]">
          <span className="chip">{net.network}</span>
          <span className={state.paused ? "bg-alarm px-2 py-1 text-fc" : "border border-tc px-2 py-1"}>{state.paused ? "paused" : "running"}</span>
          <span className="border border-tc px-2 py-1">{active ? `hedging ${active}` : "waiting in USDC"}</span>
          <span className="border border-tc px-2 py-1">last report {state.snapshot ? ago(state.snapshot.ms) : "never"}</span>
          <a href={L.hlAddress(state.config.vault_address)} target="_blank" rel="noreferrer" className="border border-tc px-2 py-1 underline underline-offset-2">Hyperliquid account ↗</a>
          <a href={L.account(net.vault)} target="_blank" rel="noreferrer" className="border border-tc px-2 py-1 underline underline-offset-2">Vault contract ↗</a>
        </div>
      </header>

      <section className="grid gap-[var(--pad)] sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, sub]) => (
          <div key={label} className="border-t border-tc pt-3">
            <p className="chip">{label}</p>
            <p className="num mt-3 text-[clamp(2rem,3.4vw,3.4rem)] font-bold leading-none tracking-[-0.04em]">{value}</p>
            <p className="mt-2 max-w-[34ch] text-[13px] leading-[1.4]">{sub}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-[var(--pad)] lg:grid-cols-12">
        {/* contents below lg, so the AI panel can drop below the side column on phones */}
        <div className="contents lg:col-span-7 xl:col-span-8 lg:grid lg:content-start lg:gap-[var(--pad)]">
        <div className="panel p-[var(--pad)]">
          <h2 className={H2}>
            <Term k="share price">Share price</Term> over time
          </h2>
          <p className="mt-1 max-w-[70ch] text-[13px] leading-[1.45]">
            Deposits and withdrawals pay their own swaps through a {state.params.entry_fee_bps / 100}% entry and {state.params.exit_fee_bps / 100}% exit cost that stays in the vault, so they barely move this line. A switch between coins costs about 0.4%, a small step down at a ◆ marker, which funding then has to earn back. NullPoint keeps {state.params.performance_fee_bps / 100}% of gains above the previous high.
          </p>
          <div className="mt-4">
            <LineChart
              series={[{ key: "share", label: "Share", points: nav.map((p) => ({ x: p.ms, y: Number(p.nav) / Number(p.total_shares) })) }]}
              yFormat="usd3"
              ranges
              markers={markers}
              caption="The contract records the share price every 10 minutes."
            />
          </div>
        </div>

          <div className="panel p-[var(--pad)] max-lg:order-1">
            <h2 className="chip">The AI vs the backup rule</h2>
            <dl className="mt-3 grid gap-3 text-[14px] leading-[1.45]">
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.15em]">Latest AI decision</dt>
                <dd>{lastAi ? <><b>{said(lastAi.action, lastAi.target)}</b> {ago(lastAi.ms)}, {lastAi.accepted ? "allowed" : "blocked"} by the limits</> : "None yet"}</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.15em]">The rule, on today&apos;s funding</dt>
                <dd>{rule ? <><b>{said(rule.action, rule.target ?? null)}</b>: {rule.reasoning}{ruleOk ? "" : " (the limits would block it now)"}</> : "No funding data"}</dd>
              </div>
            </dl>
            {lastAi && rule && (
              <p className="mt-3 border-t border-tc pt-3 text-[13px]">
                {holding(lastAi.action, lastAi.target, ctx.active) === holding(rule.action, rule.target, ctx.active)
                  ? `They agree: hold ${holding(rule.action, rule.target, ctx.active)}.`
                  : `They differ: the AI chose ${holding(lastAi.action, lastAi.target, ctx.active)}, the rule would pick ${holding(rule.action, rule.target, ctx.active)}. The AI weighs more than the rule (how long a spike lasts, market size); both answer to the same limits.`}
              </p>
            )}
            <p className="mt-2 text-[12px] leading-[1.4]">The rule takes over whenever the AI is unavailable. Funding here is what the agent reads: Hyperliquid {net.hlChain}.</p>
          </div>
        </div>

        <div className="grid content-start gap-[var(--pad)] lg:col-span-5 xl:col-span-4">
          <div className="panel p-[var(--pad)]">
            <h2 className="chip">Both sides right now</h2>
            <dl className="num mt-3 grid gap-2 text-[13px]">
              <div className="flex justify-between gap-3"><dt>Coin held (NEAR Intents)</dt><dd className="text-right">{spot.filter((s) => s.qty).map((s) => `${s.qty.toPrecision(4)} ${s.symbol}`).join(", ") || "none"}</dd></div>
              {shorts.map((p) => (
                <div key={p.coin} className="flex justify-between gap-3"><dt>Short {p.coin} (Hyperliquid)</dt><dd className="text-right">{Math.abs(Number(p.szi))} @ ${Number(p.entryPx).toLocaleString()}</dd></div>
              ))}
              <div className="flex justify-between gap-3"><dt>Collateral on Hyperliquid</dt><dd>{money(Number(state.account_value) / 1e6)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Idle USDC in the vault</dt><dd>{money(Number(state.snapshot?.usdc_in_verifier ?? 0) / 1e6)}</dd></div>
            </dl>
            <dl className="num mt-4 grid gap-2 border-t border-tc pt-3 text-[13px]">
              <div className="flex justify-between gap-3"><dt>Hedge ratio (short ÷ coin)</dt><dd>{spotUsd > 0 ? `${((shortUsd / spotUsd) * 100).toFixed(1)}%` : "-"}</dd></div>
              <div className="flex justify-between gap-3"><dt>Leverage on Hyperliquid</dt><dd>{leverage ? `${leverage.toFixed(2)}x (limit ${LIMITS.maxLeverage}x)` : "-"}</dd></div>
              <div className="flex justify-between gap-3">
                <dt>{main ? `${main.coin} rise that would liquidate` : "Liquidation"}</dt>
                <dd>{toLiq === null ? "-" : `+${toLiq.toFixed(0)}%`}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[12px] leading-[1.4]">The agent adds collateral if the account falls below 3x the margin Hyperliquid requires, long before liquidation.</p>
          </div>

          <div className="panel p-[var(--pad)]">
            <h2 className={H2}>
              What each coin pays (<Term k="funding">funding</Term>)
            </h2>
            <p className="mt-1 text-[13px]">Live from Hyperliquid mainnet, as a yearly rate. Positive means the short gets paid.</p>
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
                      <p>{r.apr8h.toFixed(1)}% a year</p>
                      <p>{pb === null ? "" : Number.isFinite(pb) && pb < 24 * 365 ? `pays back in ${Math.round(pb)}h` : "not worth a switch"}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[12px] leading-[1.4]">
              Payback is how many hours of extra funding it takes to earn back the 0.4% cost of switching. The agent only switches when that is 168 hours (7 days) or less.
            </p>
          </div>

        </div>
      </section>

      <section className="panel p-[var(--pad)]">
        <h2 className={H2}>Everything the vault did</h2>
        <p className="mt-1 max-w-[80ch] text-[13px] leading-[1.45]">
          Every <Term k="MPC signature" /> the contract asked for and every decision the AI made, newest first. Filter by kind, and open any entry to see its
          transaction, every field and the exact payload that was signed.
        </p>
        <div className="mt-5">
          <ActivityFeed items={feed} explorer={net.nearExplorer} hlAccount={L.hlAddress(state.config.vault_address)} />
        </div>
      </section>
    </main>
  );
}
