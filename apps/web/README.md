# apps/web

The NullPoint app: landing page, the vault (deposit and withdraw), the live dashboard, and `/api/health`. Next.js 16, React 19, Tailwind CSS 4. Hosted at https://nullpoint.fun.

## Run

```bash
npm install          # from the repo root
npm run dev -w web   # http://localhost:3000
```

No keys needed: every read is a public NEAR or Hyperliquid call, and every write is signed by the visitor's own wallet. Switch between testnet and mainnet in the account menu (top right); testnet also offers 100 free test USDC there.

## Pages

| Route | What |
|---|---|
| `/` | Landing: the idea, a 30-day simulation on real Hyperliquid data, live funding per coin, fees, risks, FAQ |
| `/app` | Deposit and withdraw. Each action opens a review that runs the contract's own checks before the wallet signs, then reads the result back from the chain. Withdrawals show requested → signed → paid with transaction links |
| `/dashboard` | Share price chart, both legs, hedge ratio and liquidation distance, funding per coin with switch payback, the AI's latest decision vs the fixed rule, and every swap, short, transfer and decision with its transaction |
| `/proof` | Redirects to the docs' live Verify page |
| `/api/health` | 200 or 503 with live checks of both vaults, for Uptime Kuma (`?network=mainnet` or `testnet`) |
| `/api/tx` | Finds the NEAR transaction behind an activity entry or a withdrawal step (via NearBlocks) |

## Code map

| Path | What |
|---|---|
| `lib/config.ts` | Per-network addresses, explorers, agent pace |
| `lib/data.ts` | Server-side reads: vault state, history, Hyperliquid position and fills, funding |
| `lib/health.ts` | The health checks behind `/api/health` |
| `lib/activity.ts` | Turns signed payloads, fills and decisions into readable activity entries |
| `components/vault-panel.tsx`, `tx-dialog.tsx` | Deposit and withdraw with review |
| `components/field/` | The animated `+` / `−` field (with a unit test) |

Design rules for everything here: [DESIGN.md](DESIGN.md). Copy rules: [COPY.md](COPY.md).

## Environment (optional)

`SITE_URL`, `NEXT_PUBLIC_DOCS_URL`, `NEXT_PUBLIC_REPO_URL`, `NEXT_PUBLIC_DEFAULT_NET` (`testnet` by default).
