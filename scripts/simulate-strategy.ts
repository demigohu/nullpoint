// Backtest on real Hyperliquid mainnet funding for BTC/ETH/NEAR (last N days):
//   hold BTC  vs  rule policy  vs  LLM strategist (optional, one call per decision step)
// Yield = funding earned on the active asset's short, minus 40 bps per rotation. Same guardrail for all.
//   node simulate-strategy.ts [--days 21] [--llm --every 24]     (--llm needs NEARAI_API_KEY)
import { askStrategist, guardrail, ruleDecision, hlInfo, type Context, type Decision, type Market } from "@nullpoint/core";

const arg = (k: string, d: number) => Number(process.argv[process.argv.indexOf(k) + 1] ?? d) || d;
const DAYS = arg("--days", 21), EVERY_H = arg("--every", 24), COST_BPS = 40;
const SYMBOLS = ["BTC", "ETH", "NEAR"];
const H = 3_600_000;

// Hourly funding rates per symbol (Hyperliquid returns at most 500 rows per call).
async function history(coin: string, startTime: number) {
  const out: { time: number; rate: number }[] = [];
  for (let t = startTime; t < Date.now(); ) {
    const page = await hlInfo<{ time: number; fundingRate: string }[]>("mainnet", { type: "fundingHistory", coin, startTime: t });
    if (!page.length) break;
    out.push(...page.map((p) => ({ time: p.time, rate: Number(p.fundingRate) })));
    t = page.at(-1)!.time + 1;
    if (page.length < 500) break;
  }
  return out;
}

const start = Date.now() - DAYS * 24 * H;
const series = Object.fromEntries(await Promise.all(SYMBOLS.map(async (s) => [s, await history(s, start - 8 * H)] as const)));
const hours = series.BTC!.filter((x) => x.time >= start).map((x) => x.time);
const rateAt = (s: string, t: number) => series[s]!.findLast((x) => x.time <= t)?.rate ?? 0;
const marketsAt = (t: number): Market[] =>
  SYMBOLS.map((s) => {
    const w = series[s]!.filter((x) => x.time > t - 8 * H && x.time <= t);
    const avg = w.reduce((a, x) => a + x.rate, 0) / (w.length || 1);
    return { symbol: s, fundingAprNow: rateAt(s, t) * 8760 * 100, fundingApr8h: avg * 8760 * 100, openInterestUsd: 0 };
  });

type Policy = (ctx: Context, m: Market[]) => Promise<Decision>;
async function backtest(name: string, policy: Policy | null) {
  let active: string | null = "BTC", heldSince = hours[0]!, earnedBps = 0, rotations: number[] = [], llmCalls = 0, lastSlot = -1;
  for (const t of hours) {
    // Funding timestamps aren't on the exact hour, so decide whenever a new EVERY_H slot starts.
    const slot = Math.floor((t - hours[0]!) / (EVERY_H * H));
    if (policy && slot !== lastSlot) {
      lastSlot = slot;
      const m = marketsAt(t);
      const ctx: Context = { active, heldSinceMs: heldSince, nowMs: t, rotationsLast24h: rotations.filter((r) => t - r < 24 * H).length, rotationCostBps: COST_BPS, allowlist: SYMBOLS };
      const d = await policy(ctx, m);
      llmCalls++;
      if (guardrail(d, ctx, m).ok && d.action !== "HOLD" && d.action !== "SET_LEVERAGE") {
        if (d.action === "PARK") active = null;
        else {
          if (active) earnedBps -= COST_BPS;
          active = d.target!;
        }
        heldSince = t;
        if (d.action === "ROTATE") rotations.push(t);
      }
    }
    if (active) earnedBps += rateAt(active, t) * 10_000; // shorts earn positive funding
  }
  const apr = (earnedBps / 100) * (365 / DAYS);
  console.log(`${name.padEnd(12)} ${apr.toFixed(2).padStart(7)}% APR   rotations ${rotations.length}   ended in ${active ?? "USDC"}${policy ? `   decisions ${llmCalls}` : ""}`);
}

console.log(`Hyperliquid mainnet funding, ${DAYS} days (${hours.length} hours), decisions every ${EVERY_H}h, ${COST_BPS} bps per rotation\n`);
await backtest("hold BTC", null);
await backtest("rule", async (c, m) => ruleDecision(c, m));
if (process.argv.includes("--llm")) {
  await backtest("LLM", async (c, m) => (await askStrategist(process.env.NEARAI_API_KEY!, c, m)).decision);
}
