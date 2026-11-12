import { Doc } from "@/components/doc";
import { REPO_URL } from "@/lib/nav";

export const metadata = { title: "Run it yourself" };

export default function RunIt() {
  return (
    <Doc
      title="Run it yourself"
      lede="Three levels: a demo that needs no keys and no money, the attack scripts against the live testnet vault, and the whole system on your own testnet accounts."
    >
      <h2>Requirements</h2>
      <ul>
        <li>Node 24 or newer (the scripts run TypeScript directly) and npm 11</li>
        <li>For contracts: Rust, <code>cargo-near</code> and <code>near-cli-rs</code></li>
      </ul>
      <pre>{`git clone ${REPO_URL}
cd nullpoint
npm install`}</pre>

      <h2>1. The demo: no keys, no funds</h2>
      <pre>npm run demo</pre>
      <p>Five checks against live data, in under a minute:</p>
      <ol>
        <li>Reads the live testnet vault: share price, positions, paused or not.</li>
        <li>Recomputes the vault&apos;s address from its contract account through NEAR Chain Signatures and compares it with the configured one.</li>
        <li>Fetches a real mainnet 1Click quote and verifies its ed25519 signature the way <code>sign_quote</code> does; the same quote with the recipient swapped to an attacker fails.</li>
        <li>Simulates BTC moving 20% either way: the hedged NAV stays flat.</li>
        <li>Feeds a compromised strategist&apos;s wish list through the limits: all blocked.</li>
      </ol>

      <h2>2. Try to break it</h2>
      <pre>{`npm run attack        # the agent's own keys try to steal (needs .keys/hl-agent.json)
npm run attack:llm    # prompt injection and a fully compromised model (needs NEARAI_API_KEY)
npm run simulate:crash     # BTC ±20% in a day, minute by minute
npm run simulate:strategy  # 21 days of real funding: hold vs rule vs AI`}</pre>
      <p>Contract tests, including the forged-quote cases:</p>
      <pre>{`cd contracts && cargo test`}</pre>

      <h2>3. The whole system on testnet</h2>
      <ol>
        <li>Create a testnet account (for example with <code>near account create-account</code>) and fund it from the faucet.</li>
        <li>
          Deploy the vault, mock Intents contract, mock USDC and an agent account under it:
          <pre>{`OWNER=you.testnet npm run deploy:testnet`}</pre>
        </li>
        <li>
          Create the agent&apos;s restricted keys (a function-call key that can only call the vault) and the mock solver key. They are written to <code>.env</code>:
          <pre>{`cd scripts && OWNER=you.testnet node add-agent-keys.ts`}</pre>
        </li>
        <li>
          Approve the agent&apos;s Hyperliquid trading key through the contract (MPC signs <code>approveAgent</code>):
          <pre>{`OWNER=you.testnet node approve-agent.ts`}</pre>
        </li>
        <li>
          Fill in the rest of <code>.env</code> from <code>.env.example</code> (NEAR AI Cloud key for the AI, optional paid RPC), then start the agent:
          <pre>{`npm run agent`}</pre>
        </li>
        <li>
          Start the app and the docs:
          <pre>{`npm run dev   # web on :3000, docs on :3001`}</pre>
        </li>
        <li>Connect a testnet wallet, get test USDC from the account menu, deposit, and watch the dashboard.</li>
      </ol>
      <p>
        The end-to-end script exercises deposit, sweep, report and an MPC-signed withdrawal without the agent: <code>npm run e2e:testnet</code>. To start over
        on the same accounts, <code>npm run reset:testnet</code> closes positions and redeploys with fresh state.
      </p>

      <h2>Environment</h2>
      <table>
        <thead><tr><th>Variable</th><th>What it is</th></tr></thead>
        <tbody>
          <tr><td><code>AGENT_ACCOUNT</code>, <code>AGENT_PRIVATE_KEY</code></td><td>The agent&apos;s NEAR function-call key (vault only)</td></tr>
          <tr><td><code>HL_AGENT_PRIVATE_KEY</code></td><td>The agent&apos;s Hyperliquid trading key</td></tr>
          <tr><td><code>SOLVER_ACCOUNT</code>, <code>SOLVER_PRIVATE_KEY</code>, <code>SOLVER_HL_PRIVATE_KEY</code></td><td>Testnet only: the mock 1Click solver</td></tr>
          <tr><td><code>NEARAI_API_KEY</code></td><td>NEAR AI Cloud, for the AI model (without it a fixed rule decides)</td></tr>
          <tr><td><code>NEAR_INTENTS_API_KEY</code></td><td>1Click partner key (mainnet quotes)</td></tr>
          <tr><td><code>NEAR_RPC_URLS</code></td><td>Optional comma-separated RPC endpoints tried first</td></tr>
          <tr><td><code>INTERVAL_S</code>, <code>STRATEGIST_INTERVAL_MIN</code></td><td>Agent cycle (60 s) and AI cadence (30 min)</td></tr>
        </tbody>
      </table>
      <p>Keys never go in the repository: <code>.env</code> and <code>.keys/</code> are git-ignored.</p>
    </Doc>
  );
}
