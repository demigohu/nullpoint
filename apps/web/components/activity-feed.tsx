"use client";
// Everything the vault did (DESIGN.md §7 dashboard): filter by kind, page through it, open a row to
// see every field, the transaction on NearBlocks and the raw payload.
import { useEffect, useRef, useState } from "react";
import type { Activity, Category } from "@/lib/activity";

const FILTERS: [Category | "all", string][] = [
  ["all", "All"],
  ["trade", "Trades"],
  ["collateral", "Collateral"],
  ["withdrawal", "Withdrawals"],
  ["ai", "AI decisions"],
  ["setup", "Setup"],
];
const PER_PAGE = 10;

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

export function ActivityFeed({ items, explorer, hlAccount }: { items: Activity[]; explorer: string; hlAccount: string }) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Activity | null>(null);
  const shown = filter === "all" ? items : items.filter((a) => a.category === filter);
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const rows = shown.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const count = (c: Category | "all") => (c === "all" ? items.length : items.filter((a) => a.category === c).length);

  return (
    <div>
      <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
        {FILTERS.filter(([c]) => c === "all" || count(c) > 0).map(([c, label]) => (
          <button
            key={c}
            aria-pressed={filter === c}
            onClick={() => {
              setFilter(c);
              setPage(0);
            }}
            className={`h-9 border border-tc px-3 font-mono text-[12px] uppercase tracking-[0.12em] ${filter === c ? "bg-tc text-fc" : ""}`}
          >
            {label} <span className="opacity-70">{count(c)}</span>
          </button>
        ))}
      </div>

      <ol className="mt-4">
        {rows.map((a) => (
          <li key={a.key} className="border-t border-tc">
            <button onClick={() => setOpen(a)} className="grid w-full gap-1 py-3 text-left md:grid-cols-12 md:gap-4 hover:bg-tc hover:text-fc focus-visible:bg-tc focus-visible:text-fc focus-visible:outline-none">
              <span className="font-mono text-[12px] md:col-span-2" title={new Date(a.ms).toLocaleString()}>{ago(a.ms)}</span>
              <span className="md:col-span-10">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className={`font-bold ${a.ok ? "" : "text-alarm"}`}>{a.title}</span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.15em] opacity-70">{FILTERS.find(([c]) => c === a.category)?.[1]}</span>
                </span>
                <span className="mt-1 line-clamp-2 block text-[14px] leading-[1.45]">{a.text}</span>
              </span>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="border-t border-tc py-6 text-[14px]">Nothing of this kind yet.</li>}
      </ol>

      <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 border-t border-tc pt-4 font-mono text-[12px]">
        <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="h-9 border border-tc px-3 uppercase tracking-[0.12em] disabled:opacity-30">
          ← Newer
        </button>
        <span>
          Page {page + 1} of {pages} · {shown.length} entries
        </span>
        <button onClick={() => setPage((p) => p + 1)} disabled={page >= pages - 1} className="h-9 border border-tc px-3 uppercase tracking-[0.12em] disabled:opacity-30">
          Older →
        </button>
      </nav>

      <Detail item={open} explorer={explorer} hlAccount={hlAccount} onClose={() => setOpen(null)} />
    </div>
  );
}

function Detail({ item, explorer, hlAccount, onClose }: { item: Activity | null; explorer: string; hlAccount: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [hash, setHash] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!item) return;
    ref.current?.showModal();
    setHash(undefined);
    fetch(`/api/tx?ms=${item.ms}&methods=${item.methods.join(",")}`)
      .then((r) => r.json())
      .then((j: { hash: string | null }) => setHash(j.hash))
      .catch(() => setHash(null));
  }, [item]);

  const close = () => {
    ref.current?.close();
    onClose();
  };

  return (
    <dialog ref={ref} onCancel={onClose} aria-labelledby="detail-title" className="tx overscroll-contain">
      {item && (
        <div className="grid gap-5 p-[var(--pad)]">
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="chip">{FILTERS.find(([c]) => c === item.category)?.[1]}</p>
              <h2 id="detail-title" className={`wdth-110 mt-3 text-[clamp(1.4rem,2.2vw,2rem)] font-bold leading-[1.05] tracking-[-0.03em] ${item.ok ? "" : "text-alarm"}`}>
                {item.title}
              </h2>
              <p className="num mt-1 text-[12px]">{new Date(item.ms).toLocaleString()} · {ago(item.ms)}</p>
            </div>
            <button onClick={close} className="font-mono text-[12px] uppercase tracking-[0.2em] underline underline-offset-2">Close</button>
          </header>

          <p className="text-[15px] leading-[1.5]">{item.text}</p>

          <dl className="grid gap-x-4 gap-y-2 border-t border-tc pt-4 text-[13px] sm:grid-cols-[auto_1fr]">
            <dt className="font-mono text-[12px]">Transaction</dt>
            <dd className="num break-all">
              {hash === undefined ? (
                <span className="blink">looking it up…</span>
              ) : hash ? (
                <a href={`${explorer}/txns/${hash}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">{hash} ↗</a>
              ) : (
                <span>Not on NearBlocks yet. The indexer can lag a few minutes; try again shortly.</span>
              )}
            </dd>
            {item.hl && (
              <>
                <dt className="font-mono text-[12px]">On Hyperliquid</dt>
                <dd className="num break-all">
                  <a href={hlAccount} target="_blank" rel="noreferrer" className="underline underline-offset-2">The vault&apos;s account ↗</a>
                </dd>
              </>
            )}
            {item.fields.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-[12px]">{k}</dt>
                <dd className="num break-all">{v}</dd>
              </div>
            ))}
          </dl>

          {item.raw && (
            <details className="border-t border-tc pt-3">
              <summary className="cursor-pointer font-mono text-[12px] uppercase tracking-[0.15em]">{item.category === "ai" ? "Full note" : "Exact payload signed"}</summary>
              <pre className="num mt-2 max-h-56 overflow-auto overscroll-contain whitespace-pre-wrap break-all text-[12px]">
                {item.category === "ai" ? item.raw : pretty(item.raw)}
              </pre>
            </details>
          )}
        </div>
      )}
    </dialog>
  );
}

const pretty = (s: string) => {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
};
