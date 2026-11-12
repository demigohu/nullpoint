# apps/agent

The agent that runs the vault: on a schedule it sweeps deposits, reports signed prices, asks the AI for a decision, moves one step toward the target allocation, keeps each short equal to its coin, reports the Hyperliquid side, and pays withdrawals. Node 24, TypeScript run directly (no build step).

```bash
npm run agent           # testnet, reads ../../.env
npm run agent:mainnet   # mainnet, reads ../../.env.mainnet
npm run once -w agent   # one testnet run, then exit
```

Both can run on one host; each network has its own lock, journal (`.state/`, `.state/mainnet/`), keys and env file. On a server, `ecosystem.config.cjs` at the repo root runs both under pm2.

## What it needs

| Variable | What |
|---|---|
| `NETWORK` | `testnet` (default) or `mainnet` |
| `AGENT_ACCOUNT`, `AGENT_PRIVATE_KEY` | A function-call key that can only call the vault (`scripts/add-agent-keys.ts`) |
| `HL_AGENT_PRIVATE_KEY` | Hyperliquid trading key (or `.keys/[mainnet/]hl-agent.json`), approved by the vault with `scripts/approve-agent.ts` |
| `SOLVER_*` | Testnet only: the mock 1Click solver |
| `NEAR_INTENTS_API_KEY` | Mainnet: 1Click partner key |
| `NEARAI_API_KEY` | The AI strategist; without it a fixed rule decides |
| `NEAR_RPC_URLS` | Extra RPCs, tried first; the agent refuses to start if one serves the other network |
| `INTERVAL_S`, `STRATEGIST_INTERVAL_MIN` | 60 / 30 on testnet, 600 / 30 on mainnet |

Keep at least 0.5 NEAR free on the agent account: calls that ask NEAR's signers for a signature prepay about 0.3 NEAR of gas.

## Files

| File | What |
|---|---|
| `src/index.ts` | The cycle: allocation priorities, short-first swaps, hedge, report |
| `src/oneclick.ts` | Mainnet 1Click: quote, `/v0/submit-intent`, `/v0/status` |
| `src/mock1click.ts` | Testnet stand-in with the same interface (NEAR Intents and 1Click have no testnet) |
| `src/chain.ts` | NEAR transactions from a private key: sign once, re-broadcast the same bytes, poll to final; RPC network check |
| `src/journal.ts` | Process lock and the journal that finishes half-done moves after a crash |

How it decides and recovers, with a diagram: [docs → The agent cycle](../docs/content/docs/agent.mdx).
