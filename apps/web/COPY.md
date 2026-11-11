# Copy deck: NullPoint web

All visible copy for `apps/web` lives here first; components take strings from this file's
wording. Voice and bans: DESIGN.md §10. `{curly}` = live value, never hardcoded.
`[NEED: ...]` = missing proof, do not ship the line until it is resolved.

Readers: (1) crypto users who hold USDC but have never traded perps, (2) hackathon judges who
know NEAR well and will check every claim. Every term a newcomer may not know gets a glossary
popover (§G) the first time it appears on a page.

---

## Landing `/`

### Hero
- Wordmark: **null**Point
- Headline: **Deposit USDC. Collect the fee leveraged traders pay every hour.**
- Sub (≤ 20 words): The vault buys a coin and shorts the same amount. Price moves cancel. The fee is what's left.
- Primary CTA: `Deposit USDC` → `/app`
- Secondary CTA: `See it live` → `/dashboard`

Alternatives considered:
- A (chosen). Shows the money's source in plain words ("fee leveraged traders pay"), and the
  sub shows the mechanism. A newcomer can picture it; a judge can verify it.
- B. "Your USDC earns what leveraged traders pay, while price moves cancel out." Accurate, but
  packs mechanism and benefit into one line; harder to scan at display size.
- C. "Earn the fee leveraged traders pay, with no bet on price." Punchier, but "no bet on
  price" overstates it (a sharp rally can still hurt, see Risks).

### 1. Two legs
- Title: **Price goes up, price goes down. Your share stays put.**
- Body: For every $1 of BTC the vault holds, it also holds a $1 bet that BTC falls: a short on
  Hyperliquid. When BTC drops, the coin loses what the short gains. When it rises, the reverse.
- Chart caption: Last 30 days on real Hyperliquid prices and funding. BTC {btcMove}%. NullPoint
  {hedgedMove}%. Simulated with the vault's split, fees not included.
- Aside, **Where the fee comes from:** On Hyperliquid more traders bet on prices rising than
  falling. To keep the two sides balanced, the longs pay the shorts every hour. That payment is
  called funding. NullPoint is always on the short side, so it collects it.

### 2. One cycle, four verbs
- Title: **A keeper runs the same four steps, over and over.**
- Sweep: New deposits move from the vault contract into its own NEAR Intents account.
- Hedge: The keeper opens a short on Hyperliquid, then buys the same amount of the coin through
  NEAR Intents. The short goes first, so the vault never holds a coin without its hedge.
- Report: The keeper reports both legs. The contract prices them with signed quotes and rejects
  any report that drifts more than 1% from what it expects.
- Rotate: When another coin pays clearly more, a model running in a secure enclave suggests a
  switch. Hard limits decide: 2 switches a day at most, 6 hours minimum per coin, and the extra
  fee must repay the switch cost within 7 days.

### 3. Three coins
- Title: **Three coins. The vault holds whichever pays most.**
- Card: `{SYMBOL}` / funding now **{apr}% a year** / open interest {oi} / tag `held now` on the
  active coin.
- Caption: Live from Hyperliquid. Funding changes every hour and can turn negative.

### 4. Built with
- Title: **Five pieces, each with one job.**
  [NEED: confirm we may call these "partners". Until then the heading says "Built with".]
- **NEAR Protocol:** Runs the vault contract: your shares, the share price, and every rule on this
  page.
- **NEAR Chain Signatures:** Gives the contract its own Ethereum-style address. That address owns
  the Hyperliquid account and the Intents account, so money leaves only when the contract signs.
- **NEAR Intents (1Click):** Swaps USDC for BTC, ETH or NEAR and moves margin to Hyperliquid. Its
  signed quotes are also the contract's price feed.
- **NEAR AI Cloud:** Runs the strategist model inside a hardware enclave. Each answer is signed,
  and the signature is checked against the enclave's attestation.
- **Hyperliquid:** Holds the short and pays funding every hour. The keeper's key there can place
  orders and cannot withdraw.
- Logos: official monochrome marks, rendered in `--t`. [NEED: SVG marks from each brand kit.]

### 5. Security
- Title (kept): **The bot runs the trades. It can't take the money.**
- Manifesto (word scrub): Delta-neutral funds usually ask you to trust whoever holds the
  exchange keys. Here the exchange account belongs to a smart contract. The keeper holds a key
  that can place orders and nothing else. Money moves only when the contract signs, and it signs
  only when a swap pays the vault, at a fair price, under a cap.
- Large cell (kept): **We tried to steal from it with the keeper's own keys.** Rows:
  - `withdraw to attacker` → rejected by Hyperliquid: billed to the agent's own empty account
  - `agentSendAsset to attacker` → rejected by Hyperliquid: only to the same user or sub-accounts
  - `1Click quote paying attacker` → rejected by the vault contract: quote not signed by 1Click
  - Footnote: Run it yourself: `npm run attack`
- **Every swap is checked on-chain:** The contract verifies 1Click's signature, the recipient and
  the price before NEAR's MPC network signs anything.
- **Every decision is on the record:** Each strategist call is stored on-chain with its enclave
  signature, whether the limits accepted it or not.
- **Withdrawals pay themselves:** The keeper pays queued withdrawals in order. If one waits more
  than 10 minutes, you can finish it from your own wallet.

### 6. Risks
- Title (kept): **What can still go wrong**
- Funding turns negative: Shorts pay instead of earn. The vault parks in USDC when no coin pays,
  so yield can be zero.
- Hyperliquid and bridges: The short lives on Hyperliquid and spot is bridged BTC or ETH. If
  either fails, the vault takes the loss.
- A bad trade by the keeper: A stolen trading key can't withdraw, but it can trade the short
  badly. Limits cap the damage; they don't remove it.
- Sharp rallies: A fast move up squeezes the 2x short. The keeper shrinks both legs early; a
  large gap can still liquidate.

### Footer
- Statement: **Long one, short one, net zero.**
- CTA: `Deposit USDC`
- Network note on testnet: Running on NEAR testnet with test USDC. Mainnet opens with a $100 cap.
  [NEED: confirm cap and date before mainnet]
- `start over`

### Meta
- Title: NullPoint: USDC that earns perp funding
- Description: Deposit USDC on NEAR. The vault holds a coin and an equal short on Hyperliquid, so
  price moves cancel and the hourly funding goes to your shares.

---

## `/app` Vault (deposit and withdraw)

Every action has three moments: **before you sign** (what will happen, in one or two lines),
**while it runs** (status track), **after** (a receipt with the transaction link). Amounts in
these strings are live.

### Header
- Your value: **${value}** · {shares} shares at ${price} each
- Term popovers on: share, share price.

### Not connected
- Connect a NEAR {network} wallet to deposit. Connecting only shares your account name; nothing
  is sent or signed.
- Button: `Connect wallet`

### Test USDC (testnet only)
- Button: `Get 100 test USDC`
- Before: Mints 100 test USDC to your wallet. It has no real value. 1 transaction.
- After: 100 test USDC added. Transaction {hash} ↗

### Deposit
- Label: Amount (USDC) · Balance {balance} · `MAX`
- Before you sign: You'll sign 1 transaction that sends {amount} USDC to the vault contract
  ({vault}). You receive about {shares} shares at ${price} each.
- Disabled, stale price: Deposits pause while the share price is more than 10 minutes old, so
  nobody buys in at an outdated price. The keeper refreshes it every cycle.
- Button: `Deposit {amount} USDC`
- After: Deposited. {amount} USDC is in the vault and {shares} shares are in your account.
  Next, the keeper hedges it: a short on Hyperliquid, then the coin through NEAR Intents.
  Transaction {hash} ↗

### Withdraw
- Label: Shares to withdraw · You hold {shares} · `MAX`
- Before you sign: You'll sign 1 transaction asking the vault to buy back {shares} shares, worth
  about ${usdc} at today's price. The keeper frees the USDC and the contract sends it to your
  wallet, usually within 1-3 minutes.
- Button: `Withdraw ${usdc}`
- Status track:
  - requested: The vault recorded your request and fixed the price.
  - signed: NEAR's MPC network signed the payout. Anyone can now execute it.
  - paid: ${usdc} arrived in your wallet. Transaction {hash} ↗
- Stuck (> 10 min, Alarm): This is taking longer than usual. You can finish it yourself: 1
  transaction that executes the payout the contract already signed. Button: `Finish it myself`
- Empty list: No withdrawals yet. Requests show up here with each step as it happens.

### Errors (plain words, then the raw reason in Mono)
- Rejected in wallet: You cancelled in your wallet. Nothing was sent.
- Not enough USDC: Your wallet has {balance} USDC. Lower the amount or get test USDC.
- Contract rejected: The vault rejected this transaction. Reason: `{reason}`
- Network: Couldn't reach NEAR. Your funds didn't move. Try again.

---

## `/dashboard`

- Title: **What the vault is doing right now**
- Stats: Share price · Total deposits (TVL) · Funding now (a year) · Hedge gap (Δ)
- Hedge gap caption: Difference between the coin held and the short. Near zero means fully hedged.
- NAV chart title: Share price over time. Caption: Recorded on-chain every 10 minutes.
- Funding radar title: Funding across the three coins.
- Activity feed (plain sentence first, technical line under it in Mono):
  - sweep: Moved {x} USDC of new deposits into the vault's Intents account.
  - margin in: Sent {x} USDC to Hyperliquid as collateral for the short. Signed by the vault's MPC key.
  - margin out: Brought {x} USDC back from Hyperliquid.
  - swap: Bought {qty} {coin} for {x} USDC through NEAR Intents at ${px}.
  - short: Adjusted the {coin} short to {size} on Hyperliquid.
  - report: Reported both legs: {long} long, {short} short. Share price ${price}.
  - withdrawal: Paid withdrawal #{id}: {x} USDC to {account}.
  - strategist accepted: Strategist suggested {action} {coin} (payback {h}h). The limits accepted it.
  - strategist rejected: Strategist suggested {action} {coin}. Rejected: {reason}.
  - paused: Vault paused: {reason}. Deposits and new trades stop until it is cleared.

## `/proof`

- Title: **Check it yourself**
- Intro: Every address and signature below is on-chain. Each link opens the explorer.
- Addresses: Vault contract · Vault's MPC address (owns the Hyperliquid and Intents accounts) ·
  Keeper account · Keeper's Hyperliquid agent (can trade, can't withdraw)
- Signatures title: Latest signatures from NEAR's MPC network
- Row: {kind in plain words} · {time} · `{payload hash}` ↗ (click to expand the payload)

---

## §G Glossary popovers

- **Share:** Your slice of the vault. Shares don't change in number; their price does.
- **Share price (NAV per share):** Everything the vault holds, minus what it owes, divided by all
  shares. The contract computes it from signed prices.
- **Funding:** An hourly payment between traders on Hyperliquid. When more traders are long, the
  longs pay the shorts.
- **Short:** A position that gains when the price falls.
- **Hedge:** Holding a coin and an equal short, so price moves cancel.
- **Keeper:** The bot that runs the vault's routine. It can place trades but can't move money out.
- **MPC signature:** A signature produced by NEAR's network of signers on the contract's behalf.
  No single person holds the key.
- **Enclave (TEE):** A sealed part of a processor. Code inside it runs unseen and proves what ran.
