import { Doc } from "@/components/doc";

export const metadata = { title: "How it works" };

export default function HowItWorks() {
  return (
    <Doc
      title="How it works"
      lede="The life of one deposit: from USDC in your wallet, to a coin and a short that cancel each other, to funding that raises the share price, and back to USDC."
    >
      <h2>1. Deposit</h2>
      <p>
        You send USDC to the vault contract with <code>ft_transfer_call</code>. The contract mints shares at the current share price: everything the vault owns,
        minus what it owes, divided by all shares. It refuses the deposit if that price is more than 10 minutes old, if the vault is paused, or if the deposit
        would take the vault over its cap. If it refuses, the token contract hands the USDC back in the same transaction.
      </p>

      <h2>2. Sweep</h2>
      <p>
        Within a minute the agent calls <code>sweep</code>, which moves new USDC from the contract into the vault's own NEAR Intents account. That account belongs
        to the Ethereum-style address the contract controls through NEAR Chain Signatures.
      </p>

      <h2>3. Hedge</h2>
      <p>The vault splits money two to one: two thirds buys the coin, one third becomes collateral on Hyperliquid for a short of the same size.</p>
      <ol>
        <li>The agent sends collateral to Hyperliquid through a 1Click quote (USDC on NEAR Intents to USDC on Hyperliquid), signed by the contract.</li>
        <li>It opens the short on Hyperliquid first, with its trading key.</li>
        <li>Only then does it buy the coin through a 1Click quote that pays the vault's Intents account. Short first means the vault never holds an unhedged coin.</li>
      </ol>
      <p>
        Every quote goes through <code>sign_quote</code>: the contract checks 1Click's ed25519 signature, that the vault is the recipient and refund address, the
        price against its oracle, the per-swap cap, and that the quote hasn't been used. Then it builds the intent itself and asks NEAR's MPC network to sign it.
      </p>

      <h2>4. Report and price</h2>
      <p>
        Every cycle the agent posts signed 1Click price quotes (<code>report_prices</code>) and the Hyperliquid side (<code>report_position</code>). The contract
        reads the coin and USDC balances itself, prices them, and checks the reported Hyperliquid account value against what it expects from the last accepted
        report, the collateral moved since, and the price change on the open short. A report off by more than 1% is rejected and the vault pauses. Accepted
        reports set the share price, recorded every 10 minutes.
      </p>

      <h2>5. Earn</h2>
      <p>
        While longs are crowded, Hyperliquid pays the short every hour. That money lands in the vault's Hyperliquid account, raises its value, and with it the
        share price. Price moves don't, because the coin and the short cancel.
      </p>

      <h2>6. Rotate</h2>
      <p>
        Every 30 minutes the agent asks its AI model (DeepSeek on NEAR AI Cloud, in a sealed enclave) whether to hold, switch to another coin, or wait in USDC.
        The model gets live funding for BTC, ETH and NEAR, the payback time of each switch (computed for it), and the vault's state. Its answer comes back signed
        by the enclave; the agent checks that signature against the enclave's attestation. Then fixed limits decide:
      </p>
      <table>
        <thead><tr><th>Limit</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Coins</td><td>BTC, ETH, NEAR only</td></tr>
          <tr><td>Leverage</td><td>1x to 2x</td></tr>
          <tr><td>Switches</td><td>At most 2 per 24 hours</td></tr>
          <tr><td>Minimum hold</td><td>6 hours per coin</td></tr>
          <tr><td>Payback</td><td>The extra funding must repay the ~0.4% switching cost within 168 hours</td></tr>
          <tr><td>Confidence</td><td>The model must report at least 0.6</td></tr>
        </tbody>
      </table>
      <p>
        Accepted or blocked, the decision is stored on-chain with the chat id and the enclave's address. If the model is unavailable, a fixed rule makes the
        same kind of decision under the same limits.
      </p>

      <h2>7. Withdraw</h2>
      <ol>
        <li>You call <code>request_withdraw(shares)</code>. Your shares leave your balance and the payout is queued.</li>
        <li>
          The agent frees enough USDC (shrinking the short first, then selling coin and pulling collateral) and calls <code>fulfill_withdraw</code>. The
          contract prices the shares at that moment and asks NEAR's signers to sign an Intents withdrawal to your account.
        </li>
        <li>
          The agent submits it and the USDC arrives, usually within 1-3 minutes. <code>execute_withdraw</code> has no caller check, so if the agent is down you can
          submit the signed payout yourself. The app offers this after 10 minutes.
        </li>
      </ol>
    </Doc>
  );
}
