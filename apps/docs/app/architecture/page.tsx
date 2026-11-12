import { Doc } from "@/components/doc";

export const metadata = { title: "Architecture" };

const DIAGRAM = `           deposit / withdraw                 sign_quote, report_*, fulfill_withdraw
  User ───────────────────▶ vault contract (NEAR) ◀──────────────────── Agent (apps/agent)
                                 │   ▲                                   │      │
              MPC sign request   │   │ prices from signed 1Click quotes   │      │ trade-only key
                                 ▼   │                                   │      ▼
                     NEAR Chain Signatures                               │   Hyperliquid
                     (one EVM address = the vault)                       │   (short + funding)
                         │                    │                          │      ▲
                 signs intents         signs sendAsset                   │      │ collateral in/out
                         ▼                    ▼                          ▼      │
                 NEAR Intents account   Hyperliquid account ◀──── 1Click quotes ┘
                 (BTC / ETH / NEAR)     (same address)            (swaps, bridging)

  AI model on NEAR AI Cloud (enclave) ──signed decision──▶ Agent ──report_decision──▶ contract`;

export default function Architecture() {
  return (
    <Doc
      title="Architecture"
      lede="One NEAR contract holds the rules and the keys. One agent does the work. Four outside services each do one job, and none of them can move the vault's money on their own."
    >
      <pre aria-label="Architecture diagram">{DIAGRAM}</pre>

      <h2>Components</h2>
      <table>
        <thead><tr><th>Piece</th><th>Where</th><th>Job</th></tr></thead>
        <tbody>
          <tr><td>Vault contract</td><td><code>contracts/vault</code> (Rust, near-sdk)</td><td>Shares, share price, deposits and withdrawals, quote verification, building and requesting every signature, the AI decision log, pause.</td></tr>
          <tr><td>Agent</td><td><code>apps/agent</code> (Node, TypeScript)</td><td>Runs every minute: sweep, allocate, hedge, report, rotate, pay withdrawals. Holds a NEAR function-call key (vault only) and a Hyperliquid trading key.</td></tr>
          <tr><td>Web app</td><td><code>apps/web</code> (Next.js)</td><td>Deposit and withdraw with a review of every transaction, a live dashboard and the activity log.</td></tr>
          <tr><td>Shared code</td><td><code>packages/core</code></td><td>RPC helpers, address derivation, 1Click quote format, Hyperliquid signing helpers, the strategy limits.</td></tr>
          <tr><td>Testnet stand-ins</td><td><code>contracts/mock-verifier</code>, <code>contracts/mock-ft</code></td><td>NEAR Intents and 1Click have no testnet. The mock verifier copies <code>intents.near</code>&apos;s interface with real ERC-191 signature checks; mock USDC has an open mint.</td></tr>
        </tbody>
      </table>

      <h2>Outside services</h2>
      <table>
        <thead><tr><th>Service</th><th>Used for</th><th>Can it move funds alone?</th></tr></thead>
        <tbody>
          <tr><td>NEAR Chain Signatures</td><td>Derives the vault&apos;s EVM address and signs what the contract asks for (<code>v1.signer</code>)</td><td>No. It signs only what the contract requests.</td></tr>
          <tr><td>NEAR Intents (1Click)</td><td>Swaps, bridging USDC to and from Hyperliquid, and signed quotes as the price oracle</td><td>No. It fills intents the contract signed, which pay the vault.</td></tr>
          <tr><td>Hyperliquid</td><td>The short leg and its funding</td><td>The account belongs to the contract&apos;s address. The agent&apos;s key can trade only.</td></tr>
          <tr><td>NEAR AI Cloud</td><td>Runs the AI model in an enclave and signs its answers</td><td>No. It proposes; the limits decide; the agent executes within the contract&apos;s rules.</td></tr>
        </tbody>
      </table>

      <h2>Contract methods</h2>
      <table>
        <thead><tr><th>Caller</th><th>Methods</th></tr></thead>
        <tbody>
          <tr><td>Anyone</td><td><code>ft_on_transfer</code> (deposit), <code>request_withdraw</code>, <code>execute_withdraw</code>, <code>sweep</code>, views</td></tr>
          <tr><td>Agent</td><td><code>report_prices</code>, <code>report_position</code>, <code>report_decision</code>, <code>sign_quote</code>, <code>fulfill_withdraw</code></td></tr>
          <tr><td>Owner</td><td><code>set_agent</code>, <code>set_params</code>, <code>set_paused</code>, <code>set_margin_net</code>, <code>approve_agent</code> (Hyperliquid trading key)</td></tr>
        </tbody>
      </table>

      <h2>What the contract signs</h2>
      <ul>
        <li><b>Intent transfer</b> (ERC-191, for <code>intents.near</code>): swaps and collateral sent to Hyperliquid, always to the deposit address of a 1Click quote that pays the vault.</li>
        <li><b>Intent withdrawal</b>: USDC from the vault&apos;s Intents account to the user who asked for it.</li>
        <li><b>Hyperliquid sendAsset</b> (EIP-712): collateral back from Hyperliquid, again only through a verified 1Click quote.</li>
        <li><b>Hyperliquid approveAgent</b> (EIP-712): the agent&apos;s trading key, at the owner&apos;s request.</li>
      </ul>
      <p>The contract builds each payload from structured parameters. The agent never hands it bytes to sign.</p>

      <h2>Testnet and mainnet</h2>
      <table>
        <thead><tr><th>Part</th><th>Testnet</th><th>Mainnet</th></tr></thead>
        <tbody>
          <tr><td>USDC</td><td>Mock USDC with open mint</td><td>Native USDC on NEAR</td></tr>
          <tr><td>Intents</td><td>Mock verifier (real signature checks)</td><td><code>intents.near</code></td></tr>
          <tr><td>Swaps</td><td>Mock 1Click with its own signing key</td><td>1Click</td></tr>
          <tr><td>Short leg</td><td>Hyperliquid testnet (real)</td><td>Hyperliquid</td></tr>
          <tr><td>MPC</td><td><code>v1.signer-prod.testnet</code> (real)</td><td><code>v1.signer</code></td></tr>
        </tbody>
      </table>
    </Doc>
  );
}
