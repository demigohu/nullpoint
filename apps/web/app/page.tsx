import Link from "next/link";
import { ArrowRight, Lock, Robot, SealCheck, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { LineChart } from "@/components/line-chart";
import { currentNet, hedgeBacktest, vaultOverview } from "@/lib/data";

export default async function Landing() {
  const net = await currentNet();
  const [bt, ov] = await Promise.all([hedgeBacktest(30), vaultOverview(net).catch(() => null)]);
  const btcMove = bt.at(-1)!.btc - 100;
  const hedgedMove = bt.at(-1)!.hedged - 100;
  const lastDecision = ov?.decisions.at(-1);

  return (
    <main className="mx-auto max-w-7xl px-4 md:px-6">
      {/* Hero */}
      <section className="grid items-center gap-10 pt-12 pb-16 md:pt-20 lg:grid-cols-[1fr_1.15fr] [&>*]:min-w-0">
        <div>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl lg:text-6xl">
            Earn funding.
            <br />
            Not volatility.
          </h1>
          <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-text-2">
            Deposit USDC. A NEAR contract holds spot and shorts it on Hyperliquid, so price moves cancel and funding accrues.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className="inline-flex items-center gap-2 rounded-control bg-accent px-5 py-2.5 font-medium text-accent-ink transition active:scale-[0.98]">
              Open vault <ArrowRight weight="bold" />
            </Link>
            <Link href="/proof" className="inline-flex items-center rounded-control border border-line px-5 py-2.5 font-medium text-text hover:bg-surface-2">
              Check the proof
            </Link>
          </div>
        </div>
        <div className="rounded-panel border border-line bg-surface p-4 md:p-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-sm text-text-2">Last 30 days, indexed to 100</p>
            <p className="num text-sm">
              <span style={{ color: "var(--series-btc)" }}>BTC {btcMove >= 0 ? "+" : ""}{btcMove.toFixed(1)}%</span>
              <span className="mx-2 text-text-3">/</span>
              <span className="text-accent">hedged {hedgedMove >= 0 ? "+" : ""}{hedgedMove.toFixed(2)}%</span>
            </p>
          </div>
          <LineChart
            baseline={100}
            series={[
              { key: "btc", label: "BTC", color: "var(--series-btc)", points: bt.map((p) => ({ x: p.t, y: p.btc })) },
              { key: "hedged", label: "Hedged", color: "var(--series-nav)", points: bt.map((p) => ({ x: p.t, y: p.hedged })) },
            ]}
            caption="Simulated from real Hyperliquid mainnet BTC prices (4h) and hourly funding, using the vault's 2x split. Fees not included."
          />
        </div>
      </section>

      {/* Live state */}
      <section className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {ov ? (
          <>
            <Stat label={`Vault NAV (${net.network})`} value={`$${(Number(ov.state.snapshot?.nav ?? 0) / 1e6).toFixed(2)}`} />
            <Stat label="Hedging" value={ov.state.positions.map((p) => p.symbol).join(", ") || "Parked in USDC"} />
            <Stat label="Strategist decisions on-chain" value={String(ov.decisions.length)} />
            <Stat label="Last decision" value={lastDecision ? `${lastDecision.action}${lastDecision.target ? ` ${lastDecision.target}` : ""} (${lastDecision.source})` : "None yet"} />
          </>
        ) : (
          <div className="bg-surface p-6 sm:col-span-2 lg:col-span-4">
            <p className="font-medium">The {net.network} vault isn&apos;t live yet.</p>
            <p className="mt-1 text-sm text-text-2">Switch to testnet in the top bar to see the running vault.</p>
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="py-24">
        <h2 className="max-w-[22ch] text-3xl font-semibold tracking-tight md:text-4xl">Two legs, one contract, no price exposure.</h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-start">
          {[
            ["Deposit", "USDC goes into the vault contract on NEAR and you get shares priced off its on-chain NAV."],
            ["Hedge", "The contract buys spot BTC, ETH or NEAR through NEAR Intents and holds it. An equal short opens on Hyperliquid."],
            ["Earn", "Spot and short cancel each other. Longs pay the short funding every hour, and the share price rises."],
          ].map(([t, d], i) => (
            <li key={t} className="contents">
              {i > 0 && <ArrowRight className="hidden self-center text-text-3 md:block" size={20} />}
              <div>
                <h3 className="text-lg font-medium">{t}</h3>
                <p className="mt-2 max-w-[38ch] text-text-2">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Security */}
      <section>
        <h2 className="max-w-[24ch] text-3xl font-semibold tracking-tight md:text-4xl">The bot runs the trades. It can&apos;t take the money.</h2>
        <div className="mt-10 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-panel border border-line bg-surface p-6 lg:row-span-2">
            <ShieldCheck size={28} className="text-accent" />
            <h3 className="mt-4 text-xl font-medium">We tried to steal from it with the keeper&apos;s own keys</h3>
            <p className="mt-2 max-w-[52ch] text-text-2">
              The Hyperliquid account belongs to the vault contract through NEAR Chain Signatures. The keeper only holds a trading key.
            </p>
            <ul className="num mt-6 space-y-3 text-sm">
              {[
                ["withdraw to attacker", "Hyperliquid: attributed to the agent's own empty account"],
                ["agentSendAsset to attacker", "Hyperliquid: only to same user or sub-accounts"],
                ["1Click quote paying attacker", "Vault contract: quote not signed by 1Click"],
              ].map(([a, r]) => (
                <li key={a} className="rounded-control bg-surface-2 px-4 py-3">
                  <span className="text-text">{a}</span>
                  <span className="block text-text-3">rejected: {r}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-text-3">Run it yourself: scripts/attack.ts</p>
          </div>
          <div className="rounded-panel border border-line bg-accent-soft p-6">
            <SealCheck size={28} className="text-accent" />
            <h3 className="mt-4 text-lg font-medium">Every swap is checked on-chain</h3>
            <p className="mt-2 text-text-2">
              The contract verifies 1Click&apos;s ed25519 signature, the recipient and the price before NEAR&apos;s MPC network signs anything.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div className="rounded-panel border border-line bg-surface p-6">
              <Robot size={28} className="text-accent" />
              <h3 className="mt-4 text-lg font-medium">A boxed-in strategist</h3>
              <p className="mt-2 text-text-2">A private model on NEAR AI Cloud picks the asset. Hard limits decide what executes.</p>
            </div>
            <div className="rounded-panel border border-line bg-surface p-6">
              <Lock size={28} className="text-accent" />
              <h3 className="mt-4 text-lg font-medium">Withdraw without us</h3>
              <p className="mt-2 text-text-2">Signed withdrawals can be executed by the user. The keeper can&apos;t sit on your funds.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Risks */}
      <section className="py-24">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">What can still go wrong</h2>
        <dl className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
          {[
            ["Funding turns negative", "Shorts pay instead of earn. The vault parks in USDC when no asset pays, so yield can be zero."],
            ["Hyperliquid and bridges", "The short lives on Hyperliquid and spot is bridged BTC or ETH. Their failures are the vault's failures."],
            ["A bad trade by the keeper", "A stolen trading key can't withdraw, but it can trade the short badly. Limits cap it; they don't remove it."],
            ["Sharp rallies", "A fast move up squeezes the 2x short. The keeper shrinks both legs early; a large gap can still liquidate."],
          ].map(([t, d]) => (
            <div key={t}>
              <dt className="font-medium">{t}</dt>
              <dd className="mt-1 max-w-[52ch] text-text-2">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col items-start justify-between gap-6 rounded-panel border border-line bg-surface p-8 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Watch it run.</h2>
          <p className="mt-1 text-text-2">Positions, funding, and every strategist decision with its TEE signature.</p>
        </div>
        <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-control border border-line px-5 py-2.5 font-medium hover:bg-surface-2">
          Open dashboard <ArrowRight weight="bold" />
        </Link>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface p-5">
      <p className="text-sm text-text-3">{label}</p>
      <p className="num mt-1 truncate text-xl">{value}</p>
    </div>
  );
}
