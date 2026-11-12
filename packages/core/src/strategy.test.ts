import { test } from "node:test";
import assert from "node:assert/strict";
import { guardrail, marginAction, paybackHours, ruleDecision, type Context, type Market } from "./strategy.ts";

const H = 3_600_000;
const m = (symbol: string, apr: number): Market => ({ symbol, fundingAprNow: apr, fundingApr8h: apr, openInterestUsd: 1e8 });
const ctx = (over: Partial<Context> = {}): Context => ({
  active: "BTC", heldSinceMs: 0, nowMs: 48 * H, rotationsLast24h: 0, rotationCostBps: 40, allowlist: ["BTC", "ETH", "NEAR"], ...over,
});

test("payback: 0.4% cost needs ~21% APR edge to pay back in a week", () => {
  assert.equal(Math.round(paybackHours(40, 5)), 701);
  assert.ok(paybackHours(40, 21) < 168);
  assert.equal(paybackHours(40, 0), Infinity);
});

test("rule: holds on small edges, rotates on large ones, parks on negative funding", () => {
  assert.equal(ruleDecision(ctx(), [m("BTC", 10), m("NEAR", 14)]).action, "HOLD");
  const r = ruleDecision(ctx(), [m("BTC", 10), m("NEAR", 40)]);
  assert.equal(r.action, "ROTATE");
  assert.equal(r.target, "NEAR");
  assert.equal(ruleDecision(ctx(), [m("BTC", -5), m("NEAR", -2)]).action, "PARK");
  assert.equal(ruleDecision(ctx({ active: null }), [m("BTC", 8), m("NEAR", 2)]).target, "BTC");
});

test("guardrail blocks what an injected or confused model might ask for", () => {
  const mk = [m("BTC", 10), m("NEAR", 40), m("SOL", 90)];
  const ok = (d: object, c = ctx()) => guardrail({ confidence: 0.9, reasoning: "", ...d } as never, c, mk);
  assert.deepEqual(ok({ action: "ROTATE", target: "NEAR" }), { ok: true });
  assert.match((ok({ action: "ROTATE", target: "SOL" }) as any).reason, /not allowlisted/);
  assert.match((ok({ action: "SET_LEVERAGE", leverage: 20 }) as any).reason, /outside/);
  assert.match((ok({ action: "WITHDRAW" }) as any).reason, /unknown action/);
  assert.match((ok({ action: "ROTATE", target: "NEAR" }, ctx({ heldSinceMs: 47 * H })) as any).reason, /held/);
  assert.match((ok({ action: "ROTATE", target: "NEAR" }, ctx({ rotationsLast24h: 2 })) as any).reason, /rotations/);
  assert.match((ok({ action: "ROTATE", target: "NEAR", confidence: 0.2 }) as any).reason, /confidence/);
  // Payback is checked on observed funding even if the model claims a big edge.
  assert.match((guardrail({ action: "ROTATE", target: "NEAR", confidence: 0.9, reasoning: "" }, ctx(), [m("BTC", 10), m("NEAR", 12)]) as any).reason, /payback/);
});

test("margin rule: top up from idle USDC, else shrink the hedge, else wait", () => {
  const base = { maintenance: 2, idleUsdc: 0, spotUsd: 0, minTradeUsd: 12 };
  assert.equal(marginAction({ ...base, accountValue: 10 }), "ok"); // 5x maintenance
  assert.equal(marginAction({ ...base, accountValue: 5, idleUsdc: 20 }), "top_up"); // 2.5x, cash on hand
  assert.equal(marginAction({ ...base, accountValue: 5, spotUsd: 40 }), "shrink"); // no cash, sell spot
  assert.equal(marginAction({ ...base, accountValue: 5, spotUsd: 5 }), "wait"); // too small to trade
  assert.equal(marginAction({ ...base, maintenance: 0, accountValue: 0 }), "ok"); // no position
});
