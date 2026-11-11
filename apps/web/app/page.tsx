import Link from "next/link";
import { Assets } from "@/components/landing/assets";
import { Cycle } from "@/components/landing/cycle";
import { Hero } from "@/components/landing/hero";
import { Loader } from "@/components/landing/loader";
import { Manifesto } from "@/components/landing/manifesto";
import { Smooth } from "@/components/landing/smooth";
import { TwoLegs } from "@/components/landing/two-legs";
import { Wordmark } from "@/components/hud";
import { currentNet, fundingRadar, hedgeBacktest, vaultOverview } from "@/lib/data";
import { MODES } from "@/lib/modes";

// Copy: COPY.md "Landing". Layout and motion: DESIGN.md §7.
const BUILT_WITH = [
  ["NEAR Protocol", "Hosts the vault contract. It mints your shares, prices them, and decides where every dollar is allowed to go."],
  ["NEAR Chain Signatures", "Gives the contract its own Ethereum-style address. That address owns the vault's Hyperliquid and Intents accounts, so nothing leaves unless the contract signs."],
  ["NEAR Intents (1Click)", "Swaps USDC for BTC, ETH or NEAR and moves collateral to Hyperliquid. Its signed quotes also tell the contract what prices are."],
  ["NEAR AI Cloud", "Runs the agent's AI model in a sealed enclave. Every answer comes back signed, so anyone can check which model said what."],
  ["Hyperliquid", "Holds the short and pays funding every hour. The agent's key there can trade. It can't withdraw."],
] as const;

const ATTACKS = [
  ["Withdraw the vault's USDC to an outside wallet", "Hyperliquid charged the agent's own empty account. The vault lost nothing."],
  ["Send the vault's USDC to another account", "Hyperliquid refused: an agent can only move funds inside the account it works for."],
  ["Get the contract to sign a swap that pays the attacker", "The vault refused: the quote wasn't signed by 1Click."],
] as const;

const GUARDS = [
  ["Every swap is checked on-chain", "Before NEAR's signers sign anything, the contract checks 1Click's signature, who gets paid, and the price."],
  ["Every AI decision is on the record", "Each call the model makes is stored on-chain with its enclave signature, including the ones the limits threw out."],
  ["Withdrawals pay out on their own", "The agent pays queued withdrawals in order. If one waits more than 10 minutes, you can finish it from your wallet."],
] as const;

const RISKS = [
  ["Funding turns negative", "Then shorts pay instead of earning. The agent moves to another coin or waits in USDC, so some weeks the vault earns nothing."],
  ["Hyperliquid or a bridge fails", "The short lives on Hyperliquid, and the BTC and ETH are bridged tokens. If either one breaks, the vault loses with it."],
  ["The agent trades badly", "A stolen agent key can't withdraw, but it can trade the short badly. The limits cap the damage. They don't remove it."],
  ["A sharp rally", "A fast jump in price squeezes the short. The agent adds collateral early, but a big enough gap can still liquidate it."],
] as const;

const title = "wdth-118 text-[clamp(2.2rem,4.6vw,5.4rem)] font-extrabold leading-[0.9] tracking-[-0.045em]";

export default async function Landing() {
  const net = await currentNet();
  const [bt, ov, radar] = await Promise.all([hedgeBacktest(30), vaultOverview(net).catch(() => null), fundingRadar("mainnet").catch(() => [])]);
  const longShare = ov?.hedge.longShare ?? 0.5;

  return (
    <main>
      <Smooth />
      <Loader />
      <Hero longShare={longShare} coin={ov && ov.hedge.mode !== "park" ? MODES[ov.hedge.mode].label : "BTC"} />
      <TwoLegs bt={bt} longShare={longShare} />
      <Cycle liveMode={ov?.hedge.mode ?? "park"} />
      {radar.length > 0 && <Assets radar={radar} active={ov?.hedge.symbol ?? null} />}

      <section className="p-[var(--pad)] py-[clamp(4rem,10vw,9rem)]">
        <h2 className={title}>Built on NEAR. Hedged on Hyperliquid.</h2>
        <ul className="mt-10 border-t border-tc">
          {BUILT_WITH.map(([name, job]) => (
            <li key={name} className="group relative grid gap-2 border-b border-tc py-5 md:grid-cols-12 md:items-baseline">
              <span aria-hidden className="absolute inset-0 bg-tc [clip-path:inset(0_100%_0_0)] transition-[clip-path] duration-[280ms] ease-[var(--ease-hud)] group-hover:[clip-path:inset(0)]" />
              <h3 className="wdth-118 relative text-[clamp(1.6rem,3vw,3.4rem)] font-bold leading-none tracking-[-0.04em] transition-colors duration-[280ms] group-hover:text-fc md:col-span-6">{name}</h3>
              <p className="relative max-w-[56ch] text-[15px] leading-[1.5] transition-colors duration-[280ms] group-hover:text-fc md:col-span-6">{job}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-[var(--pad)] p-[var(--pad)] py-[clamp(4rem,10vw,9rem)]">
        <h2 className={`${title} max-w-[18ch]`}>The agent runs the trades. It can&apos;t take the money.</h2>
        <Manifesto text="Hedged funds usually ask you to trust whoever holds the exchange keys. Here a smart contract holds them. The agent gets a key that can place trades and do nothing else. Money moves only when the contract signs, and the contract only signs a swap that pays the vault, at a fair price, under a cap." />
        <div className="mt-8 grid gap-[var(--pad)] md:grid-cols-12">
          <div className="bg-tc p-[var(--pad)] text-fc md:col-span-7 md:row-span-3">
            <h3 className="wdth-112 text-[clamp(1.5rem,2.4vw,2.6rem)] font-bold leading-[1.02] tracking-[-0.035em]">We tried to rob it with the agent&apos;s own keys.</h3>
            <ul className="num mt-8 grid gap-4 text-[14px]">
              {ATTACKS.map(([a, r]) => (
                <li key={a} className="border-t border-fc pt-3">
                  <p className="font-bold">{a}</p>
                  <p>{r}</p>
                </li>
              ))}
            </ul>
            <p className="num mt-8 text-[13px]">
              Run the attack yourself: <code>npm run attack</code> ·{" "}
              <Link href="/proof" className="underline underline-offset-2">see the proof ↗</Link>
            </p>
          </div>
          {GUARDS.map(([h, b]) => (
            <div key={h} className="panel p-[var(--pad)] md:col-span-5">
              <h3 className="wdth-110 text-[clamp(1.2rem,1.6vw,1.6rem)] font-bold tracking-[-0.03em]">{h}</h3>
              <p className="mt-2 text-[15px] leading-[1.5]">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="p-[var(--pad)] py-[clamp(4rem,10vw,9rem)]">
        <h2 className={title}>What can still go wrong</h2>
        <dl className="mt-10 grid gap-x-[var(--pad)] gap-y-8 border-t border-tc pt-8 md:grid-cols-2">
          {RISKS.map(([t, d]) => (
            <div key={t}>
              <dt className="font-mono text-[12px] uppercase tracking-[0.2em]">{t}</dt>
              <dd className="mt-2 max-w-[52ch] text-[16px] leading-[1.5]">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="overflow-hidden border-t border-tc">
        <div aria-hidden className="marquee flex w-max whitespace-nowrap py-6 font-mono text-[clamp(3rem,10vw,9rem)] font-bold leading-none">
          {[0, 1].map((k) => (
            <span key={k} className="pr-[0.5em]">
              NULLPOINT&nbsp;&nbsp;+/−&nbsp;&nbsp;BTC&nbsp;&nbsp;ETH&nbsp;&nbsp;NEAR&nbsp;&nbsp;0&nbsp;&nbsp;NULLPOINT&nbsp;&nbsp;+/−&nbsp;&nbsp;BTC&nbsp;&nbsp;ETH&nbsp;&nbsp;NEAR&nbsp;&nbsp;0&nbsp;&nbsp;
            </span>
          ))}
        </div>
        <div className="grid gap-[var(--pad)] border-t border-tc p-[var(--pad)] md:grid-cols-12 md:items-end">
          <p className={`${title} md:col-span-7`}>Long one, short one, net zero.</p>
          <div className="flex flex-wrap items-center gap-3 md:col-span-5 md:justify-end">
            <Link href="/app" className="btn" data-label="Deposit USDC">Deposit USDC</Link>
            <a href="#main" className="btn btn-ghost" data-label="Start over">Start over</a>
          </div>
          <p className="font-mono text-[12px] md:col-span-12">
            <Wordmark /> ·{" "}
            {net.network === "testnet" ? "Running on NEAR testnet with test USDC. Nothing here is real money yet." : "Running on NEAR mainnet."}
          </p>
        </div>
      </section>
    </main>
  );
}
