import Link from "next/link";
import { Doc } from "@/components/doc";

export const metadata = { title: "Security model" };

export default function Security() {
  return (
    <Doc
      title="Security model"
      lede="Who can do what, what we tried in order to break it, and what can still go wrong. The short version: the agent can trade badly, but it can't take the money."
    >
      <h2>Who can do what</h2>
      <table>
        <thead><tr><th>Party</th><th>Can</th><th>Can&apos;t</th></tr></thead>
        <tbody>
          <tr>
            <td>Agent</td>
            <td>Place and close orders on Hyperliquid; bring 1Click quotes for the contract to sign; report positions and decisions</td>
            <td>Withdraw from Hyperliquid, send to another account, sign anything itself, change the share price by more than 1% per report, call any other contract</td>
          </tr>
          <tr>
            <td>AI model</td>
            <td>Propose hold, switch, park or a leverage change</td>
            <td>Pick a coin outside BTC, ETH, NEAR; exceed 2x; switch more than twice a day; propose any action that moves funds</td>
          </tr>
          <tr>
            <td>Owner</td>
            <td>Pause, change limits, replace the agent, correct the collateral record, and in this hackathon build upgrade the contract</td>
            <td>Call a method that pays the owner. There is none.</td>
          </tr>
          <tr>
            <td>Anyone</td>
            <td>Deposit, withdraw their own shares, submit a payout the contract already signed</td>
            <td>Redirect a signed payout. It names its recipient.</td>
          </tr>
        </tbody>
      </table>

      <h2>Attacks we ran</h2>
      <p>Run them yourself with <code>npm run attack</code> and <code>npm run attack:llm</code> (see <Link href="/run-it">Run it yourself</Link>).</p>
      <table>
        <thead><tr><th>Attempt</th><th>Result</th></tr></thead>
        <tbody>
          <tr><td>Agent key calls <code>withdraw3</code> to an outside wallet</td><td>Rejected by Hyperliquid: the action is billed to the agent&apos;s own empty account</td></tr>
          <tr><td>Agent key calls <code>usdSend</code> to an outside wallet</td><td>Rejected by Hyperliquid, same reason</td></tr>
          <tr><td>Agent key calls <code>agentSendAsset</code> to an outside wallet</td><td>Rejected by Hyperliquid: only to the same user or its sub-accounts</td></tr>
          <tr><td>Agent asks the contract to sign a quote that pays the attacker</td><td>Rejected by the contract: quote not signed by 1Click</td></tr>
          <tr><td>Hostile &quot;market notes&quot; injected into the AI&apos;s prompt</td><td>The model&apos;s answer still goes through the limits</td></tr>
          <tr><td>A fully compromised model asks for SOL, 20x, or a withdrawal to <code>0xdead</code></td><td>Blocked by the limits: not allowlisted, outside 1-2x, unknown action</td></tr>
        </tbody>
      </table>

      <h2>Built to fail safe</h2>
      <ul>
        <li><b>Short first.</b> Every swap adjusts the short before spot changes. If Hyperliquid refuses the order, the swap never happens.</li>
        <li><b>No report when off-hedge.</b> If coin and short drift apart, the agent waits and fixes the hedge instead of reporting. Deposits pause on a stale price rather than mint at a wrong one.</li>
        <li><b>Crash recovery.</b> Every fund move is journaled (quote, signed, executed, filled). After a crash the agent checks <code>is_nonce_used</code> and finishes what it started. Tested with a forced crash right after a signature.</li>
        <li><b>One agent at a time.</b> A process lock refuses a second agent on the same host.</li>
        <li><b>Withdrawals don&apos;t depend on us.</b> Anyone can submit a signed payout, and it can only pay the person who asked.</li>
      </ul>

      <h2>What can still go wrong</h2>
      <table>
        <thead><tr><th>Risk</th><th>What happens</th></tr></thead>
        <tbody>
          <tr><td>Funding turns negative</td><td>Shorts pay instead of earning. The agent switches coins or waits in USDC; some weeks earn nothing.</td></tr>
          <tr><td>Hyperliquid or a bridge fails</td><td>The short lives on Hyperliquid and the BTC and ETH are bridged tokens. If either breaks, the vault loses with it.</td></tr>
          <tr><td>The agent trades badly</td><td>A stolen agent key can&apos;t withdraw, but it can trade the short badly. Limits cap the damage.</td></tr>
          <tr><td>A sharp rally</td><td>A fast jump squeezes the 2x short. The agent adds collateral early (below 3x maintenance), but a big enough gap can still liquidate it.</td></tr>
          <tr><td>The agent reports a slightly wrong value</td><td>The contract allows 1% drift per report. Repeated drift would show in the share-price history, and the owner can pause.</td></tr>
          <tr><td>Unaudited code</td><td>This is a hackathon build. Mainnet runs with a small deposit cap.</td></tr>
        </tbody>
      </table>
    </Doc>
  );
}
