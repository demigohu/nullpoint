// Finds the NEAR transaction behind an activity entry. The vault stores when it signed or decided,
// not the transaction hash, so this asks NearBlocks for the vault's transactions just before that
// moment and picks the call to the expected method. A withdrawal's payout (execute_withdraw, by the
// agent or the user) has no stored time, so `after` + `id` looks in the minutes after its signature
// and matches the withdrawal id in the call's arguments.
import type { NextRequest } from "next/server";
import { currentNet } from "@/lib/data";

const METHODS = new Set(["sign_quote", "fulfill_withdraw", "approve_agent", "report_decision", "execute_withdraw"]);
const PAYOUT_WINDOW_MS = 15 * 60_000;
const found = new Map<string, string | null>(); // entries never change, so cache for the process

type Tx = { transaction_hash: string; block_timestamp: string; actions: { method?: string }[] };

export async function GET(req: NextRequest) {
  const ms = Number(req.nextUrl.searchParams.get("ms"));
  const methods = (req.nextUrl.searchParams.get("methods") ?? "").split(",").filter((m) => METHODS.has(m));
  if (!Number.isSafeInteger(ms) || ms <= 0 || !methods.length) return Response.json({ error: "bad query" }, { status: 400 });

  const id = req.nextUrl.searchParams.get("id");
  const after = id !== null && /^\d+$/.test(id);

  const net = await currentNet();
  const key = `${net.network}:${ms}:${methods.join()}:${id}`;
  if (!found.has(key)) {
    const api = net.network === "mainnet" ? "https://api.nearblocks.io" : "https://api-testnet.nearblocks.io";
    const get = (path: string) => fetch(`${api}/v3${path}`, { headers: { accept: "application/json" } });
    const before = BigInt(ms + (after ? PAYOUT_WINDOW_MS : 3000)) * 1_000_000n;
    const r = await get(`/accounts/${net.vault}/txns?limit=50&before_ts=${before}`);
    if (!r.ok) return Response.json({ hash: null, error: `NearBlocks ${r.status}` }, { status: 502 });
    const { data } = (await r.json()) as { data: Tx[] | null };
    const at = (t: Tx) => Number(BigInt(t.block_timestamp) / 1_000_000n);
    const calls = (data ?? []).filter((t) => t.actions.some((a) => a.method && methods.includes(a.method)));
    let hash: string | null = null;
    if (!after) hash = calls.find((t) => Math.abs(at(t) - ms) <= 3000)?.transaction_hash ?? null;
    else {
      // Oldest first; the list has no arguments, so open each candidate until the id matches.
      for (const t of calls.filter((t) => at(t) >= ms - 3000).reverse()) {
        const d = await get(`/txns/${t.transaction_hash}`).then((x) => (x.ok ? x.json() : null));
        if (d?.data?.actions?.some((a: { args?: { args_json?: { id?: number } } }) => String(a.args?.args_json?.id) === id)) {
          hash = t.transaction_hash;
          break;
        }
      }
    }
    // A payout not found yet may still land: only cache what was found.
    if (hash || !after) found.set(key, hash);
    else return Response.json({ hash: null });
  }
  return Response.json({ hash: found.get(key) });
}
