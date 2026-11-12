# NullPoint

A USDC vault on NEAR that earns perpetual-futures funding without taking a position on price. It holds a coin (BTC, ETH or NEAR) in NEAR Intents and an equal short on Hyperliquid, so price moves cancel and the hourly funding is what's left. An AI agent runs it. A NEAR smart contract owns both accounts through Chain Signatures and decides where the money may go; the agent can trade but can't withdraw.

Built at NEAR HACKATHON, November 2026. Live on **NEAR mainnet** (real USDC, $100 cap) and **NEAR testnet** (free test USDC).

| | |
|---|---|
| App (deposit, withdraw, live dashboard) | https://nullpoint.fun · source [`apps/web`](apps/web) |
| Docs (23 pages, 14 diagrams, live checks against the chain) | https://docs.nullpoint.fun · source [`apps/docs`](apps/docs) |
| Status (uptime of both vaults) | https://status.nullpoint.fun |
| Mainnet vault (source verified on NearBlocks) | [`vault.nullpoint.near`](https://nearblocks.io/address/vault.nullpoint.near) |
| Testnet vault (source verified on NearBlocks) | [`vault.nullpoint.testnet`](https://testnet.nearblocks.io/address/vault.nullpoint.testnet) |
| Demo video | in the X post linked from the hackathon submission |

## The problem

Funding on perpetual futures pays whoever is on the uncrowded side, and the classic way to collect it is the basis trade: hold a coin and short the same amount. Today funds and exchanges run that trade with their own exchange keys, so depositors trust whoever holds them, and a bot that can trade can usually also withdraw. Funding also moves between coins, and a vault stuck on one coin misses it.

## What NullPoint does about it

- **A contract owns the exchange account.** Through NEAR Chain Signatures the vault contract controls one Ethereum-style address. That address is both its NEAR Intents account (holding the coin) and its Hyperliquid account (holding the short). Nothing leaves either unless the contract asks NEAR's MPC network to sign it.
- **The agent can trade and nothing else.** It holds a NEAR function-call key that can only call the vault, and a Hyperliquid trading key that can't withdraw or send.
- **Swaps are verified, then signed.** The agent brings a 1Click quote; the contract checks 1Click's ed25519 signature, that the vault is recipient and refund address, the price against its own oracle, the size and freshness, then builds the transfer itself. A stolen agent key can't route money anywhere else.
- **The contract prices the vault.** It reads balances from `intents.near`, prices them with signed 1Click quotes, and checks the agent's Hyperliquid report against what it expects; a report it can't explain pauses the vault.
- **An AI picks the coin inside fixed limits.** A model on NEAR AI Cloud, in a TEE with signed answers, chooses hold, switch or wait in USDC. Limits it can't override: BTC/ETH/NEAR only, 1-2x leverage, two switches a day, six-hour hold, one-week payback. Every decision goes on-chain with the enclave's address.

## Try it

Needs Node 24+ and npm 11. `npm test` also needs Rust with `cargo-near` (contract tests).

1. **Clone and install:** `git clone https://github.com/demigohu/nullpoint && cd nullpoint && npm install`
2. **Run the demo, no keys or money:** `npm run demo` → five checks against live data:
   1. the live testnet vault's state and its short on Hyperliquid,
   2. the vault's address recomputed from its contract account through NEAR Chain Signatures and matched with the configured one (✅),
   3. a real mainnet 1Click quote whose ed25519 signature verifies the way the contract checks it (✅), and the same quote with the recipient changed to an attacker rejected (✅),
   4. the vault's real position repriced 20% up and down, with the value moving by only the small unhedged remainder,
   5. a compromised AI's requests (SOL, 20x, withdraw to `0xdead`) blocked by the limits (✅ ×3).
3. **Run the tests:** `npm test` → shared-code and field tests pass, 25 contract unit tests pass (real mainnet 1Click quotes, a real MPC signature, forged and replayed quotes refused), 2 integration tests pass on a local NEAR sandbox. Works on a clean clone without any `.env`.
4. **Open the app on testnet:** https://nullpoint.fun (or `npm run dev` → http://localhost:3000) → connect a NEAR testnet wallet → account menu (top right) → **Get 100 test USDC**.
5. **Deposit:** enter an amount → the review runs the contract's own checks first (shares you'll get, the 0.5% fee, the cap) → sign one transaction → your shares appear at once.
6. **Watch the dashboard:** within a minute or two the agent sends collateral to Hyperliquid, opens the short, then buys the coin → each step shows in the activity log with its transaction, and the hedge gap returns to about zero.
7. **Withdraw:** sign `request_withdraw` → the withdrawal shows requested → signed → paid, with links to the signing and payout transactions → USDC lands in your wallet, usually within 1-3 minutes on testnet.
8. **Check every claim against the chain:** https://docs.nullpoint.fun/verify → six claims checked live for mainnet and testnet, with the command to repeat each one.
9. **See it with real money:** https://docs.nullpoint.fun/mainnet → the mainnet vault's live position and every transaction of its first day.
10. **Try to break it** (needs the testnet agent keys): `npm run attack` → the agent's own keys try `withdraw3`, `usdSend`, `agentSendAsset` and a quote paying an attacker; all are refused. `npm run attack:llm` (needs a NEAR AI key) → prompt injection and a compromised model, all blocked.

Running the whole system on your own testnet accounts: [docs → Run it yourself](apps/docs/content/docs/run-it.mdx).

## For reviewers

| Claim | Check | Expected |
|---|---|---|
| The contract, not a person, owns the vault's Intents and Hyperliquid accounts | `npm run demo` step 2; docs → Verify | recomputed address equals the configured one |
| Swaps can only pay the vault | `cd contracts && cargo test -p vault` | forged recipient, forged signature, replayed quote all rejected |
| The agent can trade but can't withdraw | `npm run attack`; docs → Verify lists the approved agent key live | Hyperliquid refuses every transfer; the contract refuses the bad quote |
| The contract computes the share price | `near contract call-function as-read-only vault.nullpoint.near get_state json-args '{}' network-config mainnet now` | NAV, balances and prices from signed quotes |
| A bad report pauses the vault | contract tests `hedge_and_account_value_checks`, `account_value_is_checked_against_the_last_report` | pass |
| AI decisions are signed and on-chain | `get_decisions` on either vault; `npm run attack:llm` | chat id and enclave signing address per decision; injected requests blocked |
| Withdrawals don't depend on the agent | `npm run e2e:testnet`; contract `execute_withdraw` has no caller check | payout submitted from the user's account |
| It runs with real money | docs → Mainnet proof; https://status.nullpoint.fun | live position, transaction list, uptime |
| Contract source matches the deployed code | NearBlocks contract tab for both vaults | verified (reproducible build, NEP-330) |

## Mainnet

| | |
|---|---|
| Vault | [`vault.nullpoint.near`](https://nearblocks.io/address/vault.nullpoint.near), reproducible build of `8e28abf` |
| Owner and treasury | `nullpoint.near` |
| Agent | [`agent.nullpoint.near`](https://nearblocks.io/address/agent.nullpoint.near) (function-call key, vault only) |
| Vault address in NEAR Intents and on Hyperliquid (`v1.signer`, path `hl-master`) | [`0x610da6eff2adec2aae201c2970fdafe66189b939`](https://app.hyperliquid.xyz/explorer/address/0x610da6eff2adec2aae201c2970fdafe66189b939) |
| Agent's Hyperliquid trading key | `0xd8b2be1be359685bd052cd5924541f38575ddb71` |

First day (12 Nov 2026, UTC):

| Step | Transaction |
|---|---|
| Deploy and init the vault | [`J1ZHrMaE…`](https://nearblocks.io/txns/J1ZHrMaEqAbciW8wMxMY61W1bzkg3vLiTeF8qjfVWpbU) |
| Deposit 44 USDC, swept into the vault's Intents account | [`G5cmNQxc…`](https://nearblocks.io/txns/G5cmNQxcqLA2sYy4L5xQGV8VjgqxpThbz31TxGfzWjEb) |
| 1Click quote verified, MPC-signed collateral to Hyperliquid (14.77 sent, 14.45 arrived) | [`G9ManbtA…`](https://nearblocks.io/txns/G9ManbtAdVcFvedKdRg4VAbcXueZg9TRfZPFpwDKSwD4) |
| MPC-signed `approveAgent` for the trading key | [`BWsqw7Cc…`](https://nearblocks.io/txns/BWsqw7CcbZ54rQpRhtAxXY85kYuf6NMsQQu3QP7BqsaX) |
| Short 0.0004 BTC first, then buy 29.32 USDC of BTC through 1Click | [`6Q4Yuh5N…`](https://nearblocks.io/txns/6Q4Yuh5NCyGcyGjgPngXxPTUk7cPqUVuiAWDuWygTork) |
| Collateral pulled back from Hyperliquid for a withdrawal | [`6yWgxsy7…`](https://nearblocks.io/txns/6yWgxsy7tm2MFh1dmBV5T6JKCNgX8krY88oVQic3pCMK) |
| Withdrawal paid: 5 shares → 4.81 USDC | [`8ViwcjoZ…`](https://nearblocks.io/txns/8ViwcjoZWNkZmdWRsywVop1GjxAvRftwP4p8UBdcW3rj) |

All eleven steps, and what we learned from them: [docs → Mainnet proof](apps/docs/content/docs/mainnet.mdx), [docs → Lessons from mainnet](apps/docs/content/docs/lessons.mdx).

## Testnet

NEAR Intents and 1Click have no testnet (hackathon rule Q-007), so testnet runs the same contract against stand-ins with the same interfaces: `verifier.nullpoint.testnet` (copies `intents.near`, with real ERC-191 signature checks), test USDC with an open mint, and a mock 1Click whose signing key the testnet vault trusts. NEAR's MPC network (`v1.signer-prod.testnet`) and Hyperliquid testnet are the real ones.

| | |
|---|---|
| Vault | [`vault.nullpoint.testnet`](https://testnet.nearblocks.io/address/vault.nullpoint.testnet) |
| Vault address (Intents stand-in + Hyperliquid testnet) | [`0x55c7c56049847f23540209b7dbd401bf242b5908`](https://app.hyperliquid-testnet.xyz/explorer/address/0x55c7c56049847f23540209b7dbd401bf242b5908) |
| Agent | [`keeper.nullpoint.testnet`](https://testnet.nearblocks.io/address/keeper.nullpoint.testnet) (named before the rename to "agent") |
| Intents stand-in · test USDC | [`verifier.nullpoint.testnet`](https://testnet.nearblocks.io/address/verifier.nullpoint.testnet) · [`usdc.nullpoint.testnet`](https://testnet.nearblocks.io/address/usdc.nullpoint.testnet) |

| Step (12 Nov 2026, UTC) | Transaction |
|---|---|
| Switch BTC → NEAR: short moved first, then the coin, in capped steps | [`3ArGZtZr…`](https://testnet.nearblocks.io/txns/3ArGZtZr6VYXSZmbGJyEcrqdWwmp4dGgEWaD8jT7bLL3) |
| Withdrawal of 500 shares paid after the agent sold coin and pulled collateral | [`3rfBhyzf…`](https://testnet.nearblocks.io/txns/3rfBhyzfAbXBLVmGGp8F6zKRwBLftbTJY81WyypvAE3Y) |
| Withdrawal executed from the user's own account (11 Nov) | [`ALJ1g82Q…`](https://testnet.nearblocks.io/txns/ALJ1g82Qeg4VgBjt9r4pvhnWgmunWoKoo874rXQWJAYX) |

## How it's built

```
contracts/vault          NEAR contract (Rust, near-sdk): shares, fees, quote verification, MPC signing, report checks, AI decision log
contracts/mock-verifier  testnet stand-in for intents.near (real ERC-191 checks)
contracts/mock-ft        testnet USDC with an open mint
apps/agent               the agent (Node, TypeScript): sweep, hedge, report, rotate, pay withdrawals; testnet and mainnet
apps/web                 Next.js app: deposit and withdraw with a review of every transaction, dashboard, /api/health
apps/docs                Fumadocs site: start here, how it works, verify, developers
packages/core            shared TypeScript: RPC, MPC address derivation, 1Click message format, Hyperliquid signing, strategy limits
scripts/                 demo, attacks, simulations, end-to-end test, deploy (testnet and mainnet), keys
```

Each folder has its own README. Architecture with diagrams: [docs → Architecture](apps/docs/content/docs/architecture.mdx). Product spec: [PRD.md](PRD.md) (Indonesian). Design system: [apps/web/DESIGN.md](apps/web/DESIGN.md).

## Tracks and NEAR features

Submitted to **Unstoppable DeFi** (`defi`), **AI Security & Defense** (`security`) and **Agent Economy** (`agents`).

| NEAR feature | How NullPoint uses it |
|---|---|
| NEAR smart contract | The vault: shares, fees, the share price, every rule about where money may go |
| Chain Signatures (`v1.signer`) | The vault's own address on Hyperliquid and in NEAR Intents; signs Intents transfers, withdrawals, Hyperliquid `sendAsset` and `approveAgent`, only for payloads the contract built |
| NEAR Intents and the 1Click API | Swaps, collateral to and from Hyperliquid (`hypercore`), `/v0/submit-intent`, and signed quotes as the price oracle the contract verifies |
| Function-call access keys | The agent's NEAR key can only call the vault; it can't move NEAR or call anything else |
| NEAR AI Cloud (TEE) | The AI strategist runs in an enclave; its answers are signed and checked against the attestation, and recorded on-chain |

## Fees

0.5% on deposit and 0.5% on withdrawal (both stay in the vault to pay for each person's own swaps), and 5% of gains above the previous high to the treasury. The contract caps them at 1%, 1% and 20%. Details: [docs → Fees](apps/docs/content/docs/fees.mdx).

## Disclosure

- **Built in the hackathon window.** The repository starts on 10 Nov 2026 (`create-turbo` starter); no code from before the hackathon. No existing product on another chain.
- **Starters and libraries:** Turborepo (`create-turbo`), Next.js, React, Tailwind CSS, Fumadocs, Mermaid, GSAP, Lenis, Motion, Phosphor Icons; near-sdk, cargo-near, near-kit, near-api-js, @hot-labs/near-connect, near-connect-hooks; viem, @noble/curves, @noble/hashes, @scure/base; @nktkas/hyperliquid; @defuse-protocol/one-click-sdk-typescript.
- **AI-written code:** large parts of the code, tests, docs and copy were written with an AI coding assistant (Claude Code) and reviewed by the team.
- **Not audited.** Mainnet is capped at $100. In this build the owner can upgrade the contract.
- **Secrets:** none in the repository. Keys live in `.env`, `.env.mainnet` and `.keys/`, all git-ignored; see [`.env.example`](.env.example).

## License

[MIT](LICENSE)
