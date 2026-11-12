// Mainnet 1Click: real quotes, the vault-signed transfer intent handed to 1Click's /submit-intent
// (1Click relays it to intents.near, so the agent pays no gas for it), then the swap followed to a
// terminal status. Same interface as mock1click.ts.
import { ONECLICK_URL, getQuote, type QuoteResponse } from "@nullpoint/core";

const KEY = process.env.NEAR_INTENTS_API_KEY;
const headers = { "Content-Type": "application/json", ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const quote = (req: Record<string, unknown>): Promise<QuoteResponse> => getQuote(req, KEY);

/** Deposits into a quote by submitting the vault's signed Intents transfer to its deposit address. */
export async function execute(_verifier: string, intent: { standard: string; payload: string; signature: string }) {
  const res = await fetch(`${ONECLICK_URL}/submit-intent`, { method: "POST", headers, body: JSON.stringify({ type: "swap_transfer", signedData: intent }) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.intentHash) throw new Error(`1Click submit-intent failed [${res.status}]: ${JSON.stringify(body).slice(0, 300)}`);
}

const DONE = ["SUCCESS", "REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"];

/**
 * Waits for the solver to deliver. Returns the terminal status; throws while still pending so the
 * journal keeps the move and the next cycle checks again.
 */
export async function complete(_verifier: string, r: QuoteResponse, waitMs = 180_000): Promise<string> {
  const deadline = Date.now() + waitMs;
  let status = "";
  while (Date.now() < deadline) {
    const res = await fetch(`${ONECLICK_URL}/status?depositAddress=${encodeURIComponent(r.quote.depositAddress)}`, { headers });
    status = res.ok ? ((await res.json()).status ?? "") : `HTTP ${res.status}`;
    if (DONE.includes(status)) return status;
    await sleep(5000);
  }
  throw new Error(`1Click swap still ${status || "unknown"} after ${waitMs / 1000}s; will check again next cycle`);
}
