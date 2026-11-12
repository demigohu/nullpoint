import { deriveEvmAddress } from "@nullpoint/core";
import { Doc } from "@/components/doc";
import { NETS, readVault } from "@/lib/vault";

export const metadata = { title: "Verify it live" };
export const dynamic = "force-dynamic";

type Claim = { plain: string; detail: string; ok: boolean | null; evidence: React.ReactNode; command: string };

export default async function Verify({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const net = (await searchParams).network === "mainnet" ? NETS.mainnet : NETS.testnet;
  if (!net.deployed) {
    return (
      <Doc title="Verify it live" lede="The mainnet vault isn't live yet. The testnet checks below run against the running testnet vault.">
        <p><a href="/verify">Open the testnet checks</a></p>
      </Doc>
    );
  }
  const { state, decisions, signed, agents } = await readVault(net);
  const addr = state.config.vault_address;
  const derived = deriveEvmAddress(net.network, net.vault, state.config.mpc_path);
  const ai = decisions.filter((d) => d.source === "llm").at(-1);
  const near = net.network;
  const hl = `${net.hlApp}/explorer/address/${addr}`;

  const claims: Claim[] = [
    {
      plain: "The contract, not a person, owns the vault's accounts.",
      detail: "One Ethereum-style address, derived from the contract through NEAR Chain Signatures, is both the Intents account and the Hyperliquid account.",
      ok: derived.toLowerCase() === addr.toLowerCase(),
      evidence: <>Recomputed now from <code>{state.config.mpc}</code> for <code>{net.vault}</code> / <code>{state.config.mpc_path}</code>: <code>{derived}</code>. The contract&apos;s configured address: <code>{addr}</code>.</>,
      command: `near contract call-function as-read-only ${state.config.mpc} derived_public_key json-args '{"path":"${state.config.mpc_path}","predecessor":"${net.vault}","domain_id":0}' network-config ${near} now`,
    },
    {
      plain: "The agent can trade, and it can't withdraw.",
      detail: "Its Hyperliquid key is an approved agent on the vault's account. Hyperliquid refuses withdrawals and transfers signed by an agent key.",
      ok: agents.length > 0,
      evidence: <>Agents approved on the vault&apos;s Hyperliquid account right now: {agents.length ? agents.map((a) => <code key={a.address}>{a.name} {a.address} </code>) : "none"}. The attack script uses this key to try withdraw3, usdSend and agentSendAsset to an outside address; all three are refused.</>,
      command: "npm run attack",
    },
    {
      plain: "Swaps can only ever pay the vault.",
      detail: "sign_quote checks 1Click's signature, that the vault is recipient and refund address, the price and the cap, then builds the intent itself.",
      ok: null,
      evidence: <>The unit tests run against real mainnet 1Click quotes, including a forged one that pays an attacker.</>,
      command: "cd contracts && cargo test -p vault",
    },
    {
      plain: "The contract prices the vault itself.",
      detail: "Coin and USDC balances come straight from the Intents contract, priced with signed quotes. The agent reports only the Hyperliquid side, within 1%.",
      ok: state.snapshot !== null,
      evidence: <>Latest share-price snapshot: {state.snapshot ? <>NAV <code>{(Number(state.snapshot.nav) / 1e6).toFixed(2)} USDC</code> at {new Date(state.snapshot.ms).toLocaleString()}</> : "none yet"}.</>,
      command: `near contract call-function as-read-only ${net.vault} get_state json-args '{}' network-config ${near} now`,
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
    <Doc
      title="Verify it live"
      lede={`Six claims about who can move the money. Each one is checked against the ${net.network} chain when this page loads, or comes with a command you can run yourself.`}
    >
      <ol className="!m-0 grid !gap-[var(--pad)] pt-6">
        {claims.map((c, i) => (
          <li key={c.plain} className="panel !p-[var(--pad)] before:!content-none">
            <div className="flex flex-wrap items-center gap-3">
              <span className={c.ok === false ? "bg-alarm px-2 py-1 font-mono text-[12px] text-fc" : "chip"}>
                {c.ok === null ? "check with the command" : c.ok ? "checked live: true" : "checked live: FALSE"}
              </span>
              <span className="font-mono text-[12px]">0{i + 1}</span>
            </div>
            <h2 className="!mt-4 !mb-2">{c.plain}</h2>
            <p>{c.detail}</p>
            <details className="mt-4 border-t border-tc pt-3">
              <summary className="cursor-pointer font-mono text-[12px] uppercase tracking-[0.15em]">Evidence and command</summary>
              <p className="mt-3 break-words">{c.evidence}</p>
              <pre>{c.command}</pre>
            </details>
          </li>
        ))}
      </ol>

      <h2>Addresses</h2>
      <table>
        <tbody>
          {[
            ["Vault contract", net.vault, `${net.explorer}/address/${net.vault}`],
            ["The vault's address (Intents + Hyperliquid)", addr, hl],
            ["Agent account", state.agent, `${net.explorer}/address/${state.agent}`],
            ["Intents contract", state.config.verifier, `${net.explorer}/address/${state.config.verifier}`],
            ["MPC signer", state.config.mpc, `${net.explorer}/address/${state.config.mpc}`],
          ].map(([k, v, href]) => (
            <tr key={k}>
              <td>{k}</td>
              <td><a href={href} target="_blank" rel="noreferrer"><code>{v}</code> ↗</a></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Latest signatures</h2>
      <p>The exact payloads the contract built and asked NEAR&apos;s signers to sign. The dashboard in the app has the full history.</p>
      {signed.slice().reverse().map((s) => (
        <details key={s.id} className="border-t border-tc py-3">
          <summary className="cursor-pointer"><code>#{s.id} {s.kind}</code> · {new Date(s.ms).toLocaleString()}</summary>
          <pre>{(() => { try { return JSON.stringify(JSON.parse(s.payload), null, 2); } catch { return s.payload; } })()}</pre>
          <p><code>digest {s.digest}</code></p>
        </details>
      ))}

      {net.network === "testnet" && (
        <p className="mt-8">
          On testnet, <code>{state.config.verifier}</code> stands in for <code>intents.near</code> with the same interface and real ERC-191 signature checks, and swaps
          are filled by a mock 1Click whose signing key the testnet vault trusts. NEAR&apos;s MPC network and Hyperliquid testnet are the real ones.
        </p>
      )}
    </Doc>
  );
}
