"use client";
// Review → sign → result for every wallet transaction (DESIGN.md §5 Explainer). Opening it reads the
// chain and runs the contract's own checks on the user's numbers, so the review shows what will
// happen before anything is signed. After signing it reads the chain again and shows what did.
import { useEffect, useRef, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import type { NetConfig } from "@/lib/config";
import { links } from "@/lib/config";

export type Check = { label: string; ok: boolean; detail: string };
export type Change = { label: string; before: string; after: string };
export type Simulation = {
  /** The one-line answer to "what do I give, what do I get". */
  summary: { give: string; get: string };
  /** The vault's own fee for this amount, in plain words; shown next to the network fee. */
  vaultFee?: [label: string, text: string];
  checks: Check[];
  changes: Change[];
};
export type TxSpec = {
  title: string;
  confirm: string;
  call: { contractId: string; method: string; args: Record<string, unknown>; gas: string; deposit?: string };
  /** One line per field of the transaction, in plain words. */
  /** Network fee in plain words. */
  fee: string;
  /** What happens after signing, in plain words. */
  notes: string[];
  /** Contract, method, arguments, deposit: folded under "Technical details". */
  signs: [string, string][];
  simulate: () => Promise<Simulation>;
  /** Reads the chain after the transaction: what actually happened. */
  result: () => Promise<{ title: string; changes?: Change[]; next?: string }>;
};

type Phase = { k: "simulating" } | { k: "review"; sim: Simulation } | { k: "signing"; sim: Simulation } | { k: "done"; hash?: string; res: Awaited<ReturnType<TxSpec["result"]>> } | { k: "error"; title: string; reason?: string };

/** Wallet and contract errors in plain words; the raw reason stays visible. */
export function explain(e: unknown) {
  const raw = (e as Error)?.message ?? String(e);
  if (/reject|cancel|denied|closed/i.test(raw)) return { title: "You cancelled in your wallet. Nothing was sent." };
  if (/fetch|network|timeout/i.test(raw)) return { title: "Couldn't reach NEAR. Your funds didn't move. Try again.", reason: raw.slice(0, 200) };
  const panic = raw.match(/Smart contract panicked: ([^"\\]*)|panicked at[^:]*: ?([^"\\]*)/);
  return { title: "The contract rejected this transaction.", reason: (panic?.slice(1).find(Boolean) ?? raw).slice(0, 240) };
}

export function TxDialog({ net, spec, onClose }: { net: NetConfig; spec: TxSpec | null; onClose: () => void }) {
  const { callFunctionRaw } = useNearWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>({ k: "simulating" });

  const simulate = async (s: TxSpec) => {
    setPhase({ k: "simulating" });
    try {
      setPhase({ k: "review", sim: await s.simulate() });
    } catch (e) {
      setPhase({ k: "error", ...explain(e) });
    }
  };

  useEffect(() => {
    if (!spec) return;
    ref.current?.showModal();
    simulate(spec);
  }, [spec]);

  const sign = async () => {
    if (!spec || phase.k !== "review") return;
    setPhase({ k: "signing", sim: phase.sim });
    try {
      const r = await callFunctionRaw(spec.call);
      // A transaction can land while one of its receipts fails (e.g. the vault refusing a deposit).
      const failure = (r.receipts_outcome ?? []).map((o) => (o.outcome.status as { Failure?: unknown }).Failure).find(Boolean);
      if (failure) throw new Error(`Smart contract panicked: ${JSON.stringify(failure).match(/"(?:panic_msg|ExecutionError)":"([^"]+)"/)?.[1] ?? JSON.stringify(failure)}`);
      setPhase({ k: "done", hash: r.transaction_outcome?.id, res: await spec.result() });
      window.dispatchEvent(new Event("np:balances"));
    } catch (e) {
      setPhase({ k: "error", ...explain(e) });
    }
  };

  const close = () => {
    ref.current?.close();
    onClose();
  };

  const blocked = phase.k === "review" && phase.sim.checks.some((c) => !c.ok);
  const sim = phase.k === "review" || phase.k === "signing" ? phase.sim : null;

  return (
    <dialog
      ref={ref}
      aria-labelledby="tx-title"
      onCancel={(e) => (phase.k === "signing" ? e.preventDefault() : onClose())}
      className="tx overscroll-contain"
    >
      {spec && (
        <div className="grid gap-6 p-[var(--pad)]">
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="chip">{phase.k === "done" ? "Done" : phase.k === "error" ? "Not sent" : phase.k === "signing" ? "Waiting for your wallet" : "Review before you sign"}</p>
              <h2 id="tx-title" className="wdth-110 mt-3 text-[clamp(1.5rem,2.4vw,2.2rem)] font-bold leading-[1.02] tracking-[-0.035em]">{spec.title}</h2>
            </div>
            {phase.k !== "signing" && (
              <button onClick={close} className="font-mono text-[12px] uppercase tracking-[0.2em] underline underline-offset-2">Close</button>
            )}
          </header>

          {phase.k === "simulating" && (
            <p className="font-mono text-[13px]"><span className="blink">■</span> Checking your numbers against the contract, the same way it will…</p>
          )}

          {sim && (
            <>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-y border-tc py-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em]">You give</p>
                  <p className="num mt-1 text-[clamp(1.2rem,2.4vw,1.7rem)] font-bold leading-tight">{sim.summary.give}</p>
                </div>
                <span aria-hidden className="num text-[1.5rem]">→</span>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em]">You get</p>
                  <p className="num mt-1 text-[clamp(1.2rem,2.4vw,1.7rem)] font-bold leading-tight">{sim.summary.get}</p>
                </div>
              </div>

              <section>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.2em]">Your balances</h3>
                <Changes rows={sim.changes} />
              </section>

              {(() => {
                const failed = sim.checks.filter((c) => !c.ok);
                const list = (
                  <ul className="mt-2 grid gap-1.5">
                    {(failed.length ? failed : sim.checks).map((c) => (
                      <li key={c.label} className={`flex gap-2 text-[14px] leading-[1.4] ${c.ok ? "" : "text-alarm"}`}>
                        <i aria-hidden className={`mt-[4px] block size-[10px] shrink-0 border ${c.ok ? "border-tc bg-tc" : "border-alarm"}`} />
                        <span>
                          <span className="sr-only">{c.ok ? "Passes: " : "Fails: "}</span>
                          <b>{c.label}.</b> {c.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                );
                return failed.length ? (
                  <section>
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-alarm">The contract would refuse this</h3>
                    {list}
                  </section>
                ) : (
                  <details>
                    <summary className="cursor-pointer text-[14px]">
                      <span className="mr-2 inline-block size-[10px] bg-tc align-middle" aria-hidden />
                      Checked just now: the contract will accept this ({sim.checks.length} of {sim.checks.length} checks pass)
                    </summary>
                    {list}
                  </details>
                );
              })()}

              <section className="text-[14px] leading-[1.5]">
                {sim.vaultFee && <p><b>{sim.vaultFee[0]}:</b> {sim.vaultFee[1]}</p>}
                <p><b>Network fee:</b> {spec.fee}</p>
                <h3 className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em]">What happens next</h3>
                <ul className="mt-1 grid gap-1">
                  {spec.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </section>

              <details className="border-t border-tc pt-3">
                <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.2em]">Technical details (what your wallet will show)</summary>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
                  {spec.signs.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-mono text-[12px]">{k}</dt>
                      <dd className="break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </details>

              <div className="flex flex-wrap gap-3">
                <button onClick={sign} disabled={blocked || phase.k === "signing"} className="btn" data-label={spec.confirm}>
                  {phase.k === "signing" ? "Approve in your wallet…" : spec.confirm}
                </button>
                {phase.k === "review" && <button onClick={close} className="btn btn-ghost" data-label="Cancel">Cancel</button>}
              </div>
              {blocked && <p className="text-[13px] text-alarm">Nothing to sign yet. Fix what&apos;s listed above and review again.</p>}
            </>
          )}

          {phase.k === "done" && (
            <>
              <p className="text-[16px] font-bold leading-[1.4]">{phase.res.title}</p>
              {phase.res.changes && <Changes rows={phase.res.changes} />}
              {phase.res.next && <p className="text-[14px] leading-[1.5]">{phase.res.next}</p>}
              {phase.hash && (
                <a href={links(net).tx(phase.hash)} target="_blank" rel="noreferrer" className="num break-all text-[12px] underline underline-offset-2">
                  Transaction {phase.hash} ↗
                </a>
              )}
              <button onClick={close} className="btn w-fit" data-label="Close">Close</button>
            </>
          )}

          {phase.k === "error" && (
            <>
              <p className="text-[16px] font-bold text-alarm">{phase.title}</p>
              {phase.reason && <p className="num break-all text-[12px]">Reason: {phase.reason}</p>}
              <div className="flex gap-3">
                <button onClick={() => simulate(spec)} className="btn" data-label="Review again">Review again</button>
                <button onClick={close} className="btn btn-ghost" data-label="Close">Close</button>
              </div>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}

function Changes({ rows }: { rows: Change[] }) {
  return (
    <table className="num mt-2 w-full text-[13px]">
      <thead>
        <tr className="text-left font-mono text-[11px] uppercase tracking-[0.15em]">
          <th className="py-1 font-normal"><span className="sr-only">Item</span></th>
          <th className="py-1 font-normal">Now</th>
          <th className="py-1 font-normal">After</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-tc">
            <td className="py-1.5 pr-3 font-sans">{r.label}</td>
            <td className="py-1.5 pr-3">{r.before}</td>
            <td className="py-1.5 font-bold">{r.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
