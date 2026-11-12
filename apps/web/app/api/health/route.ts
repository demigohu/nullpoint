// For Uptime Kuma: 200 when every critical check passes, 503 otherwise (Kuma marks it down and emails).
// ?network=mainnet|testnet checks one network, so each vault is its own monitor.
import type { NextRequest } from "next/server";
import { NETS } from "@/lib/config";
import { allHealth, safeHealth, type NetName } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const only = req.nextUrl.searchParams.get("network");
  if (only && !(only in NETS)) return Response.json({ error: "network must be testnet or mainnet" }, { status: 400 });
  const nets = only ? [await safeHealth(only as NetName)] : await allHealth();
  const failing = nets.flatMap((n) => n.checks.filter((c) => c.critical && !c.ok).map((c) => `${n.network}: ${c.name}`));
  const body = { ok: failing.length === 0, failing, checkedAt: new Date().toISOString(), networks: nets };
  return Response.json(body, { status: failing.length ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
