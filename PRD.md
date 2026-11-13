# NullPoint PRD

Status: v0.5 · 2026-11-13 · mainnet live · submitted to NEAR HACKATHON (deadline 2026-11-14 23:59 UTC)

## 0. Decisions locked in

| Topic | Decision |
|---|---|
| Product | One delta-neutral USDC vault. Users only deposit USDC and **don't pick an asset**. The protocol decides |
| Design | **Intents-native.** The spot leg is held by **the vault's own NEAR Intents account** and bought through NEAR Intents. Hyperliquid is only for the perp short. Spot swaps, rotations and margin transfers all go through Intents |
| One key | The vault contract's MPC-derived EVM address is **both the Hyperliquid master and the `intents.near` account** (`erc191` signatures) |
| Swaps and margin | **Verify the quote, then sign**: the agent brings a 1Click quote signed by 1Click (ed25519). The contract verifies that signature on-chain, checks `recipient`/`refundTo` = the vault's address, the assets, the amount and the price against its oracle, then asks MPC to sign a `transfer` intent to the `depositAddress` that is now proven to belong to 1Click. The agent can't divert funds (§6.2) |
| Strategist model | `deepseek-ai/DeepSeek-V4.1-Flash-1017` (private, TEE attestation ✓). Fallback `Qwen/Qwen3.8-27B`. Anthropic/OpenAI/Google models on NEAR AI Cloud are "anonymised" (no attestation), so they aren't used |
| Assets | Allowlist: **BTC** (`nbtc.bridge.near`), **ETH** (`eth.bridge.near`), **NEAR** (`wrap.near`). Starting default: **BTC**. SOL and HYPE are out because 1Click doesn't offer them as tokens on NEAR |
| Rotation | Automatic rotation is in scope (§6.4) |
| Intelligence | An **LLM strategist** (NEAR AI Cloud, TEE) decides HOLD/ROTATE/PARK/leverage, and its decision is **executed** when it passes fixed guardrails. The fixed rule is the fence and the fallback (§6.5) |
| NAV | **Computed by the contract**: balances the contract records × **prices from signed 1Click quotes** (the oracle, §6.1). The agent only reports short-position details and funding, bounded by invariants (§6.1) |
| Frontend | `apps/web`: `/` landing, `/app` vault, `/dashboard`. `apps/docs`: overview, how it works, architecture, security model, **Verify** (live checks, replaces `/proof`), run it yourself (§6.6) |
| Order of work | **Everything runs on testnet first**, then migrates to mainnet. Mainnet reuses the same code |
| Submission | Submitted with a **live mainnet deployment** (`vault.nullpoint.near`, $44 of the owner's money, 13 Nov) plus testnet for judges to try |
| Tracks | `defi` (main), `security`, `agents` |
| Fallback | The spot adapter on Hyperliquid (v0.2 design) isn't used: the Intents path works on mainnet (13 Nov, §8 G-F) |

## 1. Summary

NullPoint is a delta-neutral vault on NEAR. Users deposit USDC. The vault contract buys a spot asset (BTC, ETH or NEAR) through NEAR Intents and holds it itself. At the same time it sends margin through Intents to Hyperliquid and opens a perp short of the same size. The vault's value doesn't move with the price, and the yield comes from the funding rate that long traders pay short traders. The agent automatically rotates the hedge to the asset with the best funding.

The security difference: the vault's Hyperliquid account is controlled by **a NEAR contract through Chain Signatures**. The agent only holds a Hyperliquid *agent wallet* that can trade but can't withdraw. This is proven on testnet and mainnet (§8, §12).

## 2. Problem

- Stable yield on NEAR is thin: stablecoins on NEAR total about $85.8M, and high pool APYs come from emissions, not organic yield.
- A delta-neutral strategy needs an account on a perps venue. In a typical vault, whoever holds the bot's key can drain the funds. Agent wallets drained through prompt injection (Grok/Bankr, May 2026) show that a key in a bot's hands is the main point of failure.
- Funding moves between assets. A vault stuck on one asset misses yield.
- Intents volume is large, but no yield product uses Intents as its execution engine yet.

## 3. Goals and non-goals

### Goals (must exist at submission)

| ID | Goal | Evidence for judges |
|---|---|---|
| G1 | Vault contract: deposit, mint shares, request/fulfill withdraw, NAV, pause, TVL cap, per-account cost basis | Unit tests + `near-sandbox` + `near-api` integration tests (`contracts/vault/tests/integration.rs`) pass. Testnet + mainnet tx hashes |
| G2 | Hyperliquid master = the Chain Signatures-derived EVM address owned by **the vault contract** | Derived address + an `approveAgent` tx signed by MPC on the contract's request |
| G3 | The spot leg is held by the vault's Intents account and bought with a 1Click quote the contract verifies before MPC signs (§6.2) | `mt_balance_of` on `intents.near` + swap intent hash + contract test: a forged quote is rejected |
| G4 | The short leg on Hyperliquid, leverage ≤2x, size = the spot leg | Position visible on the Hyperliquid explorer ("proof-of-hedge") |
| G5 | Automatic rotation between BTC/ETH/NEAR (§6.3) | Unit tests for the rotation decision + at least one rotation recorded on testnet |
| G6 | The agent wallet **can't** withdraw or transfer | `npm run attack` → rejected by Hyperliquid |
| G7 | Risk rules: negative funding → park in USDC. Thin margin → top up margin or shrink the position | Unit tests in `packages/core` |
| G8 | Simulated 20% price drop: NAV stays flat | `npm run simulate:crash` |
| G9 | Frontend, 4 pages (§6.6) | Hosted URL (reads mainnet) + `npm run dev` |
| G10 | `npm run demo` dry-run with no funds and no paid API key | Runs on a clean clone |
| G11 | **Live mainnet proof:** deposit → spot swap through Intents → margin to Hyperliquid through Intents → short → funding → partial withdraw | List of mainnet tx hashes in the README |
| G12 | The LLM strategist decides, guardrails validate, the decision is recorded on-chain with a hash + attestation | `get_decisions` + docs Verify + dashboard activity log |
| G13 | A prompt-injection demo against the strategist is rejected by the guardrails | `npm run attack:llm` |
| G14 | NAV computed on-chain from verified 1Click quote prices + balances the contract records | Contract test: an agent report that breaks an invariant is rejected |

### Stretch

- S1: Deposit into the vault from any chain through 1Click (the user brings SOL/ETH/USDC from another chain).
- S2: Deposit through Confidential Intents (depositor privacy).
- S3: The strategist reads extra text sources (news, sentiment) besides market data.

### Roadmap (not for the hackathon)

- **Staked NEAR delta-neutral**: the NEAR spot leg is staked, so yield = staking + funding.
- Multi-vault (one vault per asset) from the same code, only parameters differ.
- More assets once they exist as tokens on NEAR through Intents.

### Non-goals

- Users choosing their own asset or strategy.
- A token or governance.
- Trustless on-chain NAV verification (see R3).
- Claiming the position is hidden. The vault's short is **public on purpose** on Hyperliquid as proof-of-hedge.

## 4. Users and flows

**Depositor**
1. Deposit USDC → receive shares. Testnet: mock USDC. Mainnet: USDC on NEAR (S1: any asset from any chain).
2. See NAV, yield, the active asset and a link to the vault's Hyperliquid position.
3. Request a withdrawal → the agent unwinds that share → shares are burned and USDC is paid.

**Owner**
- Deploys the vault, sets parameters and the allowlist, `approve_agent`, `set_agent`, `pause`. Revoking the Hyperliquid trading key: `approve_agent` with the same name and a new address (Hyperliquid replaces an agent with the same name). Replacing the NEAR agent account: `set_agent`.

**Agent (`apps/agent`)**
- Each cycle: read the market → hedge → rotate if needed → risk rules → report NAV → process the withdrawal queue.

**Judges**
- `npm run demo` (dry-run), `npm test`, testnet and mainnet explorer links, the Verify page in the docs.

## 5. Architecture

```
 Depositor ──USDC──▶ ┌─────────────────────────────────────────────┐
                     │ contracts/vault (NEAR)                       │
                     │ - share accounting, NAV, cap, pause          │
                     │ - verifies 1Click quotes (ed25519) = price   │
                     │ - builds Hyperliquid admin EIP-712 payloads  │
                     └───────┬─────────────────────────────────────┘
                             │ sign(digest, path) to MPC
                             ▼
                  MPC (v1.signer-prod.testnet / v1.signer)
                  → one EVM address owned by the vault: 0x…
                     │                                  │
          erc191 intent                         EIP-712 user-signed
                     ▼                                  ▼
  ┌──────────────────────────────┐    ┌──────────────────────────────────┐
  │ intents.near: account 0x…    │    │ Hyperliquid: master 0x…           │
  │ - HOLDS spot: nBTC/ETH/      │◀──▶│ - perp SHORT only (orders: agent) │
  │   wNEAR + idle USDC          │    │ - approveAgent, usdClassTransfer, │
  │ - swaps through 1Click       │    │   sendAsset: MPC only             │
  └──────────────────────────────┘    └──────────────────────────────────┘
       USDC margin ⇄ through 1Click (`hypercore`), ~30 s
                                         ▲
      apps/agent ───────────────────────┘  orders, 1Click quotes, submit intent, report_prices + report_position
```

### Core security principle

Hyperliquid has two signature schemes:
- **L1 actions** (chainId 1337, phantom agent): order, cancel, `updateLeverage`, and also `vaultTransfer`/`subAccountTransfer`. An agent wallet may sign these.
- **User-signed actions** (`HyperliquidSignTransaction`): `approveAgent`, `withdraw3`, `usdSend`, `spotSend`, `usdClassTransfer`. Only the master can. If the agent signs one, Hyperliquid attributes it to the agent's own account.

The contract **builds** each payload itself from structured parameters, then asks MPC to sign its digest. The agent can never submit an arbitrary digest.

### Money flow (mainnet)

| Step | From → to | Mechanism | Who triggers it |
|---|---|---|---|
| Into Intents | User's USDC deposit (contract) → the vault's Intents account | `ft_transfer_call` to `intents.near` with `receiver_id` = the vault's address. The contract fixes the destination | Contract, on deposit |
| Buy spot | USDC → BTC/ETH/wNEAR, inside the vault's Intents account | 1Click quote with `depositType: INTENTS`, `recipient` = vault. The contract verifies the quote → MPC signs a `transfer` intent to `depositAddress` | Agent calls `sign_quote`, then `POST /v0/submit-intent` |
| Rotate spot | Asset A → asset B, inside the vault's Intents account | Same as buying spot | Same |
| Send margin | USDC in the vault's Intents account → master USDC (Hyperliquid) | Same as buying spot, but `destinationAsset` = `hypercore` USDC and `recipient` = the master address (the same address as the vault). **Lands straight in the perp balance**. Mainnet, 13 Nov: 14.77 sent, 14.45 arrived (~0.3 USDC fixed fee) | Agent calls `sign_quote`, then `submit-intent` |
| Open short | — | L1 order by the agent | Agent |
| Pull margin | Master USDC (Hyperliquid) → the vault's Intents account | 1Click quote with `originAsset` = `hypercore` USDC, `recipient` = vault. The contract verifies the quote → builds a `sendAsset` (can come from perp) to the proven `depositAddress` → MPC. **Not `usdSend`** (an extra 1 USDC is deducted → `INCOMPLETE_DEPOSIT`). Fixed fee 0.2 USDC, minimum 0.5 USDC | Agent calls `sign_quote` (the contract builds `sendAsset`, MPC signs), then sends it to Hyperliquid |
| Out to the user | The vault's Intents account → user | An `ft_withdraw` intent built by the contract, `receiver_id` = the withdrawing user's NEAR account | Contract, on `fulfill_withdraw` |

A direct NEAR ⇄ Hyperliquid route (`hypercore` on 1Click) means no Arbitrum step and no ETH for gas.

1Click dry-run quotes for $25 (10 Nov, **no API key**, so +0.25%). With a partner key: 0.20% fee, or **0.01%** for stablecoins and the same asset across chains (USDC NEAR ⇄ USDC Hyperliquid). Header: `Authorization: Bearer <key>`.

| Route | Result | Time |
|---|---|---|
| USDC (NEAR) → nBTC (NEAR) | $24.92 (~0.3%) | ~20 s |
| USDC (NEAR) → USDC (Hyperliquid) | $24.68 (~1.3%) | ~30 s |
| USDC (Hyperliquid) → USDC (NEAR) | $24.80 (~0.8%) | ~35 s |

### Testnet vs mainnet

Intents and 1Click have no testnet (HACKATHON.md Q-007). Hyperliquid testnet spot is broken (Gate G-C).

| Part | Testnet | Mainnet |
|---|---|---|
| Deposit token | Mock USDC (NEP-141) | USDC (NEP-141) |
| Spot tokens | Mock nBTC/ETH/wNEAR (NEP-141) | `nbtc.bridge.near`, `eth.bridge.near`, `wrap.near` |
| Verifier + swaps | `contracts/mock-verifier`: mimics the `intents.near` interface (`ft_transfer_call` deposit, `mt_balance_of`, `is_nonce_used`, `execute_intents` with `erc191` payloads that are **really verified**: secp256k1 recovery, nonce/deadline checks, `transfer`/`ft_withdraw` execution). `apps/agent/src/mock1click.ts`: quotes in exactly the 1Click format, signed by a **mock ed25519 key** (the testnet contract is configured with the mock public key), then a mock solver fills the swap at Hyperliquid mark price minus a 0.3% fee | `intents.near` + 1Click (`submit-intent`), the real 1Click manager key |
| Margin NEAR ⇄ Hyperliquid | The mock solver has a real wallet on Hyperliquid testnet: it sends USDC to the master (`usdSend` perp→perp) when margin goes out and receives `sendAsset` from the master when margin is pulled. The contract and MPC path is identical to mainnet | 1Click (`hypercore`) |
| Perp leg | Real, on Hyperliquid testnet | Real |
| MPC | `v1.signer-prod.testnet` | `v1.signer` |
| Agent account | `keeper.nullpoint.testnet` (old account name, kept) | `agent.nullpoint.near`, set with `new(agent: …)` / `set_agent` |
| Agent | `npm run agent` (`.env`, 60 s cycle) | `npm run agent:mainnet` (`.env.mainnet`, `NETWORK=mainnet`, 600 s cycle). Both agents can run on one host: separate lock, journal and keys per network |

One codebase. The only differences are the network, the verifier address (`mock-verifier` | `intents.near`), the quote source (mock | 1Click), the 1Click manager public key in the contract, and the Hyperliquid USDC token (`USDC:0xeb62…` testnet | `USDC:0x6d1e…` mainnet). The exact same vault contract, including the "verify the quote, then sign" logic, runs on both networks.

### Components and folders

| Folder | Contents |
|---|---|
| `contracts/vault` | Rust (near-sdk). Owner: `set_agent`, `set_params`, `set_paused`, `set_margin_net`, `approve_agent`. Agent: `report_prices`, `report_position`, `report_decision`, `sign_quote`, `fulfill_withdraw`. Anyone: `ft_on_transfer` (deposit), `sweep`, `request_withdraw`, `execute_withdraw`. Init: `new`, `reinit` (`#[private]`, fresh state on the same account). Views: `get_state`, `get_shares`, `get_holding`, `get_signed`, `get_withdrawals`, `get_decisions`, `get_nav_history`. 25 unit tests (a real mainnet 1Click quote, a real MPC signature) + 2 sandbox tests. Reproducible build (NEP-330), verified on NearBlocks testnet and mainnet. |
| `contracts/mock-ft` | Testnet NEP-141 (mUSDC) with open `mint`. |
| `contracts/mock-verifier` | Stand-in for `intents.near` on testnet (real `erc191` signature checks, `is_nonce_used`, `reinit`). |
| `packages/core` | Shared TS: MPC address derivation, the 1Click quote message builder (identical to the SDK's `quoteHash`), Hyperliquid/Intents/RPC helpers (multi-endpoint fallback), assets, strategy + guardrails (`strategy.ts`), the LLM strategist (`@nullpoint/core/strategist`, node-only). Unit tests. |
| `apps/agent` | The agent loop: `chain.ts` (signing with `near-kit`), `journal.ts` (lock + journal, per network), `oneclick.ts` (mainnet: quote, `submit-intent`, status), `mock1click.ts` (testnet, same interface). |
| `apps/web` | Next.js frontend (§6.6). |
| `apps/docs` | Fumadocs site: 23 pages, 14 diagrams, live checks. |
| `scripts/` | `demo.ts` (dry-run, no keys), `attack.ts`, `attack-llm.ts`, `simulate-crash.ts`, `simulate-strategy.ts`, `e2e-testnet.ts`, `deploy-testnet.sh`, `deploy-mainnet.sh` (step by step, only prints the plan by default), `reset-testnet.ts`, `add-agent-keys.ts`, `approve-agent.ts` (both take `--network mainnet`), `fixtures-oneclick.ts`, gate spikes (`spike-*.ts`). |
| root | `ecosystem.config.cjs` (pm2), `.env.example`. |

## 6. Functional spec

### 6.1 Vault contract

- Shares: `shares = (deposit − entry fee) * total_shares / nav` (the first shares are 1:1 with the net deposit). Rounding always favors the vault.
- **Fees** (decided 12 Nov, same on testnet and mainnet):

  | Fee | Size | Goes to | Why |
  |---|---|---|---|
  | Entry | 0.5% of the deposit | Stays in the vault | Pays the 1Click swap, margin transfer and short for that deposit. Without it, a new depositor's entry costs fall on existing depositors (dilution), and repeated deposit-then-withdraw could be used to burden others |
  | Exit | 0.5% of the withdrawal value | Stays in the vault | Same, for selling the coin and closing the short |
  | Performance | 5% of share-price gains above the high-water mark | New shares minted to `treasury` on `report_position` | The protocol's business model. Only from funding actually earned; falling and then recovering to the previous high isn't charged |

  Upper bounds are fixed in the contract (entry/exit 1%, performance 20%), so the owner can't raise them freely through `set_params`. Entry/exit fees also raise the high-water mark, so the performance fee isn't taken from money that only covers swap costs. Rotation costs are borne by all shareholders because rotation is a shared strategy decision. `treasury` = the owner account: `nullpoint.testnet` / `nullpoint.near`.
- **NAV is computed by the contract:**

  | Component | Source |
  |---|---|
  | Idle USDC | The vault's Intents account balance (`mt_batch_balance_of`, cross-contract) + USDC in the contract not yet moved into Intents |
  | Spot leg | Token balances in the vault's Intents account (`mt_batch_balance_of`, read on-chain) × verified price (see below) |
  | Hyperliquid account | Account value **reported by the agent**, then checked against the last accepted report: `previous value + margin moved since + effect of oracle price changes on the existing short`. Tolerance `max_report_drift_bps` (2%, raised from 1% on 12 Nov) of the largest of the short, the previous account value and the expected value, + dust. Outgoing margin is recorded at the quote's `amountOut` (not `minAmountOut`, which is still validated), because solvers send about `amountOut`. The remaining source of drift: changes in the gap between 1Click quote prices and Hyperliquid mark price in volatile markets. The first report uses `margin_net + open short PnL` |
  | Hedge | Rejected when `|short value − spot value| / spot value > hedge_band` per asset |

  Fix, 11 Nov: the first version compared the account value with `margin_net + open PnL` at all times. Funding received and PnL from closed positions accumulate outside that formula, so the vault paused itself as soon as the position shrank (seen during the PARK test). Checking each report against the last one fixes it, and large sudden jumps still trigger a pause.

- **Price oracle = signed 1Click quotes.** The agent calls `report_prices([{message, signature}])` with `dry` asset → USDC quotes (e.g. 0.001 BTC → USDC). The contract verifies ed25519, makes sure `destinationAsset` = USDC and `originAsset` ∈ the allowlist, rejects a `timestamp` older than `max_price_age_s` (default 120), then stores price = `amountOut / amountIn`. The price is net of fees, so valuation is conservative. Testnet: `mock-1click` signs quotes from Hyperliquid mark price.
- `report_position(positions, account_value)` is agent-only. The contract reads spot balances itself from the verifier. An invariant violation → `paused` (the owner must investigate). A stale price is not a violation: the report is dropped (`REJECTED: <asset> price stale`) and the previous NAV stays in use (fix, 12 Nov: the agent was 3 minutes late and the testnet vault paused).
- Deposits and withdrawals are priced from the NAV the contract computed, not from a number the agent gives.
- NAV history: a ring buffer of ~500 entries `(ts, nav, share_price, active_asset)` for the dashboard chart.
- Withdraw: `request_withdraw(shares)` → agent `fulfill_withdraw` (priced from NAV, MPC signs an `ft_withdraw` to the user) → `execute_withdraw`. The agent runs all of it automatically (1–3 minutes). `execute_withdraw` has no caller check, so users can finish it themselves if the agent is down.
- `report_decision` is agent-only: action, target, accepted/rejected, note, NEAR AI chat id + TEE signing address.
- `reinit(generation, …)` (`#[private]`): fresh state on the same account with a new generation's storage prefix. Used to reset testnet, because NEAR doesn't allow deleting an account with large state.
- `paused`: deposits, withdrawals and swaps are rejected. The owner can revoke the trading key (`approve_agent` with the same name and a new address) and replace the agent (`set_agent`).
- Per-account `deposited`: USDC deposited minus the part already withdrawn (pro rata). View `get_holding(account_id)` → `{ shares, deposited, entry_cost }`, used by the app to show earnings separately from the deposit fee.
- TVL cap `max_tvl` (mainnet: $100).
- Mainnet parameters that differ from testnet: `max_tvl` $100 (testnet $1,000), `max_swap_usdc` $50 ($100), `margin_slippage_bps` 500 (300; 1Click's ~0.3 USDC fixed fee is already >3% on margin under ~$10), `max_nav_age_s` 900 (600; 10-minute agent cycle), `nav_history_interval_s` 1800 (600), `dust_usdc` 1.5 USDC (0.5; Hyperliquid's $1 fee when pulling margin, G-N). The same: fees 50/50/500 bps, drift 200, band 200, prices ≤120 s.

### 6.2 Swaps and margin: verify the quote, then sign

Every 1Click quote is signed by the 1Click manager with **ed25519** (key `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`, from the official SDK `@defuse-protocol/one-click-sdk-typescript`). What's signed: `base58(sha256(stable_json({...quoteRequest, ...quote, timestamp})))`, and it covers `recipient`, `refundTo`, `depositAddress`, `amountIn`, `minAmountOut`, `deadline`. So the contract can **prove** that `depositAddress` really belongs to 1Click and is bound to a quote whose output goes to the vault.

Flow (the same for spot swaps, rotations and margin to Hyperliquid):

1. The agent requests a non-dry 1Click quote with `depositType: INTENTS`, `refundTo` = the vault's address (`refundType: INTENTS`), `recipient` = the vault's address. For spot: `recipientType: INTENTS`. For margin: `destinationAsset` = `hypercore` USDC, `recipientType: DESTINATION_CHAIN` (master address = vault address).
2. The agent calls `sign_quote(signed_message, signature)`. `signed_message` = the stable JSON string exactly as 1Click hashed it.
3. The contract validates:
   - `sha256` → base58 → `env::ed25519_verify` against the 1Click manager public key the contract stores (the owner can change it with `set_oneclick_pubkey` if 1Click rotates its key).
   - Parse the JSON: `recipient` and `refundTo` = the vault's address. `depositType`/`refundType` = `INTENTS`. `originAsset`, `destinationAsset` ∈ allowlist ∪ {USDC, `hypercore` USDC} and different from each other.
   - `amountIn ≤ max_swap_amount`. `minAmountOut` is reasonable against the stored oracle price: `value_out ≥ value_in × (1 − max_slippage_bps)`. For USDC ⇄ USDC: `minAmountOut ≥ amountIn − max fee`.
   - `timestamp` is fresh (< 2 minutes) and `deadline` is in the future. The quote hash hasn't been used before (anti-replay).
4. The contract **builds** the `erc191` intent itself: `signer_id` = the vault's address, one `transfer` of `amountIn` of `originAsset` to the `depositAddress` from the verified quote, deadline ≤ the quote's deadline, a versioned nonce (salt from the verifier, 15 bytes from `env::random_seed`). Then it calls MPC `sign` and stores `(payload, signature)` in the callback.
5. The agent sends it to 1Click `POST /v0/submit-intent`, then watches `GET /v0/status` until `SUCCESS` / `REFUNDED` / `FAILED`. Refunds go back to the vault's Intents account.

Pulling margin from Hyperliquid works the same way: a quote with `originAsset` = `hypercore` USDC and `recipient` = vault is verified, then the contract builds a `sendAsset` to `depositAddress` and asks MPC to sign its EIP-712.

What a malicious agent can't do: send funds anywhere other than 1Click's `depositAddress`, change who receives the swap output, or reuse an old quote. What it still can do: pick the worst quote that still passes the oracle price bound (loss ≤ `max_slippage_bps` per swap), or not send the intent at all (no loss). The remaining trust is in 1Click as a venue: 1Click has to execute the quotes it signs.

Formats already verified:
- An MPC-signed `erc191` intent is accepted by `intents.near` (Gate G-G): nonce `5628f6c6 ‖ 00 ‖ salt(4) ‖ deadline ns i64 LE(8) ‖ random(15)`, signature `secp256k1:` + base58(r‖s‖v) with v ∈ {0,1}.
- A real 1Click quote signature verifies, and a quote with a forged `depositAddress` fails (Gate G-I).
- 1Click's `generate-intent` for the vault account produces one `transfer` intent to `depositAddress` (Gate G-H). The contract builds the same shape itself, without calling `generate-intent`.

### 6.3 Agent: the cycle

Stateless with respect to the chain: each cycle (60 seconds on testnet, 600 on mainnet) reads the vault, the verifier and Hyperliquid, then moves one step toward the target state.

1. Resume any money movement left over from the previous cycle (journal, §6.8). Then sweep deposits.
2. `report_prices`: a dry quote per asset → verified prices.
3. Strategist (§6.5) every `STRATEGIST_INTERVAL_MIN` (default 30). An accepted decision changes the target state (target asset, or USDC on PARK).
4. Allocation, one step per cycle, by priority:
   1. Finish withdrawals that are already signed. Pay the FIFO queue while idle USDC is enough (max 5 per cycle).
   2. Margin emergency: account value < 3× maintenance margin → send margin from idle USDC, or sell ¼ of spot to shrink the position.
   3. Withdrawal liquidity: the shortfall for the next withdrawal comes from margin (if enough) or from selling at least $12 of spot. Not bound by the rebalance threshold, so the queue doesn't stall.
   4. Move non-target assets (rotation/PARK), at least $10.50 so its short can be closed.
   5. Margin = equity/(L+1), spot = the rest. Margin tolerance $5, spot at least $12 (Hyperliquid's minimum order is $10).
   6. Pull excess margin.
5. **Hedge first:** every spot swap adjusts the short before spot changes (shrink the source asset's short, grow the target asset's short per the quote). If Hyperliquid rejects the order, the swap is cancelled.
6. Hedge: each asset's short is matched to its spot (rounding and remainders).
7. `report_position`, **only when the hedge is balanced**. Prices are reported again first if they're older than half of `max_price_age_s` (1Click settlement can take a while). Otherwise (for example when Hyperliquid rejects orders under congestion) the report waits: a stale NAV holds deposits until the hedge recovers, instead of triggering a pause.

Leverage ≤ 2x (`updateLeverage` before every order). Every allocation step is wrapped so a failure doesn't cancel the report.

### 6.4 Agent: automatic rotation

A rotation = spot swap A → B through Intents (~0.3%) + close short A and open short B on Hyperliquid (~2 × 0.045%). Total cost about **0.4% of notional**. The rules are conservative:

- Signal: average funding over `funding_window_hours` (default 8 hours) per asset, not the instantaneous rate.
- Rotate to B only when all of these hold:
  1. `avg_funding(B) - avg_funding(A) ≥ rotation_threshold_apr` (default 5% APR).
  2. **Payback**: the rotation cost (from the 1Click quote + estimated Hyperliquid slippage) is covered by the funding gap within ≤ `max_payback_hours` (default **168 hours**; fix, 11 Nov: at 0.4% cost, a 72-hour limit needs a gap of ≥49% APR, so rotation practically never happens. 168 hours means a gap of ≥~21% APR. Rotations are meant to be rare).
  3. The active asset has been held ≥ `min_hold_hours` (default 6 hours, same as the LLM guardrail).
  4. B's perp is liquid enough for the position size.
- Execution: hedge first (partly close short A, open short B), then swap spot A → B through the vault, at most `max_swap_usdc` per swap. A remainder too small to close on Hyperliquid is never left behind.
- Every decision is recorded with `report_decision`, e.g. "NEAR 520% vs BTC 306% APR, payback 16h".
- Demo mode: `DEMO_FUNDING='{"NEAR":520}' DEMO_MIN_HOLD_HOURS=0` triggers a rotation or PARK on testnet (testnet funding isn't realistic).

### 6.5 LLM strategist

**Principle: the LLM decides, the guardrails bound it, the contract is the last line.**

- **When:** every `strategist_interval_min` (default 30 minutes, 2 in demo mode), or on a trigger (an asset's funding moves > 5% APR, margin ratio drops).
- **Model:** an LLM on NEAR AI Cloud (OpenAI-compatible API, inference in a TEE). The exact model is picked at build time from the available models.
- **Input (JSON snapshot):** instantaneous funding + 24-hour history per allowlisted asset, open interest, mark/oracle price, volatility, the current position, how long the active asset has been held, estimated rotation cost (from a 1Click quote), the guardrail limits, and "market notes" (outside text, untrusted).
- **Output (structured JSON, schema-validated):** `{ action: HOLD | ROTATE | PARK | RESUME | SET_LEVERAGE, target?, leverage?, confidence, reasoning }`. No other actions. No address or transfer amount fields.
- **Fixed guardrails (`packages/core`):**
  - `target` ∈ allowlist. `leverage` ∈ [1, 2].
  - At most `max_rotations_per_day` (default 2). The active asset held ≥ `llm_min_hold_hours` (default 6).
  - Rotation cost pays back within ≤ `llm_max_payback_hours` (default 168) using **observed** average funding (not the LLM's prediction).
  - `confidence ≥ min_confidence`.
  - Rejected → the decision is recorded with the rejection reason. The agent doesn't act.
- **Fallback:** NEAR AI Cloud fails/times out/returns invalid output → the fixed rule from §6.4.
- **Verifiable:** every decision is stored in full (input, output, model, response signature + NEAR AI Cloud attestation) and its hash is recorded on-chain with `report_decision(hash, action, accepted)`. The docs Verify page and the dashboard activity log show the contents.
- **Measurement:** `npm run simulate:strategy` replays historical funding windows and compares the LLM vs the fixed rule vs holding BTC, after costs. The number of calls is capped (~50 windows) to fit in $10 of credits.
- **Attack demo:** `npm run attack:llm` injects a prompt in the "market notes" (asking for a rotation to SOL, 20x leverage, sending margin to an outside address). Whatever the LLM outputs → rejected by the guardrails or not expressible in the schema.

### 6.6 Frontend (`apps/web`)

A testnet/mainnet toggle on every page (default via `NEXT_PUBLIC_DEFAULT_NET`). Funding shown always comes from the same Hyperliquid network as the vault. NEAR wallet through `@hot-labs/near-connect`.

**`/` Landing**: for human judges and viewers of the X post.
- Hero: one sentence of problem + one sentence of solution, no jargon.
- Live stats from mainnet: TVL, realized APR, active asset.
- "How it works" in 3 steps: deposit → the contract buys spot through Intents + shorts on Hyperliquid → funding comes in.
- Security section: "the agent can trade, it can't withdraw", linking to docs Verify.
- Honest risks (negative funding, venue risk, R1, R7).
- CTA to `/app`.

**`/app` Vault**: for users.
- Connect wallet. Deposit/withdraw USDC.
- The user's position: shares, current value, deposited capital, and earnings (value − capital) from `get_holding`.
- Withdrawal queue status: the latest 3 (the rest behind "Show N older"), signed and paid steps with their transaction links (found through NearBlocks from the signing time and the withdrawal id).
- S1: "deposit from any chain" through 1Click (quote → deposit address → REFUNDED/FAILED/SUCCESS status).

**`/dashboard`**: for users and DeFi judges.
- NAV and share-price chart (from `get_nav_history`).
- Vault composition: spot held by the contract (link to the NEAR balance) vs the short on Hyperliquid (link to the explorer).
- **Funding Radar**: instantaneous and 8-hour average funding for BTC/ETH/NEAR, marking the active asset and rotation candidates with the payback math. Only three assets (BTC, ETH, NEAR); assets that don't exist as tokens on NEAR aren't shown.
- Active asset + reason, rotation history, latest Intents swaps (`get_signed_intents` + intent hash).
- **Strategist feed:** AI decisions in the activity log (action, reason, passed/rejected by guardrails, chat id, enclave). The "The AI vs the backup rule" panel: the AI's latest decision vs the fixed rule's decision on the funding the agent reads now, compared from the coin currently held.
- Hedge ratio (short ÷ coin), Hyperliquid leverage vs the 2x limit, the price rise that would liquidate the short, the time of the last report.

**Docs → Verify (formerly `/proof`)**: for judges and skeptical users. `/proof` on the web app redirects here.
- Addresses: the vault contract, the Hyperliquid master (MPC-derived), the agent. Each with an explorer link.
- Claim → evidence → how to check it yourself. For example: "The master is controlled by the contract" → recompute the derivation or call the `derived_public_key` view on MPC. "The agent can't withdraw" → the log of rejected attempts. "Spot is held by the vault" → `mt_balance_of` for the vault's account on `intents.near`. "Swaps can't be diverted" → the signed intent payload contains only one `token_diff`.
- Key transactions: `approveAgent`, Intents swaps, margin transfers, rotations.
- Strategist decisions: on-chain hash ↔ full contents ↔ NEAR AI Cloud attestation.
- NAV: component by component, with its source (contract balances, verified 1Click quote prices, the bounded agent report).

### 6.7 Demo and simulations

- `npm run demo`: **no keys, no funds**. Live testnet vault state, the MPC address recomputed, a real mainnet 1Click quote verified (and its forged version rejected), a ±20% crash, guardrails vs a hijacked strategist.
- `npm run attack`: the agent key tries `withdraw3`/`usdSend`/`agentSendAsset` to an attacker, and the agent tries to get a quote with a swapped recipient signed. All rejected.
- `npm run attack:llm`: prompt injection against the real model + a fully hijacked model output → guardrails.
- `npm run simulate:crash`, `npm run simulate:strategy` (hold vs rule vs LLM, Hyperliquid mainnet funding data).
- `scripts/e2e-testnet.ts`, `scripts/reset-testnet.ts`.

### 6.8 Agent: reliability and scale

- **Signing without a CLI:** `near-kit` with a private key from `.env`. A transaction is signed once (its hash is known), resent with the same bytes, and its status polled until final. Safe to retry on any endpoint with no risk of double execution. Public RPCs often time out (500) while waiting on transactions that call MPC.
- **Limited key:** a function-call key that may only call the vault (`scripts/add-agent-keys.ts`). The owner's full-access key is never on the agent host.
- **RPC:** fallback across several endpoints, `NEAR_RPC_URLS` (paid) tried first, then FastNEAR and dRPC; the deprecated `rpc.*.near.org` (about 3.5 s a call) is the last resort, and each call times out so a hung endpoint falls through (13 Nov: with near.org first, every web page took ~7 s to first byte). On start the agent checks each endpoint's `chain_id` and refuses to run if one is from another network (12 Nov: a mainnet RPC in the testnet `.env` made transactions `Expired` and stalled swaps/withdrawals). Transactions rejected by the RPC (`INVALID_TRANSACTION`, except nonce issues) fail right away with the original error instead of waiting 180 seconds.
- **NEAR for gas:** 300 Tgas transactions (`sign_quote`, `fulfill_withdraw`) need ~0.3 NEAR free on the agent account as prepayment, and the rest is refunded. The agent account must always have ≥0.5 NEAR free (12 Nov: 0.27 NEAR → `NotEnoughBalance`, withdrawals stalled). Usage: ~1.1 NEAR/day at a 60 s cycle, ~0.14 at 600 s.
- **Lock:** one agent per network per host (`.state/[mainnet/]agent.lock`). One agent per key is an operating rule: any other transaction with the agent key while the agent runs can break its nonce.
- **Journal:** every money movement is recorded (quote → signed → executed → filled). After a crash, the next cycle resumes: the intent is checked with `is_nonce_used` and executed if it hasn't been and is still valid, `sendAsset` is resent (Hyperliquid rejects duplicate nonces), the mock solver never fills twice. Tested with a forced crash right after MPC signed a margin transfer.
- **Withdrawal scale:** up to 5 per cycle, FIFO, liquidity gathered specifically for the queue.
- **Small hedge gaps:** an IOC order can fill partially (seen on testnet: a 0.00022 BTC short filled 0.0002), leaving a gap outside the band but below the $10 minimum order. The agent then stops reporting and a stale NAV holds deposits. The hedge step now closes such a gap with two orders: a short of the gap + one minimum order, then buys that minimum order back. The short leg always goes first.
- **Venue leverage ≠ vault leverage:** economic leverage (2x) is set by the split of funds (margin = equity / (L+1)). The Hyperliquid leverage setting only sets initial margin per order. If it were set equal to L, margin would be 100% used and every order would be rejected ("Insufficient margin"). The agent sets min(5x, the asset's max). Liquidation risk doesn't change, because cross mode measures maintenance margin against account value, and it's still guarded by the margin emergency rule (< 3× maintenance).
- **Deployment:** `ecosystem.config.cjs` (pm2, autorestart), two processes (testnet + mainnet) on a VPS. Web and docs on Vercel (`nullpoint.fun`, `docs.nullpoint.fun`).
- **Monitoring (§6.9).**
- **Per-asset prices:** 1Click sometimes stops quoting one pair (13 Nov, mainnet: "Quoting for this pair is not available"). The agent reports only the assets that succeeded; the contract only needs fresh prices for the assets it holds.
- **Minimum sizes on mainnet:** send margin ≥ $10 (1Click's ~0.3 fixed fee + 1% slippage has to stay under `margin_slippage_bps` 5%; on 13 Nov the agent tried $4.8 and the contract rejected it every cycle), pull margin ≥ $20 (G-N).

### 6.9 Monitoring and status

- `GET /api/health` in `apps/web` reads both vaults straight from the chain and Hyperliquid: the vault is running (not paused), the agent is reporting (last report < 2 cycles + 3 minutes), the hedge is within the contract's band, the agent has free NEAR (critical < 0.5), the Hyperliquid trading key is still valid. **200** when every critical check passes, **503** otherwise. `?network=mainnet|testnet` for one vault. A hedge out of band is only a warning (it always drifts for a few seconds during each swap).
- **Uptime Kuma** (Docker on the same VPS as the agent) calls that endpoint every 60 seconds (mainnet) / 2–5 minutes (testnet), keeps the history, draws the uptime bars and incidents at `status.nullpoint.fun` (custom CSS following DESIGN.md), and notifies the owner on down/recovery (Telegram or Discord; SMTP email also works). Other monitors: the app and docs (on a static file such as `/icon.svg`, not a server-rendered page, to save Vercel quota), 1Click, Hyperliquid, NEAR RPC, NEAR AI Cloud (directly from the VPS).
- Vercel quota from Kuma: ~86k calls/month, < 1 hour of active CPU (mostly waiting on RPC), far below the Hobby limit.
- Limits: history starts when Kuma was installed; Kuma shares the machine with the agent, so if the VPS goes down the monitor goes down with it.

## 7. Risks and threat model

| ID | Risk | Mitigation | Honest claim |
|---|---|---|---|
| R1 | The agent key leaks | The agent can't withdraw/send. The owner revokes the key through the contract (`approve_agent` with the same name, a new address) and `set_agent` | The agent **can still hurt** the short leg through bad trading or `vaultTransfer`. The spot leg is safe because the contract holds it |
| R2 | Long negative funding | Rotate to another asset. If all are negative → `PARKED` | Yield can be zero |
| R3 | The agent fakes NAV | Spot and USDC are read by the contract from the verifier, prices from verified 1Click quotes. The Hyperliquid account value is checked per report against the previous report + margin moved + price effect. A violation → pause | Not trustless: a malicious agent can shift the account value by up to `max_report_drift_bps` (2%) per report. Repeated shifts show up in the NAV history, and the owner can pause |
| R10 | The LLM strategist is prompt-injected or hallucinates | Closed output schema, fixed guardrails, contract limits, fixed-rule fallback | The LLM can make bad decisions **inside** the fence (e.g. an unprofitable rotation), capped at 2 rotations/day |
| R12 | Hyperliquid rejects orders (congestion, seen on testnet: "only post-only orders") | Hedge first: a swap doesn't run without the matching short. Reports wait while the hedge is unbalanced | Deposits are delayed while the venue is congested. A post-only fallback order isn't built yet |
| R13 | The agent host crashes mid-transfer | Journal + `is_nonce_used`, resumed on the next cycle | A margin intent that expires before the agent is back leaves the margin record wrong → pause, the owner corrects it with `set_margin_net` |
| R11 | A stale or skewed oracle price | Prices only from signed 1Click quotes, age ≤ `max_price_age_s`. Quote prices are net of fees, so NAV is conservative | Depends on 1Click (already trusted for execution). Pyth isn't used: Hermes now needs an API key, Pyth prices on NEAR have been stale for months, and `priceoracle.near` is empty (checked 11 Nov) |
| R4 | The short is liquidated on a sharp price rise | Leverage ≤2x + margin top-ups through Intents | A top-up takes ~30 seconds. An extreme price gap can still liquidate |
| R5 | Rotation costs more than it earns | Payback condition + cooldown | A rotation can lose money if funding flips right after |
| R6 | MPC is slow or fails | Admin actions are rare. Trading doesn't depend on MPC | — |
| R7 | The agent diverts funds through a swap/margin transfer | The contract verifies the 1Click quote signature (ed25519) and checks `recipient`/`refundTo` = vault before MPC signs (§6.2) | A malicious agent can only pick the worst quote that passes the oracle price bound (≤ `max_slippage_bps` per swap). The vault trusts 1Click to execute the quotes it signs |
| R8 | An unhedged window during swaps (~20–35 seconds) | Execution order in §6.3 / §6.4 | There is brief price exposure every time a hedge opens |
| R9 | Venue risk (Hyperliquid) and token bridge risk (nBTC, bridged ETH) | Stated openly | The vault inherits Hyperliquid and bridge risk |
| R14 | The agent dies or runs out of NEAR | Enough NEAR until 25 Nov (testnet 14 NEAR, mainnet 1.5 NEAR), pm2 autorestart on the VPS | While the agent is down, positions stay hedged but reports, rebalancing and withdrawals stop. Users can finish an already-signed withdrawal themselves (`execute_withdraw`) |
| R15 | The Hyperliquid agent key expires | `validUntil` 90 days (mainnet: 10 Feb 2027). Re-approve with `approve-agent.ts` | After that date the agent can't trade until it's re-approved |

## 8. Technical gates and spike results

| Gate | Result |
|---|---|
| G-A: MPC signs EIP-712 that Hyperliquid accepts | ✅ Passed. Args `sign({request:{payload_v2:{Ecdsa:<hex32>},path,domain_id:0}})`, 300 Tgas, 1 yocto |
| G-B: Funding the derived address on testnet | ✅ Faucet to `0x29e0…5c86` (already had a mainnet deposit), then `usdSend` to the derived address |
| G-C: Hyperliquid testnet spot | ❌ Broken. No longer relevant: the spot leg now lives in the vault's Intents account (testnet: mock-verifier) |
| G-D: Who can move margin | ✅ `usdClassTransfer` is user-signed (master only). `vaultTransfer`/`subAccountTransfer` are L1 (the agent can → R1) |
| G-E: 1Click routes for the Intents-native design | ✅ Dry-run quotes succeed: USDC→nBTC on NEAR, USDC NEAR ⇄ USDC Hyperliquid (`hypercore`). See the table in §5 |
| G-F: Margin transfer between the vault's Intents account and Hyperliquid through 1Click | ✅ **Passed (13 Nov, mainnet)**. MPC-signed intent → `submit-intent` → `SUCCESS`: 14.77 USDC sent, 14.45 arrived in the master's perp balance. Buying 29.32 USDC of BTC through the same path: `SUCCESS` |
| G-G: `intents.near` accepts an MPC-signed `erc191` intent | ✅ **Passed (10 Nov)** via `simulate_intents` on mainnet (free, no funds). See the table below |
| G-H: Swap execution path for the vault account | ❌ Solver message bus: **no liquidity for our assets**. Tested 11 Nov: the key isn't checked (no key / fake key / real key behave the same). USDC→USDT got 1 quote, but USDC⇄nBTC and USDC⇄wNEAR were always `null`. The docs also recommend 1Click for swap integrations. ✅ The 1Click signed-intent path works: an `INTENTS` quote + `generate-intent` (`erc191`, signer = the vault's address) produces one `transfer` to `depositAddress`. **Used: 1Click** |
| G-I: The contract can prove `depositAddress` belongs to 1Click | ✅ **Passed (10 Nov)**. Quotes are signed ed25519 by the 1Click manager key. Real quote: valid. Forged `depositAddress`: invalid. NEAR has `env::ed25519_verify` |
| G-J: NEAR AI Cloud models with TEE attestation | ✅ `deepseek-ai/DeepSeek-V4.1-Flash-1017`, `Qwen/Qwen3.8-27B`, `Qwen/Qwen3.6-35B-A3B-FP8` return an attestation + `signing_address`. Claude/GPT/Qwen-max: no attestation (anonymised) |
| G-K: An MPC-signed `sendAsset` from the master is accepted by Hyperliquid (pulling margin) | ✅ 11 Nov on testnet, token `USDC:0xeb62…` (different from mainnet) |
| G-L: NEAR doesn't allow deleting an account with large state | ⚠️ Found 11 Nov → `reinit` with a new generation's storage prefix |
| G-M: `approveAgent` for a master that has no Hyperliquid account yet | ⚠️ Rejected (`userRole: missing`). Mainnet order: deposit → the agent sends margin (without a trading key) → approve → short. The agent is safe in this order because of hedge-first: with no short, the spot swap doesn't run |
| G-N: The cost of pulling margin on mainnet | ⚠️ Found 13 Nov during the first $5 withdrawal: Hyperliquid deducts a **fixed 1 USDC** for a `sendAsset` to a 1Click deposit address (a new address for each quote), on top of 1Click's 0.2 USDC. Not visible on testnet because the mock solver's address never changes. The contract only records the amount sent, so that $1 showed up as an unexplained gap (passed the check with $0.03 to spare). Fix: mainnet `dust_usdc` 1.5 USDC (`set_params`), and the mainnet agent only pulls margin when ≥ $20; small withdrawals are paid by selling spot (~0.3%) |

Spike evidence (10 Nov, `scripts/spike-chainsig-hl.ts`, master `nullpoint.testnet`/`hl-master` = `0x5e33437E5b871F1Aa9E252Dd00a36C53DFcb9a8D`):

| Step | Signer | Result |
|---|---|---|
| `approveAgent` → `0x828766ACCf9179C3b9dA7A6939362ae185Be1831` ("nullpoint-keeper") | MPC | `status: ok`, shows up in `extraAgents` |
| `usdClassTransfer` 50 USDC spot → perp | MPC | `status: ok` |
| Short 0.01 ETH IOC | Agent | Filled @ 2101.65, oid `64984983738`, position recorded on the master account |
| `withdraw3`, `usdSend` | Agent | Rejected (attributed to the agent's own empty account) |
| `agentSendAsset` 1 USDC master → outside address (11 Nov) | Agent | **Rejected**: "Agent can only send asset to same user or their sub-accounts". This L1 action does exist for agents, but Hyperliquid limits its destination to the master's own account / its sub-accounts |

G-G spike evidence (10 Nov, `scripts/spike-intents-sig.ts`, `simulate_intents` on mainnet `intents.near`, salt `252812b3`, a `token_diff` intent −20 USDC / +0.00026 nBTC):

| Signer | Verifier result | Meaning |
|---|---|---|
| Local key (format control) | `insufficient balance or overflow` | Payload format, nonce and signature are correct |
| **MPC** `0x5e33…9a8d` | `insufficient balance or overflow` | ✅ The MPC signature is accepted. It fails only because the balance is empty |
| MPC, payload changed after signing | `public key … doesn't exist for account 0x5e33…` | ✅ The signature really binds the payload contents |

Note: Hyperliquid's default leverage is 20x cross, so the agent must call `updateLeverage`. The final master is derived from the vault contract's account, so it needed funding again.

## 9. Open questions

| ID | Question | Status |
|---|---|---|
| O1 | Does 1Click have a direct route to Hyperliquid? | ✅ Yes, the `hypercore` chain (§5) |
| O2 | Mainnet NEAR accounts for the owner and for the prize payout | ✅ Owner + treasury: `nullpoint.near`. Prize payout: `receive-nullpoint.near` (a separate account, so prize money doesn't mix with vault operations) |
| O3 | ETH on Arbitrum for the master address's gas | ✅ Not needed (direct route) |
| O4 | Team size for the submission field | ✅ 1 (solo builder) |
| O5 | **NEAR Intents partner API key** (partners.near-intents.org) | ✅ Have it (Distribution Channel, in `.env`). Works for `quote`/`generate-intent`. Note: a USDC NEAR→Hyperliquid quote gives the same result with and without the key (19.68 of 20), so the fee discount isn't visible yet |
| O6 | NEAR AI Cloud API key (the $10 claim through nearbuilders.org/dashboard) | ✅ In `.env`, chat + signature endpoints work |
| O7 | Which NEAR AI Cloud model the strategist uses | ✅ `deepseek-ai/DeepSeek-V4.1-Flash-1017`, fallback `Qwen/Qwen3.8-27B` (Gate G-J). JSON output quality checked during the build |

## 10. Work plan

| Day | Phase | Status |
|---|---|---|
| Mon 10 Nov | Research + gate spikes A–J | ✅ |
| Tue 11 Nov | Testnet: contract + mocks + core, agent (allocation, rotation, PARK, batched withdrawals, LLM strategist), 4-page frontend, demo/attack/simulate, agent reliability (near-kit, limited key, journal, lock, hedge-first) | ✅ (PARK → RESUME regression passed 11 Nov) |
| Wed 12 Nov | Frontend redesign, keeper → agent rename, transaction dialogs, interactive dashboard, per-account cost basis, sandbox integration tests, root `npm test`, fees (§6.1), agent mainnet mode, reliability fixes (§6.8) | ✅ |
| Thu 13 Nov | Testnet contract verification, mainnet migration (§12), BTC → NEAR rotation on testnet (G5), partial mainnet withdrawal (G11), `/api/health` (§6.9), VPS (both agents + Uptime Kuma at `status.nullpoint.fun`), Vercel hosting (`nullpoint.fun`, `docs.nullpoint.fun`), Fumadocs docs, READMEs, demo video (Remotion), X post (https://x.com/demigohu/status/2121173944632037500), faster RPC order, submission sent | ✅ |
| 14–25 Nov | Hosting and both agents stay up through judging (16–18 Nov), ideally until 25 Nov | |

**Migration rule:** mainnet wasn't touched until the testnet regression passed. Every mainnet transaction needs the owner's confirmation.

## 11. Submission acceptance criteria

- `git clone && npm install && npm run demo` works with no `.env` (dry-run).
- `npm test` passes (contract + core).
- The README opens with: what the product is, the problem, numbered "do X → see Y" steps, then a "What is verifiable" section of claim → how to check → link (testnet and mainnet).
- A list of tx hashes and addresses: the vault contract (testnet + mainnet), the derived master address, the `approveAgent` tx, Intents swaps, margin transfers, the Hyperliquid position, rotations, the agent's failed withdrawal attempts.
- The hosted dashboard stays up until at least 18 Nov (ideally 25 Nov).
- LICENSE (MIT). Disclosure: libraries, AI-written code, no pre-hackathon code.
- No secrets in the repo. A complete `.env.example`.

## 12. Mainnet deployment (13 Nov)

| Item | Value |
|---|---|
| Vault contract | `vault.nullpoint.near`, reproducible build from commit `8e28abf`, verified on NearBlocks |
| Owner / treasury | `nullpoint.near` |
| Agent | `agent.nullpoint.near` (function-call key, vault only) |
| Vault address (Intents + Hyperliquid master) | `0x610da6eff2adec2aae201c2970fdafe66189b939` (derived by `v1.signer`, path `hl-master`) |
| Hyperliquid trading key | `0xd8b2be1be359685bd052cd5924541f38575ddb71` ("nullpoint-agent", valid until 10 Feb 2027) |

| Step | Tx |
|---|---|
| Create `vault.` (3.8 NEAR) / `agent.` (1.5 NEAR) | `F4Mi9p5KCG2USSJF9WAYwjiHnHrY89T77EyMpPSCd11N` / `8ZF4wSzkj8qPrMH6uXnyp1At4q9k3nET8W8woZX7UGmb` |
| Deploy + init | `J1ZHrMaEqAbciW8wMxMY61W1bzkg3vLiTeF8qjfVWpbU` |
| Register on the USDC contract | `7rCYYWxX4h5qftKT86uSoDc5aqx79RtM16pfwdNSehtuP` |
| Deposit 44 USDC → sweep into Intents | `G5cmNQxcqLA2sYy4L5xQGV8VjgqxpThbz31TxGfzWjEb` |
| Pull 5.76 USDC of margin for withdrawal #0 (Hyperliquid's 1 USDC fee, G-N) | `6yWgxsy7tm2MFh1dmBV5T6JKCNgX8krY88oVQic3pCMK` |
| `set_params`: `dust_usdc` 1.5 USDC | `HcRCVcpSZo37TSt6ZQ4ZqfAvnKg7WdJP7CdDRkH1YJf1` |
| Withdrawal #0 paid: 5 shares → 4.81 USDC to `nullpoint.near` | `8ViwcjoZWNkZmdWRsywVop1GjxAvRftwP4p8UBdcW3rj` |
| 14.77 USDC of margin to Hyperliquid (`sign_quote`) | `G9ManbtAdVcFvedKdRg4VAbcXueZg9TRfZPFpwDKSwD4` |
| `approveAgent` through MPC | `BWsqw7CcbZ54rQpRhtAxXY85kYuf6NMsQQu3QP7BqsaX` |
| Short 0.0004 BTC (Hyperliquid oid `603051969380`), then buy 29.32 USDC of BTC (`sign_quote`) | `6Q4Yuh5NCyGcyGjgPngXxPTUk7cPqUVuiAWDuWygTork` |

Result: NAV 43.77 USDC, spot 0.00040764 nBTC against a 0.0004 BTC short, leverage ~2x, not paused. The partial mainnet withdrawal (G11) finished on 13 Nov in about 8 minutes. Funding (the last part of G11) shows up over time in the NAV history.
