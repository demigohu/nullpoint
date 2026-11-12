import Link from "next/link";
import { Doc } from "@/components/doc";
import { APP_URL } from "@/lib/nav";

export default function Overview() {
  return (
    <Doc
      title="NullPoint in five minutes"
      lede="A USDC vault on NEAR that earns perpetual-futures funding without taking a view on price. It holds a coin and an equal short, so price moves cancel and the hourly funding is what's left. An AI agent runs it, and a smart contract decides where money may go."
    >
      <h2>The idea</h2>
      <p>
        On Hyperliquid, most traders bet on prices going up, often with borrowed money. To keep that market close to the real price, the crowded side pays the
        other side every hour. That payment is called funding, and when the longs are crowded it goes to whoever is short.
      </p>
      <p>
        NullPoint takes the short side and also holds the same amount of the coin. If BTC drops 10%, the coin loses what the short gains. If BTC rises, the
        reverse. Your share's value stays flat and collects the funding. People call this a delta-neutral or basis trade. Usually a fund runs it with its own
        exchange keys and you trust the fund. Here a contract holds the keys.
      </p>

      <h2>What makes it different</h2>
      <ul>
        <li>
          <b>The contract owns the exchange account.</b> Through NEAR Chain Signatures, the vault contract controls one Ethereum-style address. That address is
          both its NEAR Intents account (where the coins sit) and its Hyperliquid account (where the short lives). Nothing leaves either account unless the
          contract asks NEAR's signers to sign it.
        </li>
        <li>
          <b>The agent can trade and nothing else.</b> The bot that runs the vault holds a Hyperliquid key that can place orders but can't withdraw or send, plus a
          NEAR key that can only call the vault contract.
        </li>
        <li>
          <b>Every swap is checked on-chain.</b> The agent brings signed 1Click quotes. The contract verifies 1Click's signature, insists the vault is the
          recipient, checks the price against its own oracle and a per-swap cap, and only then builds and signs the transaction itself.
        </li>
        <li>
          <b>The contract prices the vault.</b> It reads coin balances from the Intents contract and prices them with signed quotes. The agent only reports the
          Hyperliquid side, and a report that's off by more than 1% is rejected.
        </li>
        <li>
          <b>An AI picks the coin, inside hard limits.</b> A model on NEAR AI Cloud, running in a sealed enclave, decides whether to hold, switch between BTC, ETH
          and NEAR, or wait in USDC. Limits it can't override: three coins only, leverage 1-2x, at most two switches a day, six hours per coin, and a switch
          must pay back its cost within a week. Every decision is stored on-chain with the enclave's signature.
        </li>
      </ul>

      <h2>Where to go next</h2>
      <ul>
        <li><Link href="/how-it-works">How it works</Link>: the life of a deposit, from USDC to hedge to withdrawal.</li>
        <li><Link href="/architecture">Architecture</Link>: the contract, the agent, and the services they use.</li>
        <li><Link href="/security">Security model</Link>: what each party can and can't do, and what can still go wrong.</li>
        <li><Link href="/verify">Verify it live</Link>: every claim above, checked against the chain when you open the page.</li>
        <li><Link href="/run-it">Run it yourself</Link>: clone, run the demo without keys, or run the whole thing on testnet.</li>
        <li><a href={APP_URL}>The app</a>: deposit test USDC and watch the agent work on the dashboard.</li>
      </ul>
    </Doc>
  );
}
