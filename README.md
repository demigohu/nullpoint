# NullPoint

**Earn from crypto without betting on it.** NullPoint is a USDC vault on NEAR that earns perpetual-futures funding while holding no price risk. For every $1 of a coin it holds, it is short $1 on Hyperliquid, so price moves cancel and the hourly funding that traders pay to bet on prices rising is what's left. An AI agent runs it. A smart contract decides where the money may go.

Built at NEAR HACKATHON (November 2026).

- **App:** [`apps/web`](apps/web) (deposit, withdraw, live dashboard)
- **Docs:** [`apps/docs`](apps/docs) (how it works, architecture, security model, live verification)
- **Network:** NEAR testnet today (test USDC, real NEAR MPC network, real Hyperliquid testnet). Mainnet launches with a small deposit cap.

## The problem

Funding on perpetual futures pays well when traders crowd one side, and the classic way to collect it is the basis trade: hold the coin, short the same amount. Today that trade is run by funds and exchanges that keep the exchange keys themselves, so depositors have to trust whoever holds them. A bot that can trade can usually also withdraw.

NullPoint splits those powers. A NEAR contract owns the exchange account through NEAR Chain Signatures. The agent gets a key that can trade and nothing else, and every swap or transfer is a 1Click quote the contract verifies before it asks NEAR's signers to sign.

## Try it (testnet)

1. **Run the demo, no keys needed:** `npm install && npm run demo` → five checks against live data: the vault's state, its MPC-derived address recomputed, a real 1Click quote verified (and a forged one rejected), a ±20% BTC move with a flat NAV, and a compromised AI blocked by the limits.
2. **Open the app:** `npm run dev` → web on http://localhost:3000, docs on http://localhost:3001.
3. **Connect a NEAR testnet wallet** → the account menu (top right) offers 100 test USDC.
4. **Deposit** → a review dialog runs the contract's own checks on your numbers before your wallet signs, then shows the shares you actually received.
5. **Watch the dashboard** → within a minute the agent sends collateral to Hyperliquid, opens the short first, then buys the coin; every step appears in the activity log with its transaction.
6. **Withdraw** → USDC lands in your wallet, usually within 1-3 minutes; the status track shows requested → signed → paid.
7. **Try to break it:** `npm run attack` → the agent's own keys try to withdraw, transfer, and get a payout signed to an attacker. All four are refused.

Full setup on your own accounts: [Run it yourself](apps/docs/app/run-it/page.tsx).

## What is verifiable

| Claim | How to check |
|---|---|
| The contract, not a person, owns the vault's Intents and Hyperliquid accounts | Docs → Verify recomputes the address from `vault.nullpoint.testnet` through `v1.signer-prod.testnet` on every load; `npm run demo` does the same |
| The agent can trade but can't withdraw | `npm run attack`; Docs → Verify lists the approved agent key live from Hyperliquid |
| Swaps can only pay the vault | `cd contracts && cargo test -p vault` (real mainnet 1Click quotes, including a forged recipient) |
| The contract prices the vault; the agent can't invent the share price | `get_state` on `vault.nullpoint.testnet`; reports more than 1% off are rejected (contract tests) |
| Every AI decision is signed in an enclave and stored on-chain | `npm run attack:llm`; dashboard activity log → AI decisions → chat id and enclave address |
| Withdrawals don't depend on the agent | `npm run e2e:testnet` submits the signed payout from the user's account |

## Addresses (testnet)

| | |
|---|---|
| Vault contract | [`vault.nullpoint.testnet`](https://testnet.nearblocks.io/address/vault.nullpoint.testnet) |
| Vault's MPC address (Intents + Hyperliquid account) | [`0x55c7c56049847f23540209b7dbd401bf242b5908`](https://app.hyperliquid-testnet.xyz/explorer/address/0x55c7c56049847f23540209b7dbd401bf242b5908) |
| Agent account | [`keeper.nullpoint.testnet`](https://testnet.nearblocks.io/address/keeper.nullpoint.testnet) (name predates the rename to "agent") |
| Agent's Hyperliquid trading key | `0x5788b8619093e8f3a8dec1ebe479989b627d9023` |
| Intents stand-in (testnet) | [`verifier.nullpoint.testnet`](https://testnet.nearblocks.io/address/verifier.nullpoint.testnet) |
| Test USDC | [`usdc.nullpoint.testnet`](https://testnet.nearblocks.io/address/usdc.nullpoint.testnet) |

Mainnet addresses are added here at launch.

## Transactions (testnet regression, 11 Nov 2026)

| Step | Transaction |
|---|---|
| Deposit sweep into the vault's Intents account | [`218t6gn5…`](https://testnet.nearblocks.io/txns/218t6gn5vUYVQqdNvdkrW1KzstrjGS5M4tWxKate72uH) |
| Collateral to Hyperliquid (1Click quote verified, MPC-signed intent) | [`J3uB4um5…`](https://testnet.nearblocks.io/txns/J3uB4um5QD6xyFcFzXtKLyUW7SyRdr5vBAG2UkhNimqp) |
| Buy BTC after the short was opened | [`3Zr1mJ9U…`](https://testnet.nearblocks.io/txns/3Zr1mJ9UdgdyT2GHnYBX6bWBrr6BTKjpoiL7WcBaD1uD) |
| Rotation BTC → ETH (short moved first, then spot) | [`pcQUPRRm…`](https://testnet.nearblocks.io/txns/pcQUPRRmJdHrEeUmShvJViKSMR3XQmMfTxLZegJAwDw) |
| Withdrawal priced and MPC-signed | [`41BNZgb1…`](https://testnet.nearblocks.io/txns/41BNZgb1CdQKCbGqz6a1fWJadLXCbPnp7kPW9mSLCC1x) |
| Withdrawal executed from the user's own account | [`ALJ1g82Q…`](https://testnet.nearblocks.io/txns/ALJ1g82Qeg4VgBjt9r4pvhnWgmunWoKoo874rXQWJAYX) |
| Withdrawal paid by the agent | [`EAo9RGSq…`](https://testnet.nearblocks.io/txns/EAo9RGSqJLepWkMmTCgRNdbxtGCbJT2QTk2PKNJQcanH) |

## How it's built

```
contracts/vault        NEAR contract (Rust): shares, share price, quote verification, MPC signing, AI decision log
contracts/mock-verifier  testnet stand-in for intents.near (real ERC-191 checks)
contracts/mock-ft      testnet USDC
apps/agent             the agent (Node/TypeScript): sweep, hedge, report, rotate, pay withdrawals
apps/web               Next.js app: deposit/withdraw with transaction review, dashboard
apps/docs              Next.js docs: how it works, architecture, security model, live verification
packages/core          shared: RPC, address derivation, 1Click, Hyperliquid signing, strategy limits
scripts/               demo, attacks, simulations, end-to-end test, deploy and reset
```

NEAR pieces used: NEAR Protocol (the vault contract), NEAR Chain Signatures (the vault's own EVM address and every signature), NEAR Intents with the 1Click API (swaps, bridging to Hyperliquid, signed quotes as the price oracle), and NEAR AI Cloud (the AI model in an enclave with signed answers). The short leg is on Hyperliquid.

More: [docs](apps/docs) · [PRD](PRD.md) · [design system](apps/web/DESIGN.md).

## Disclosure

- **No pre-hackathon code.** Everything in this repository was written during the hackathon window.
- **Starter:** the monorepo began from `create-turbo` (Turborepo starter); its template apps were replaced.
- **Libraries:** near-sdk, near-kit, near-api-js, @hot-labs/near-connect and near-connect-hooks, viem, @noble/curves and @noble/hashes, @nktkas/hyperliquid, the 1Click TypeScript SDK, Next.js, React, Tailwind CSS, GSAP, Lenis, Motion, Phosphor Icons.
- **AI assistance:** large parts of the code, docs and copy were written with an AI coding assistant (Claude Code) and reviewed by the team.
- **Secrets:** none in the repository. Keys live in `.env` and `.keys/`, both git-ignored; see [`.env.example`](.env.example).

## License

[MIT](LICENSE)
