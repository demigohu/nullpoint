import Link from "next/link";
import { Assets } from "@/components/landing/assets";
import { Cycle } from "@/components/landing/cycle";
import { Hero } from "@/components/landing/hero";
import { Loader } from "@/components/landing/loader";
import { Manifesto } from "@/components/landing/manifesto";
import { Smooth } from "@/components/landing/smooth";
import { TwoLegs } from "@/components/landing/two-legs";
import { Wordmark } from "@/components/hud";
import { pace } from "@/lib/config";
import { currentNet, fundingRadar, hedgeBacktest, vaultOverview } from "@/lib/data";
import { MODES } from "@/lib/modes";
import { DOCS_URL } from "@/lib/config";

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

type Pace = ReturnType<typeof pace>;

const guards = (p: Pace) => [
  ["Every swap is checked on-chain", "Before NEAR's signers sign anything, the contract checks 1Click's signature, who gets paid, and the price."],
  ["Every AI decision is on the record", "Each call the model makes is stored on-chain with its enclave signature, including the ones the limits threw out."],
  ["Withdrawals pay out on their own", `The agent pays queued withdrawals in order. If one waits more than ${p.stuckMin} minutes, you can finish it from your wallet.`],
] as const;

const RISKS = [
  ["Funding turns negative", "Then shorts pay instead of earning. The agent moves to another coin or waits in USDC, so some weeks the vault earns nothing."],
  ["Hyperliquid or a bridge fails", "The short lives on Hyperliquid, and the BTC and ETH are bridged tokens. If either one breaks, the vault loses with it."],
  ["The agent trades badly", "A stolen agent key can't withdraw, but it can trade the short badly. The limits cap the damage. They don't remove it."],
  ["A sharp rally", "A fast jump in price squeezes the short. The agent adds collateral early, but a big enough gap can still liquidate it."],
] as const;

const steps = (p: Pace) => [
  ["Connect a NEAR wallet", "Any NEAR wallet works. Connecting only shares your account name; nothing is signed or sent."],
  ["Deposit USDC", `You get shares at the vault's current share price, less a 0.5% deposit fee that pays for the swaps, and the agent hedges your money ${p.hedge}. On testnet, get free test USDC from the account menu.`],
  ["Withdraw whenever you want", `Ask for your USDC back and it lands in your wallet, usually ${p.payout}. There's no lockup, and a 0.5% fee pays for selling your part of the coin.`],
] as const;

const faq = (yearly: number, p: Pace): [string, string][] => [
  ["Is my money safe?", "Your USDC sits in a smart contract on NEAR, and only that contract can sign money out of the vault's accounts. The agent that runs it can trade but can't withdraw. It is still new code that hasn't been audited, so only put in what you're fine testing with."],
  ["Where does the yield come from?", "From funding: the hourly fee that traders betting on prices going up pay to the traders betting against them. The vault is always on the side that gets paid, with an equal amount of the coin held so price swings cancel."],
  ["How much can I earn?", `It moves with funding. Over the last 30 days the hedged strategy made about ${yearly.toFixed(1)}% a year in a simulation on real Hyperliquid data. Some weeks it earns nothing, and the dashboard shows the live rate.`],
  ["When can I get my money back?", `Any time. Your USDC usually arrives ${p.payout}. If the agent is ever down for more than ${p.stuckMin} minutes, the app lets you finish the withdrawal yourself.`],
  ["What does it cost?", "0.5% when you deposit and 0.5% when you withdraw. Both go to the swaps that move your money in and out, so the people already in never pay for you. NullPoint keeps 5% of what the vault earns, and only above its previous high: if the share price dips, there's no fee until it has climbed back. Switching coins costs the vault about 0.4%, which is why the agent only switches when the extra yield pays that back within a week."],
  ["Can I lose money?", "Yes. Funding can turn negative, Hyperliquid or a bridge can fail, and a very sharp rally can hurt the short. The risks section above explains each one."],
  ["Who holds the keys?", "The contract does, through NEAR Chain Signatures. The agent only has a trading key. The owner can pause the vault, change its limits and, in this hackathon build, upgrade the contract. No method sends the vault's funds to the owner; the only thing NullPoint receives is its 5% performance fee, as shares."],
];

const title = "wdth-118 text-[clamp(2.2rem,4.6vw,5.4rem)] font-extrabold leading-[0.9] tracking-[-0.045em]";

export default async function Landing() {
  const net = await currentNet();
  const p = pace(net);
  const [bt, ov, radar] = await Promise.all([hedgeBacktest(30), vaultOverview(net).catch(() => null), fundingRadar(net.hlChain).catch(() => [])]);
  const longShare = ov?.hedge.longShare ?? 0.5;
  const hedgedYear = ((bt.at(-1)!.hedged - bt[0]!.hedged) / bt[0]!.hedged) * 100 * (365 / 30);

  return (
    <main>
      <Smooth />
      <Loader />
      <Hero longShare={longShare} coin={ov && ov.hedge.mode !== "park" ? MODES[ov.hedge.mode].label : "BTC"} />
      <TwoLegs bt={bt} longShare={longShare} />

      <section className="grid gap-[var(--pad)] p-[var(--pad)] py-[clamp(4rem,10vw,9rem)] lg:grid-cols-12">
        <div className="lg:col-span-4">
          <h2 className={title}>Start in three steps.</h2>
          <Link href="/app" className="btn mt-8" data-label="Deposit USDC">Deposit USDC</Link>
        </div>
        <ol className="lg:col-span-8">
          {steps(p).map(([h, b], i) => (
            <li key={h} className="grid gap-2 border-t border-tc py-6 sm:grid-cols-[5rem_1fr] sm:gap-6">
              <span aria-hidden className="wdth-125 text-[clamp(3rem,5vw,4.5rem)] font-extrabold leading-[0.8] tracking-[-0.05em]">{i + 1}</span>
              <div>
                <h3 className="wdth-110 text-[clamp(1.3rem,1.9vw,1.9rem)] font-bold leading-tight tracking-[-0.03em]">{h}</h3>
                <p className="mt-2 max-w-[56ch] text-[16px] leading-[1.5]">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
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
              <a href={`${DOCS_URL}/verify`} className="underline underline-offset-2">check it live ↗</a>
            </p>
          </div>
          {guards(p).map(([h, b]) => (
            <div key={h} className="panel p-[var(--pad)] md:col-span-5">
              <h3 className="wdth-110 text-[clamp(1.2rem,1.6vw,1.6rem)] font-bold tracking-[-0.03em]">{h}</h3>
              <p className="mt-2 text-[15px] leading-[1.5]">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="risks" className="p-[var(--pad)] py-[clamp(4rem,10vw,9rem)]">
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

      <section className="grid gap-[var(--pad)] p-[var(--pad)] pb-[clamp(4rem,10vw,9rem)] lg:grid-cols-12">
        <h2 className={`${title} lg:col-span-4`}>Questions people ask</h2>
        <div className="lg:col-span-8">
          {faq(hedgedYear, p).map(([q, a]) => (
            <details key={q} className="faq group border-t border-tc">
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-6 py-5">
                <span className="wdth-110 text-[clamp(1.15rem,1.5vw,1.5rem)] font-bold tracking-[-0.03em]">{q}</span>
                <span aria-hidden className="num text-[1.6rem] leading-none group-open:hidden">+</span>
                <span aria-hidden className="num hidden text-[1.6rem] leading-none group-open:inline">−</span>
              </summary>
              <p className="max-w-[62ch] pb-6 text-[16px] leading-[1.55]">{a}</p>
            </details>
          ))}
        </div>
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
            {net.network === "testnet"
              ? "Running on NEAR testnet with test USDC. Nothing here is real money yet."
              : `Running on NEAR mainnet with real USDC, capped at $${ov ? Number(ov.state.params.max_tvl) / 1e6 : 100} while the contract is unaudited.`}
          </p>
        </div>
      </section>
    </main>
  );
}
