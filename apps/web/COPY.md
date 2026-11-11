# Copy deck: NullPoint web

All visible copy for `apps/web` lives here first; components take strings from this file's
wording. Voice and bans: DESIGN.md §10. `{curly}` = live value, never hardcoded.
`[NEED: ...]` = missing proof, do not ship the line until it is resolved.

Readers: (1) people who hold USDC but have never traded perps, (2) hackathon judges who know NEAR
well and will check every claim. Every term a newcomer may not know gets a glossary popover (§G)
the first time it appears on a page.

Voice: plain, second person, short sentences, real numbers. The bot is **the agent** everywhere
users read (the code still calls it the keeper). Its LLM is **the AI** or **the agent's AI model**.
NEAR's MPC network is **NEAR's signers** in prose; "MPC signature" stays as a glossary term.
Run the humanizer pass (`/humanizer:humanizer`) on any new copy before it ships.

---

## Landing `/`

### Hero
- Giant type: the wordmark **null** / **Point** on two lines that drift apart on scroll.
- Headline (h1): **Earn from crypto without betting on it.**
- Sub: Deposit USDC. For every $1 of {coin} the vault holds, it bets $1 against it, so price swings
  cancel. Traders betting on {coin} going up pay that bet a fee every hour. You collect it.
- Primary CTA: `Deposit USDC` → `/app`
- Secondary CTA: `Watch it live` → `/dashboard`
- Hint chip (pointer devices only): click the grid · each + is a dollar long, each − a dollar short

Why: the headline states the promise in words a newcomer already has; the sub explains the $1 / $1
mechanism. The giant wordmark carries the brand.

### 1. Two legs
- Title (live numbers, simulated): **BTC {fell|rose} {x}% in 30 days. A hedged vault {made|lost} {y}%.**
- Body: Every dollar you deposit is split in two. About 67¢ buys BTC. The other 33¢ goes to
  Hyperliquid as collateral for a short of the same size, which is a bet that BTC falls. If BTC
  drops 10%, the BTC loses 6.7¢ and the short makes 6.7¢. Your dollar is still a dollar.
- Aside, **Where the yield comes from:** On Hyperliquid, more traders bet on prices rising than
  falling, many of them with borrowed money. To keep that market close to the real price, the
  crowded side pays the other side every hour. That payment is called funding. NullPoint sits on
  the side that usually gets paid.
- Chart caption: Simulated on the last 30 days of real Hyperliquid prices and funding, with the
  vault's two-thirds / one-third split. Fees not included.

### 2. One cycle, four verbs
- Title: **An AI agent runs the vault. Four jobs, once a minute.**
- Sweep: Picks up new deposits and moves them into the vault's own NEAR Intents account.
- Hedge: Opens the short on Hyperliquid first, then buys the same amount of the coin through NEAR
  Intents. Short first means the vault never holds an unhedged coin, not even for a minute.
- Report: Tells the contract what both sides are worth. The contract prices them itself and throws
  out any report that's off by more than 1%.
- Rotate: An AI model running in a sealed enclave checks which coin pays best. It can switch at most
  twice a day, has to stay 6 hours on a coin, and only moves if the extra yield pays back the
  switching cost within a week.

### 3. Three coins
- Title: **Three coins. The agent holds whichever pays best.**
- Sub: Live funding from Hyperliquid, as a yearly rate. It changes every hour and can go negative.
  When none of the three pays, the vault waits in USDC.
- Card: `{SYMBOL}` · Funding now **{apr}% a year** · Last 8 hours {apr8h}% a year · Market size
  {oi} · tag `vault holds this` on the active coin.

### 4. Built with
- Title: **Built on NEAR. Hedged on Hyperliquid.**
  [NEED: confirm we may call these "partners". Until then the section says "Built on".]
- **NEAR Protocol:** Hosts the vault contract. It mints your shares, prices them, and decides where
  every dollar is allowed to go.
- **NEAR Chain Signatures:** Gives the contract its own Ethereum-style address. That address owns the
  vault's Hyperliquid and Intents accounts, so nothing leaves unless the contract signs.
- **NEAR Intents (1Click):** Swaps USDC for BTC, ETH or NEAR and moves collateral to Hyperliquid. Its
  signed quotes also tell the contract what prices are.
- **NEAR AI Cloud:** Runs the agent's AI model in a sealed enclave. Every answer comes back signed,
  so anyone can check which model said what.
- **Hyperliquid:** Holds the short and pays funding every hour. The agent's key there can trade. It
  can't withdraw.
- Logos: official monochrome marks, rendered in `--t`. [NEED: SVG marks from each brand kit.]

### 5. Security
- Title: **The agent runs the trades. It can't take the money.**
- Manifesto (word scrub): Hedged funds usually ask you to trust whoever holds the exchange keys. Here
  a smart contract holds them. The agent gets a key that can place trades and do nothing else. Money
  moves only when the contract signs, and the contract only signs a swap that pays the vault, at a
  fair price, under a cap.
- Large cell: **We tried to rob it with the agent's own keys.**
  - Withdraw the vault's USDC to an outside wallet → Hyperliquid charged the agent's own empty
    account. The vault lost nothing.
  - Send the vault's USDC to another account → Hyperliquid refused: an agent can only move funds
    inside the account it works for.
  - Get the contract to sign a swap that pays the attacker → The vault refused: the quote wasn't
    signed by 1Click.
  - Footnote: Run the attack yourself: `npm run attack` · see the proof ↗
- **Every swap is checked on-chain:** Before NEAR's signers sign anything, the contract checks
  1Click's signature, who gets paid, and the price.
- **Every AI decision is on the record:** Each call the model makes is stored on-chain with its
  enclave signature, including the ones the limits threw out.
- **Withdrawals pay out on their own:** The agent pays queued withdrawals in order. If one waits more
  than 10 minutes, you can finish it from your wallet.

### 6. Risks
- Title: **What can still go wrong**
- Funding turns negative: Then shorts pay instead of earning. The agent moves to another coin or
  waits in USDC, so some weeks the vault earns nothing.
- Hyperliquid or a bridge fails: The short lives on Hyperliquid, and the BTC and ETH are bridged
  tokens. If either one breaks, the vault loses with it.
- The agent trades badly: A stolen agent key can't withdraw, but it can trade the short badly. The
  limits cap the damage. They don't remove it.
- A sharp rally: A fast jump in price squeezes the short. The agent adds collateral early, but a big
  enough gap can still liquidate it.

### Footer
- Statement: **Long one, short one, net zero.**
- CTAs: `Deposit USDC`, `Start over`
- Testnet note: Running on NEAR testnet with test USDC. Nothing here is real money yet.

### Meta
- Title: NullPoint: earn funding on USDC without betting on price
- Description: Deposit USDC on NEAR. The vault holds a coin and an equal short on Hyperliquid, so
  price swings cancel and the hourly funding goes to your shares. An AI agent runs it and can't
  withdraw.
- Share card: wordmark + the hero headline.

---

## `/app` Vault (deposit and withdraw)

Every wallet transaction goes through one dialog (`components/tx-dialog.tsx`) in three moments:
1. **Review before you sign.** "Checked against the chain just now": the contract's own checks on the
   user's numbers, then a now → after table, then "What you sign (1 transaction)": contract,
   method, arguments, attached deposit, network fee. A failed check: "The contract would refuse
   this, so there's nothing to sign yet. Fix the check marked above."
2. **Waiting for your wallet.** The dialog can't be closed while the wallet is open.
3. **Done**, with the result read back from the chain and the transaction link. Or **Not sent**, with
   the plain reason, then the raw one.

### Left panel
- Title: **Your vault**
- Body: Deposit USDC and you get shares. The vault earns funding and adds it to the share price, so
  your shares grow slowly while coin prices swing.
- Live line: This grid is the vault right now: {long}% long, {short}% short, hedging {coin}.
  (or "waiting in USDC.")

### Value
- Chip: Your value · **${value}** · {shares} shares × ${price} · in your wallet: {usdc} USDC

### Not connected
- Connect a NEAR {network} wallet to deposit. Connecting only shares your account name; nothing is
  sent or signed.

### Deposit
- Helper: How much USDC to put in. You'll see exactly what happens, and what you get back, before
  your wallet asks you to sign anything. (+ empty wallet on testnet: "Your wallet is empty: open your
  account menu (top right) and get 100 test USDC.")
- Button: `Review deposit`
- Checks: You have the USDC · The vault is open · The share price is fresh ("The contract won't take
  deposits on a price older than 10 minutes.") · Under the vault's cap ("The vault would hold ${x}
  of its ${cap} limit.") · You receive shares
- Fields: Method "ft_transfer_call, which sends USDC to the vault and tells it to mint your shares" ·
  Attached "1 yoctoNEAR (…). The token standard requires it as proof that a person signed."
- Notes: If the vault refuses the deposit for any reason, the token contract hands your USDC back in
  the same transaction. Within a minute or so, the agent hedges your USDC: a short on Hyperliquid
  first, then the coin through NEAR Intents.
- Done: Deposited. You received {shares} shares. The agent hedges it within a minute or so. You can
  watch that happen on the dashboard.

### Withdraw
- Helper: Worth about ${usdc} at today's price. The USDC lands in your wallet on its own, usually
  within 1-3 minutes.
- Button: `Review withdrawal`
- Checks: You have the shares · The vault is running
- Notes: Your shares leave your balance as soon as this lands. The agent then prices them at the
  share price of that moment (the contract fixes the price in `fulfill_withdraw`, not at request),
  usually within 1-3 minutes, and NEAR's signers sign the USDC payout to your wallet. That's the only
  thing you sign. If the payout waits more than 10 minutes, a button appears so you can finish it
  yourself.
- Status track:
  - requested: Your shares are handed back and the payout is in line.
  - signed: The agent priced it, and NEAR's signers signed the payout to you.
  - paid: USDC arrived in your wallet.
- Stuck (> 10 min, Alarm): This is taking longer than it should. You can finish it yourself with one
  transaction: it submits the payout the contract already signed. Button: `Review and finish`
- Empty: No withdrawals yet. When you make one, you can follow each step here.

### Account menu (HUD)
- `Get 100 test USDC`: Mints 100 test USDC to your wallet. It's testnet money with no real value. 1
  transaction.
- Network: testnet | mainnet. "Mainnet opens after launch. Until then it only shows live market data."
- Colors: The site takes the colors of the coin the vault holds ({coin}) and changes when the agent
  switches. Preview another:
- Animations on / off
- Disconnect {account}

### Errors (plain words, then the raw reason in Mono)
- You cancelled in your wallet. Nothing was sent.
- The contract rejected this transaction. Reason: `{reason}`
- Couldn't reach NEAR. Your funds didn't move. Try again.

---

## `/dashboard`

- Title: **What the vault is doing right now**
- Stats: Share price ("Recorded {ago}") · Vault size · Funding now ("a year on {coin}, averaged over 8
  hours") · Hedge gap (Δ) ("Coin held minus the short. Close to zero means fully hedged.")
- Chart: Share price over time. "The contract records the share price every 10 minutes."
- Funding: **What each coin pays (funding)**. "Live from Hyperliquid mainnet, as a yearly rate.
  Positive means the short gets paid." Footnote: Payback is how many hours of extra funding it takes
  to earn back the 0.4% cost of switching. The agent may only switch when that is 168 hours (7 days)
  or less.
- Both sides right now: Coin held (NEAR Intents) · Short (Hyperliquid) · Collateral on Hyperliquid
- Feed title: **Everything the vault did, newest first**. "Every MPC signature the contract asked for
  and every decision the AI made, in plain words. The raw details sit under each line."
- Feed lines (`lib/activity.ts`):
  - Brought {x} USDC of collateral back from Hyperliquid. The contract signed it.
  - Gave the agent its Hyperliquid key ({address}). It can trade with it, not withdraw.
  - Paid out a withdrawal: {x} USDC to {account}.
  - Sent {x} USDC through 1Click, either to buy the coin or as collateral on Hyperliquid. The
    contract checked the quote first.
  - Sold {qty} {coin} for USDC through 1Click. The contract checked the quote first.
  - The AI / The backup rule said {ACTION coin}: {note}. The limits allowed it. / blocked it.

## `/proof`

- Title: **Check it yourself**
- Intro: Six claims about who can move the money, each with its evidence and a command you can run
  yourself. The ones marked live were checked again when this page loaded.
- Claims:
  1. The contract owns one Ethereum-style address, and that address owns both the Intents account
     and the Hyperliquid account.
  2. The agent's Hyperliquid key can trade for the vault. It can't withdraw or send money anywhere.
  3. Swaps and collateral moves can only ever pay the vault.
  4. The contract prices the vault itself. The agent can't make the number up.
  5. Every AI decision is signed inside an enclave and stored on-chain.
  6. Anyone can finish a signed withdrawal, and it can only pay the person who asked.
- Addresses: Vault contract · Vault's MPC address (owns the Hyperliquid and Intents accounts) ·
  Agent account (NEAR) · Intents verifier · MPC signer

---

## §G Glossary popovers

- **Share:** Your slice of the vault. The number of shares you hold stays the same; what each one is
  worth goes up.
- **Share price:** Everything the vault owns, minus what it owes, divided by all shares. The contract
  works it out itself from signed prices.
- **Funding:** An hourly payment between traders on Hyperliquid. When more people bet on prices
  rising, they pay the people betting on prices falling.
- **Short:** A position that gains when the price falls.
- **Hedge:** Holding a coin and an equal short, so price moves cancel.
- **Agent:** The bot that runs the vault every minute, with an AI model that picks the coin. It can
  place trades. It can't move money out.
- **MPC signature:** A signature made by NEAR's network of signers on the contract's behalf. No single
  person ever holds the key.
- **Enclave:** A sealed part of a chip. Nobody can see or change the code running inside, and it can
  prove what it ran.
