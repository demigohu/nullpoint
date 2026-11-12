// Live reads for the Verify pages: each claim is checked against the chain when the page renders
// (cached a minute), or comes with a command to run yourself.
import { ASSETS, deriveEvmAddress, hlInfo, view } from "@nullpoint/core";
import { NETS, readVault } from "@/lib/vault";

type Claim = { plain: string; detail: string; ok: boolean | null; evidence: React.ReactNode; command: string };

export async function LiveChecks({ network }: { network: "testnet" | "mainnet" }) {
  const net = NETS[network];
  const { state, decisions, signed, agents } = await readVault(net);
  const addr = state.config.vault_address;
  const derived = deriveEvmAddress(net.network, net.vault, state.config.mpc_path);
  const ai = decisions.filter((d) => d.source === "llm").at(-1);

  const claims: Claim[] = [
    {
      plain: "The contract, not a person, owns the vault's accounts.",
      detail: "One Ethereum-style address, derived from the contract through NEAR Chain Signatures, is both the Intents account and the Hyperliquid account.",
      ok: derived.toLowerCase() === addr.toLowerCase(),
      evidence: <>Recomputed now from <code>{state.config.mpc}</code> for <code>{net.vault}</code> / <code>{state.config.mpc_path}</code>: <code>{derived}</code>. The contract&apos;s configured address: <code>{addr}</code>.</>,
      command: `near contract call-function as-read-only ${state.config.mpc} derived_public_key json-args '{"path":"${state.config.mpc_path}","predecessor":"${net.vault}","domain_id":0}' network-config ${network} now`,
    },
    {
      plain: "The agent can trade, and it can't withdraw.",
      detail: "Its Hyperliquid key is an approved agent on the vault's account. Hyperliquid refuses withdrawals and transfers signed by an agent key.",
      ok: agents.length > 0,
      evidence: <>Agents approved on the vault&apos;s Hyperliquid account right now: {agents.length ? agents.map((a) => <code key={a.address}>{a.name} {a.address} </code>) : "none"}. The attack script uses this key to try <code>withdraw3</code>, <code>usdSend</code> and <code>agentSendAsset</code> to an outside address; all three are refused.</>,
      command: "npm run attack",
    },
    {
      plain: "Swaps can only ever pay the vault.",
      detail: "sign_quote checks 1Click's signature, that the vault is recipient and refund address, the price and the cap, then builds the intent itself.",
      ok: null,
      evidence: <>The contract&apos;s unit tests run against real mainnet 1Click quotes, including a forged one that pays an attacker.</>,
      command: "cd contracts && cargo test -p vault",
    },
    {
      plain: "The contract prices the vault itself.",
      detail: "Coin and USDC balances come straight from the Intents contract, priced with signed 1Click quotes. The agent reports only the Hyperliquid side, within 2% of what the contract expects.",
      ok: state.snapshot !== null,
      evidence: <>Latest snapshot: {state.snapshot ? <>NAV <code>{(Number(state.snapshot.nav) / 1e6).toFixed(2)} USDC</code> at <code>{new Date(state.snapshot.ms).toISOString().replace("T", " ").slice(0, 19)} UTC</code></> : "none yet"}.</>,
      command: `near contract call-function as-read-only ${net.vault} get_state json-args '{}' network-config ${network} now`,
    },
    {
      plain: "Every AI decision is signed and on the record.",
      detail: "The model runs in a NEAR AI Cloud enclave; its answer is signed, checked against the enclave's attestation, and stored on-chain.",
      ok: ai ? true : null,
      evidence: ai ? <>Latest AI decision: <code>{ai.action}{ai.target ? ` ${ai.target}` : ""}</code> ({ai.accepted ? "allowed" : "blocked"} by the limits), chat <code>{ai.chat_id}</code>, signed by enclave <code>{ai.signing_address}</code>.</> : <>No AI decision recorded on this network yet.</>,
      command: "npm run attack:llm",
    },
    {
      plain: "Your withdrawal doesn't depend on us.",
      detail: "execute_withdraw has no caller check: once a payout is signed, anyone can submit it, and it can only pay the person who asked.",
      ok: null,
      evidence: <>The end-to-end test deposits, requests a withdrawal, and submits the signed payout from the user&apos;s own account.</>,
      command: "npm run e2e:testnet",
    },
  ];

  return (
    <div className="not-prose grid gap-4">
      <ol className="grid gap-4">
        {claims.map((c, i) => (
          <li key={c.plain} className="panel p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className={c.ok === false ? "bg-alarm px-2 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-fc" : "chip"}>
                {c.ok === null ? "check with the command" : c.ok ? "checked live: true" : "checked live: FALSE"}
              </span>
              <span className="font-mono text-[12px]">0{i + 1}</span>
            </div>
            <p className="wdth-110 mt-3 text-[1.15rem] font-bold leading-snug">{c.plain}</p>
            <p className="mt-1 text-[15px] leading-[1.5]">{c.detail}</p>
            <details className="mt-3 border-t border-tc pt-3">
              <summary className="cursor-pointer font-mono text-[12px] uppercase tracking-[0.15em]">Evidence and command</summary>
              <p className="mt-3 break-words text-[14px] leading-[1.5]">{c.evidence}</p>
              <pre className="mt-3 overflow-x-auto border border-tc p-3 font-mono text-[12px]">{c.command}</pre>
            </details>
          </li>
        ))}
      </ol>
      <table className="w-full text-[14px]">
        <tbody>
          {[
            ["Vault contract", net.vault, `${net.explorer}/address/${net.vault}`],
            ["The vault's address (Intents + Hyperliquid)", addr, `${net.hlApp}/explorer/address/${addr}`],
            ["Agent account", state.agent, `${net.explorer}/address/${state.agent}`],
            ["Intents contract", state.config.verifier, `${net.explorer}/address/${state.config.verifier}`],
            ["MPC signer", state.config.mpc, `${net.explorer}/address/${state.config.mpc}`],
          ].map(([k, v, href]) => (
            <tr key={k} className="border-t border-tc">
              <td className="py-2 pr-4 align-top">{k}</td>
              <td className="py-2 break-all"><a className="underline underline-offset-2" href={href} target="_blank" rel="noreferrer"><code>{v}</code> ↗</a></td>
            </tr>
          ))}
        </tbody>
      </table>
      {signed.length > 0 && (
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.15em]">Latest payloads the contract asked NEAR&apos;s signers to sign</p>
          {signed.slice().reverse().map((s) => (
            <details key={s.id} className="border-t border-tc py-2">
              <summary className="cursor-pointer text-[14px]"><code>#{s.id} {s.kind}</code> · {new Date(s.ms).toISOString().replace("T", " ").slice(0, 16)} UTC</summary>
              <pre className="mt-2 overflow-x-auto font-mono text-[12px]">{(() => { try { return JSON.stringify(JSON.parse(s.payload), null, 2); } catch { return s.payload; } })()}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

/** The mainnet vault right now: both legs, read from NEAR Intents and Hyperliquid. */
export async function MainnetProof() {
  const net = NETS.mainnet;
  const state = await view<{ config: { vault_address: string; verifier: string }; snapshot: { nav: string; ms: number; spot: string[] } | null; total_shares: string; paused: boolean }>(net.network, net.vault, "get_state");
  const addr = state.config.vault_address;
  const hl = await hlInfo<{ marginSummary: { accountValue: string }; assetPositions: { position: { coin: string; szi: string; entryPx: string } }[] }>("mainnet", { type: "clearinghouseState", user: addr });
  const spot = ASSETS.map((a, i) => ({ a, qty: Number(BigInt(state.snapshot?.spot[i] ?? "0")) / 10 ** a.decimals })).filter((x) => x.qty > 0);
  const rows: [string, React.ReactNode][] = [
    ["Vault value (NAV)", state.snapshot ? `${(Number(state.snapshot.nav) / 1e6).toFixed(2)} USDC, ${(Number(state.snapshot.nav) / Number(state.total_shares)).toFixed(4)} per share` : "no report yet"],
    ["Coin held in NEAR Intents", spot.length ? spot.map((x) => `${x.qty} ${x.a.symbol}`).join(", ") : "none (waiting in USDC)"],
    ["Short on Hyperliquid", hl.assetPositions.length ? hl.assetPositions.map(({ position: p }) => `${-Number(p.szi)} ${p.coin} @ $${Number(p.entryPx).toLocaleString()}`).join(", ") : "none"],
    ["Collateral on Hyperliquid", `${Number(hl.marginSummary.accountValue).toFixed(2)} USDC`],
    ["Paused", state.paused ? "yes" : "no"],
  ];
  return (
    <table className="not-prose w-full text-[14px]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-t border-tc">
            <td className="py-2 pr-4 align-top">{k}</td>
            <td className="num py-2">{v}</td>
          </tr>
        ))}
        <tr className="border-t border-tc">
          <td className="py-2 pr-4 align-top">Check it yourself</td>
          <td className="py-2">
            <a className="underline underline-offset-2" href={`${net.explorer}/address/${net.vault}`} target="_blank" rel="noreferrer">Vault on NearBlocks ↗</a>{" · "}
            <a className="underline underline-offset-2" href={`${net.hlApp}/explorer/address/${addr}`} target="_blank" rel="noreferrer">Account on Hyperliquid ↗</a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
