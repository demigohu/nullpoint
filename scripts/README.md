# scripts

Run from the repo root with `npm run <name>`, or directly with `node scripts/<file>`.

## For reviewers

| Command | Needs | What it does |
|---|---|---|
| `npm run demo` | nothing | Five checks against live data: vault state, MPC address recomputed, a real 1Click quote verified and a forged one rejected, the live position repriced ±20%, a compromised AI blocked |
| `npm run attack` | testnet agent keys | The agent's own keys try to steal: Hyperliquid `withdraw3`, `usdSend`, `agentSendAsset`, and a 1Click quote paying an attacker. All refused |
| `npm run attack:llm` | `NEARAI_API_KEY` | Prompt injection against the real model, then a fully compromised model, through the limits |
| `npm run simulate:crash` | nothing | A $1,000 position through BTC ±20% in a day, minute by minute |
| `npm run simulate:strategy` | optional `NEARAI_API_KEY` | Weeks of real Hyperliquid funding: hold BTC vs the rule vs the AI, after costs |
| `npm run e2e:testnet` | testnet keys | Deposit, sweep, report, and an MPC-signed withdrawal submitted from the user's account |

## For operators

| File | What |
|---|---|
| `deploy-testnet.sh` (`npm run deploy:testnet`) | Mock USDC, mock Intents, the vault and the agent account on testnet |
| `deploy-mainnet.sh` | Mainnet, one step at a time: `plan` (default, sends nothing), `accounts`, `contract`, `register` |
| `add-agent-keys.ts [--network mainnet]` | The agent's restricted keys, written to `.env` or `.env.mainnet` |
| `approve-agent.ts [--network mainnet]` | Approves the agent's Hyperliquid trading key through the vault (NEAR's signers sign `approveAgent`) |
| `reset-testnet.ts` (`npm run reset:testnet`) | Closes positions and redeploys testnet with fresh state on the same accounts |
| `check-keys.ts` | Checks the API keys in `.env` without printing them |
| `fixtures-oneclick.ts` | Fetches real 1Click quotes as contract test fixtures |
| `spike-chainsig-hl.ts`, `spike-intents-sig.ts` | The first day's feasibility checks: MPC as a Hyperliquid master, MPC-signed intents accepted by `intents.near` |
