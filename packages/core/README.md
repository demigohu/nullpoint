# packages/core

Shared TypeScript used by the agent, the web app, the docs and the scripts. Shipped as source (Node 24 and Next.js `transpilePackages` run it directly).

| Module | What |
|---|---|
| `near.ts` | Keyless NEAR JSON-RPC (`view`, `rpc`) that falls through a list of public endpoints on rate limits and errors |
| `mpc.ts` | NEAR Chain Signatures: derive the EVM address a contract controls at a path (`deriveEvmAddress`) |
| `oneclick.ts` | 1Click quotes and the exact message 1Click signs, so the contract can verify it (`signedMessage`, `getQuote`) |
| `intents.ts` | MPC signature → NEAR Intents `secp256k1:` signature |
| `hyperliquid.ts` | Hyperliquid info calls and submitting actions the vault built and NEAR's signers signed |
| `assets.ts` | The allowlist (BTC, ETH, NEAR): token ids, decimals, Hyperliquid coin |
| `strategy.ts` | The fixed rule, the limits every decision must pass, payback math, margin emergency |
| `strategist.ts` | The AI strategist on NEAR AI Cloud, with TEE signature checks (`@nullpoint/core/strategist`, Node only) |
| `node.ts` | Owner-side calls through near-cli-rs, so keys stay in the OS keychain (`@nullpoint/core/node`) |

```bash
npm test -w @nullpoint/core   # MPC derivation against known addresses, strategy rule and limits
```
