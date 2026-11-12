// Crash safety for the agent host: a process lock, and a journal of fund moves so a restart can
// finish what a previous run started (a signed intent that never executed, an unfilled mock quote).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Network, QuoteResponse } from "@nullpoint/core";

export const NET = (process.env.NETWORK ?? "testnet") as Network;
if (NET !== "testnet" && NET !== "mainnet") throw new Error(`NETWORK must be testnet or mainnet, got ${NET}`);
// One state dir per network, so a testnet and a mainnet agent can share a host.
const DIR = new URL(`../.state/${NET === "testnet" ? "" : "mainnet/"}`, import.meta.url);
const LOCK = new URL("agent.lock", DIR);
const FILE = new URL("journal.json", DIR);
mkdirSync(DIR, { recursive: true });

/** One agent per host: a second process exits instead of acting on the same vault twice. */
export function acquireLock() {
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, "utf8"));
    try {
      process.kill(pid, 0);
      throw new Error(`another agent is running (pid ${pid}); stop it first`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; // stale lock from a crash: take over
    }
  }
  writeFileSync(LOCK, String(process.pid));
  const release = () => existsSync(LOCK) && Number(readFileSync(LOCK, "utf8")) === process.pid && rmSync(LOCK);
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(130));
}

export type Move = {
  q: QuoteResponse;
  ms: number;
  /** Index in the vault's get_signed list once sign_quote landed. */
  signedId?: number;
  executed?: boolean;
  filled?: boolean;
};

const load = (): Record<string, Move> => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {});
const save = (j: Record<string, Move>) => writeFileSync(FILE, JSON.stringify(j, null, 1));

export const journal = {
  all: load,
  put(depositAddress: string, m: Move) {
    const j = load();
    j[depositAddress] = m;
    save(j);
  },
  update(depositAddress: string, patch: Partial<Move>) {
    const j = load();
    if (j[depositAddress]) j[depositAddress] = { ...j[depositAddress]!, ...patch };
    save(j);
  },
  /** Drops finished or abandoned entries older than `maxAgeMs`. */
  prune(maxAgeMs: number) {
    const j = load();
    for (const [k, m] of Object.entries(j)) if (m.filled || Date.now() - m.ms > maxAgeMs) delete j[k];
    save(j);
  },
};
