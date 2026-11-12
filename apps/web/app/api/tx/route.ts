// Finds the NEAR transaction behind an activity entry. The vault stores when it signed or decided,
// not the transaction hash, so this asks NearBlocks for the vault's transactions just before that
// moment and picks the call to the expected method.
import type { NextRequest } from "next/server";
import { currentNet } from "@/lib/data";

const METHODS = new Set(["sign_quote", "fulfill_withdraw", "approve_agent", "report_decision"]);
const found = new Map<string, string | null>(); // entries never change, so cache for the process

type Tx = { transaction_hash: string; block_timestamp: string; actions: { method?: string }[] };

export async function GET(req: NextRequest) {
  const ms = Number(req.nextUrl.searchParams.get("ms"));
  const methods = (req.nextUrl.searchParams.get("methods") ?? "").split(",").filter((m) => METHODS.has(m));
  if (!Number.isSafeInteger(ms) || ms <= 0 || !methods.length) return Response.json({ error: "bad query" }, { status: 400 });

  const net = await currentNet();
  const key = `${net.network}:${ms}:${methods.join()}`;
  if (!found.has(key)) {
    const api = net.network === "mainnet" ? "https://api.nearblocks.io" : "https://api-testnet.nearblocks.io";
    const before = BigInt(ms + 3000) * 1_000_000n;
    const r = await fetch(`${api}/v3/accounts/${net.vault}/txns?limit=25&before_ts=${before}`, { headers: { accept: "application/json" } });
    if (!r.ok) return Response.json({ hash: null, error: `NearBlocks ${r.status}` }, { status: 502 });
    const { data } = (await r.json()) as { data: Tx[] | null };
    const tx = (data ?? []).find(
      (t) => Math.abs(Number(BigInt(t.block_timestamp) / 1_000_000n) - ms) <= 3000 && t.actions.some((a) => a.method && methods.includes(a.method)),
    );
    found.set(key, tx?.transaction_hash ?? null);
  }
  return Response.json({ hash: found.get(key) });
}
