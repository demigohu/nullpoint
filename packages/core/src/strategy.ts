// Strategy: the rule-based policy and the guardrails every decision (rule or LLM) must pass.
// Pure functions; the keeper gathers the inputs and executes accepted decisions.

export type Market = {
  symbol: string;
  /** Hyperliquid funding, annualised %, latest hourly rate. */
  fundingAprNow: number;
  /** Mean of the last `windowHours` hourly rates, annualised %. Shorts earn it when positive. */
  fundingApr8h: number;
  openInterestUsd: number;
};

export type Action = "HOLD" | "ROTATE" | "PARK" | "RESUME" | "SET_LEVERAGE";

export type Decision = {
  action: Action;
  target?: string;
  leverage?: number;
  confidence: number;
  reasoning: string;
};

export type Context = {
  /** Asset currently hedged, or null when parked in USDC. */
  active: string | null;
  heldSinceMs: number;
  nowMs: number;
  rotationsLast24h: number;
  /** Round-trip cost of moving the hedge, in bps of notional (swap + closing/opening shorts). */
  rotationCostBps: number;
  allowlist: string[];
};

export type Limits = { [K in keyof typeof BASE_LIMITS]: number };

const BASE_LIMITS = {
  minLeverage: 1,
  maxLeverage: 2,
  maxRotationsPerDay: 2,
  minHoldHours: 6,
  maxPaybackHours: 168,
  minConfidence: 0.6,
  /** Rule policy only: park when the best 8h funding is below this, resume above `resumeApr`. */
  parkBelowApr: 0,
  resumeApr: 3,
  minEdgeApr: 5,
} as const;

export const LIMITS: Limits = BASE_LIMITS;

/** Hours of extra funding needed to earn back a rotation's cost. Infinity if there's no edge. */
export function paybackHours(costBps: number, edgeApr: number): number {
  return edgeApr <= 0 ? Infinity : (costBps / 10_000) * 8760 / (edgeApr / 100);
}

const by = (markets: Market[], s: string | null) => markets.find((m) => m.symbol === s);
const best = (markets: Market[], allow: string[]) =>
  markets.filter((m) => allow.includes(m.symbol)).sort((a, b) => b.fundingApr8h - a.fundingApr8h)[0];

/** Deterministic policy: the fallback when the LLM is unavailable, and the baseline it's compared to. */
export function ruleDecision(ctx: Context, markets: Market[], LIMITS: Limits = BASE_LIMITS): Decision {
  const top = best(markets, ctx.allowlist);
  if (!top) return { action: "HOLD", confidence: 1, reasoning: "no market data" };
  const cur = by(markets, ctx.active);
  if (!ctx.active) {
    return top.fundingApr8h >= LIMITS.resumeApr
      ? { action: "RESUME", target: top.symbol, confidence: 1, reasoning: `${top.symbol} 8h funding ${top.fundingApr8h.toFixed(1)}% APR ≥ ${LIMITS.resumeApr}%` }
      : { action: "HOLD", confidence: 1, reasoning: `parked: best 8h funding ${top.fundingApr8h.toFixed(1)}% APR` };
  }
  if (top.fundingApr8h < LIMITS.parkBelowApr) {
    return { action: "PARK", confidence: 1, reasoning: `best 8h funding ${top.fundingApr8h.toFixed(1)}% APR is negative` };
  }
  if (cur && top.symbol !== cur.symbol) {
    const edge = top.fundingApr8h - cur.fundingApr8h;
    const payback = paybackHours(ctx.rotationCostBps, edge);
    if (edge >= LIMITS.minEdgeApr && payback <= LIMITS.maxPaybackHours) {
      return { action: "ROTATE", target: top.symbol, confidence: 1, reasoning: `${top.symbol} ${top.fundingApr8h.toFixed(1)}% vs ${cur.symbol} ${cur.fundingApr8h.toFixed(1)}% APR, payback ${payback.toFixed(0)}h` };
    }
  }
  return { action: "HOLD", confidence: 1, reasoning: `${ctx.active} stays: no rotation pays back within ${LIMITS.maxPaybackHours}h` };
}

/** Validates any decision against hard limits. The contract enforces its own limits on top. */
export function guardrail(d: Decision, ctx: Context, markets: Market[], LIMITS: Limits = BASE_LIMITS): { ok: true } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  if (!["HOLD", "ROTATE", "PARK", "RESUME", "SET_LEVERAGE"].includes(d.action)) return no(`unknown action ${d.action}`);
  if (!(d.confidence >= LIMITS.minConfidence && d.confidence <= 1)) return no(`confidence ${d.confidence} below ${LIMITS.minConfidence}`);
  if (d.action === "HOLD") return { ok: true };
  if (d.action === "SET_LEVERAGE") {
    return d.leverage !== undefined && d.leverage >= LIMITS.minLeverage && d.leverage <= LIMITS.maxLeverage
      ? { ok: true }
      : no(`leverage ${d.leverage} outside ${LIMITS.minLeverage}-${LIMITS.maxLeverage}`);
  }
  if (d.action === "PARK") return ctx.active ? { ok: true } : no("already parked");
  // ROTATE / RESUME need an allowlisted target with data.
  if (!d.target || !ctx.allowlist.includes(d.target)) return no(`target ${d.target} not allowlisted`);
  const t = by(markets, d.target);
  if (!t) return no(`no market data for ${d.target}`);
  if (d.action === "RESUME") return ctx.active ? no("not parked") : { ok: true };
  if (!ctx.active) return no("parked: use RESUME");
  if (d.target === ctx.active) return no("already hedged in target");
  if (ctx.rotationsLast24h >= LIMITS.maxRotationsPerDay) return no(`${LIMITS.maxRotationsPerDay} rotations in 24h already`);
  const heldH = (ctx.nowMs - ctx.heldSinceMs) / 3_600_000;
  if (heldH < LIMITS.minHoldHours) return no(`held ${heldH.toFixed(1)}h < ${LIMITS.minHoldHours}h`);
  // Payback uses observed funding, never the model's forecast.
  const edge = t.fundingApr8h - (by(markets, ctx.active)?.fundingApr8h ?? 0);
  const payback = paybackHours(ctx.rotationCostBps, edge);
  if (payback > LIMITS.maxPaybackHours) return no(`payback ${Number.isFinite(payback) ? payback.toFixed(0) + "h" : "never"} > ${LIMITS.maxPaybackHours}h`);
  return { ok: true };
}
