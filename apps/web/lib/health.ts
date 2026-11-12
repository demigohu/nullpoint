// Health of each network's vault, read from the chain and Hyperliquid on every request, for /api/health.
// Uptime Kuma polls that endpoint, keeps the history and emails on 503 (status.nullpoint.fun).
import { ASSETS, hlInfo, rpc, view } from "@nullpoint/core";
import { NETS } from "@/lib/config";

export type NetName = keyof typeof NETS;

/** `critical` checks failing make /api/health answer 503, which is what the uptime monitor emails about. */
export type Check = { name: string; ok: boolean; critical: boolean; detail: string };

type State = {
  agent: string;
  paused: boolean;
  total_shares: string;
  config: { vault_address: string };
  params: { hedge_band_bps: number; dust_usdc: string };
  snapshot: { nav: string; ms: number; spot: string[] } | null;
};
type Position = { coin: string; szi: string };

const DAY = 86_400_000;
const fmtAge = (ms: number) => (ms < 120_000 ? `${Math.round(ms / 1000)}s` : ms < 2 * 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

export async function networkHealth(name: NetName) {
  const n = NETS[name];
  const now = Date.now();
  const state = await view<State>(n.network, n.vault, "get_state");
  const addr = state.config.vault_address;
  const [account, agents, hl, [meta, ctxs]] = await Promise.all([
    rpc(n.network, "query", { request_type: "view_account", finality: "final", account_id: state.agent }).then((r) => r.result as { amount: string; storage_usage: number }),
    hlInfo<{ name: string; validUntil: number }[]>(n.hlChain, { type: "extraAgents", user: addr }),
    hlInfo<{ assetPositions: { position: Position }[] }>(n.hlChain, { type: "clearinghouseState", user: addr }),
    hlInfo<[{ universe: { name: string }[] }, { markPx: string }[]]>(n.hlChain, { type: "metaAndAssetCtxs" }),
  ]);

  const checks: Check[] = [];
  checks.push({ name: "Vault running", ok: !state.paused, critical: true, detail: state.paused ? "Paused: deposits, withdrawals and swaps are stopped until the owner checks it." : "Accepting deposits and withdrawals." });

  // The agent reports once per run; two missed runs (plus slack for a slow settlement) means it's down.
  const age = state.snapshot ? now - state.snapshot.ms : Infinity;
  const late = (2 * n.agentMin + 3) * 60_000;
  checks.push({ name: "Agent reporting", ok: age <= late, critical: true, detail: state.snapshot ? `Last report ${fmtAge(age)} ago. Expected every ${n.agentMin} min.` : "No report yet." });

  // Same test as the contract's report check: spot vs short per coin, within the band plus dust.
  const mark = (coin: string) => Number(ctxs[meta.universe.findIndex((u) => u.name === coin)]?.markPx ?? 0);
  const gaps = ASSETS.map((a, i) => {
    const spot = Number(BigInt(state.snapshot?.spot[i] ?? "0")) / 10 ** a.decimals;
    const short = -Number(hl.assetPositions.find((p) => p.position.coin === a.hlCoin)?.position.szi ?? 0);
    const gapUsd = Math.abs(spot - short) * mark(a.hlCoin);
    const allowed = (spot * mark(a.hlCoin) * state.params.hedge_band_bps) / 10_000 + Number(state.params.dust_usdc) / 1e6;
    return { coin: a.symbol, gapUsd, ok: gapUsd <= allowed };
  }).filter((g) => g.gapUsd > 0.005);
  const off = gaps.filter((g) => !g.ok);
  // Not critical: the gap opens for a few seconds during every swap and the agent closes it.
  checks.push({ name: "Hedged", ok: off.length === 0, critical: false, detail: off.length ? `${off.map((g) => `${g.coin} off by $${g.gapUsd.toFixed(2)}`).join(", ")}. The agent closes gaps each run.` : gaps.length ? `Spot and short match (largest gap $${Math.max(...gaps.map((g) => g.gapUsd)).toFixed(2)}).` : "Nothing held: waiting in USDC." });

  // Available NEAR = balance minus what storage locks (1e19 yocto per byte). 300 Tgas calls prepay ~0.3 NEAR.
  const near = (Number(BigInt(account.amount) - BigInt(account.storage_usage) * 10n ** 19n) / 1e24);
  checks.push({ name: "Agent has gas", ok: near >= 1, critical: near < 0.5, detail: `${near.toFixed(2)} NEAR available on ${state.agent}. Swaps and payouts need about 0.3 NEAR up front.` });

  const until = Math.max(0, ...agents.map((a) => a.validUntil));
  const daysLeft = (until - now) / DAY;
  checks.push({ name: "Trading key valid", ok: daysLeft > 14, critical: daysLeft <= 0, detail: until ? `Hyperliquid approval ends ${new Date(until).toISOString().slice(0, 10)} (${Math.floor(daysLeft)} days).` : "No trading key approved." });

  return { network: name, checks };
}

/** Both networks; a network that can't be read at all is one failed critical check. */
export async function allHealth() {
  return Promise.all((Object.keys(NETS) as NetName[]).map(safeHealth));
}

export const safeHealth = (name: NetName) =>
  networkHealth(name).catch((e) => ({ network: name, checks: [{ name: "Readable", ok: false, critical: true, detail: `Could not read the vault: ${(e as Error).message.slice(0, 160)}` }] as Check[] }));
