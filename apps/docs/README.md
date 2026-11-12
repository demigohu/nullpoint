# apps/docs

The NullPoint docs, built with Fumadocs and themed to the app's design system. Hosted at https://docs.nullpoint.fun.

```bash
npm run dev -w docs   # http://localhost:3001
npm run build -w docs
```

## Content

MDX pages in [`content/docs`](content/docs), ordered by [`meta.json`](content/docs/meta.json):

| Section | Pages | For |
|---|---|---|
| Start here | What is NullPoint, How you earn, Deposit and withdraw, Fees, Risks, FAQ | Anyone, no background needed |
| How it works | Architecture, The two legs, Swaps: verify then sign, NAV and the share price, The agent cycle, AI strategist and limits, Security model, Testnet and mainnet | Reviewers and skeptical users |
| Verify | Verify it live, Mainnet proof, Attacks that fail, Status and monitoring | Evidence |
| Developers | Run it yourself, Contract reference, Running the agent, Deploy and verify, Lessons from mainnet | Builders |

## Diagrams

Fourteen Mermaid diagrams, written inline as `<Mermaid chart={...} />` so they read as text in the repository. [`components/mdx/mermaid.tsx`](components/mdx/mermaid.tsx) draws them in the page's two colors.

## Live content

[`components/live.tsx`](components/live.tsx) renders `<LiveChecks network="..." />` and `<MainnetProof />` on the server from the real contract and Hyperliquid, revalidated every minute.
