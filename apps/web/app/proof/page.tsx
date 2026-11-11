import { deriveEvmAddress, hlInfo } from "@nullpoint/core";
import { describeSigned } from "@/lib/activity";
import { links } from "@/lib/config";
import { currentNet, vaultOverview } from "@/lib/data";

const H1 = "wdth-118 text-[clamp(2.2rem,4.6vw,5.4rem)] font-extrabold leading-[0.9] tracking-[-0.045em]";

export default async function Proof() {
  const net = await currentNet();
  const ov = await vaultOverview(net).catch(() => null);
  if (!ov) {
    return (
      <main className="p-[var(--pad)] pt-28">
        <h1 className={H1}>Check it yourself</h1>
        <p className="mt-4">The {net.network} vault isn&apos;t live yet. Switch to testnet in the top bar.</p>
      </main>
    );
  }
  const { state, decisions, signed } = ov;
  const L = links(net);
  const addr = state.config.vault_address;
  const derived = deriveEvmAddress(net.network, net.vault, state.config.mpc_path);
  const agents = await hlInfo<{ name: string; address: string }[]>(net.hlChain, { type: "extraAgents", user: addr }).catch(() => []);
  const llm = decisions.filter((d) => d.source === "llm").at(-1);
  const near = net.network === "mainnet" ? "mainnet" : "testnet";

  const claims: { title: string; ok: boolean | null; evidence: React.ReactNode; verify: string }[] = [
    {
      title: "The contract owns one Ethereum-style address, and that address owns both the Intents account and the Hyperliquid account.",
      ok: derived === addr,
      evidence: (
        <>
          Recomputed now from the {state.config.mpc} root key for <code>{net.vault}</code> / <code>{state.config.mpc_path}</code>: <code>{derived}</code>.
          The contract&apos;s configured address is <code>{addr}</code>.
        </>
      ),
      verify: `near contract call-function as-read-only ${state.config.mpc} derived_public_key json-args '{"path":"${state.config.mpc_path}","predecessor":"${net.vault}","domain_id":0}' network-config ${near} now`,
    },
    {
      title: "The agent's Hyperliquid key can trade for the vault. It can't withdraw or send money anywhere.",
      ok: agents.length > 0,
      evidence: (
        <>
          Agents approved on the vault&apos;s account right now: {agents.map((a) => <code key={a.address}>{a.name} {a.address}</code>)}. The contract asked NEAR&apos;s
          signers to sign that approval. The attack script then uses the agent key to try withdraw3, usdSend and agentSendAsset to an outside address, and Hyperliquid
          refuses all three.
        </>
      ),
      verify: "cd scripts && node attack.ts",
    },
    {
      title: "Swaps and collateral moves can only ever pay the vault.",
      ok: null,
      evidence: (
        <>
          Before it asks NEAR&apos;s signers for anything, <code>sign_quote</code> checks 1Click&apos;s ed25519 signature on the quote, requires the vault as both
          recipient and refund address, compares the price with its stored oracle price, and refuses a quote it has seen before. Only then does it build the intent
          itself. The unit tests run on real mainnet 1Click quotes.
        </>
      ),
      verify: "cd contracts && cargo test -p vault",
    },
    {
      title: "The contract prices the vault itself. The agent can't make the number up.",
      ok: state.snapshot !== null,
      evidence: (
        <>
          The contract reads the coins and idle USDC straight from the Intents contract and prices them with signed 1Click quotes. The agent only reports the
          Hyperliquid side. If that report is unhedged, or more than 1% away from what the contract expects, the contract rejects it and pauses the vault.
        </>
      ),
      verify: `near contract call-function as-read-only ${net.vault} get_state json-args '{}' network-config ${near} now`,
    },
    {
      title: "Every AI decision is signed inside an enclave and stored on-chain.",
      ok: llm ? true : null,
      evidence: llm ? (
        <>
          Latest AI decision: <code>{llm.action}{llm.target ? ` ${llm.target}` : ""}</code>, chat <code>{llm.chat_id}</code>, signed by <code>{llm.signing_address}</code>.
          Before acting on it, the agent checks that this address is in the model&apos;s NEAR AI Cloud attestation report.
        </>
      ) : (
        <>No AI decision recorded on this network yet.</>
      ),
      verify: "cd scripts && node --env-file=../.env attack-llm.ts",
    },
    {
      title: "Anyone can finish a signed withdrawal, and it can only pay the person who asked.",
      ok: null,
      evidence: <>The contract&apos;s <code>execute_withdraw</code> doesn&apos;t care who calls it. Once NEAR&apos;s signers have signed a payout, the user can submit it without waiting for the agent.</>,
      verify: "cd scripts && node e2e-testnet.ts",
    },
  ];

  return (
    <main className="mx-auto grid max-w-[1100px] gap-[clamp(3rem,6vw,5rem)] p-[var(--pad)] pt-28">
      <header>
        <h1 className={H1}>Check it yourself</h1>
        <p className="mt-4 max-w-[60ch] text-[clamp(16px,1.2vw,19px)] leading-[1.5]">
          Six claims about who can move the money, each with its evidence and a command you can run yourself. The ones marked live were checked again when
          this page loaded.
        </p>
      </header>

      <ol className="grid gap-[var(--pad)]">
        {claims.map((c, i) => (
          <li key={c.title} className="panel min-w-0 p-[var(--pad)]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">0{i + 1}</span>
              {c.ok !== null && <span className={`font-mono text-[11px] uppercase tracking-[0.2em] ${c.ok ? "" : "text-alarm"}`}>{c.ok ? "live check passed" : "live check failed"}</span>}
            </div>
            <h2 className="wdth-110 mt-3 text-[clamp(1.2rem,1.7vw,1.7rem)] font-bold leading-tight tracking-[-0.03em]">{c.title}</h2>
            <p className="mt-3 text-[15px] leading-[1.55] [&_code]:num [&_code]:break-all [&_code]:font-bold">{c.evidence}</p>
            <pre className="num mt-4 overflow-x-auto overscroll-x-contain bg-tc px-3 py-2 text-[12px] text-fc">{c.verify}</pre>
          </li>
        ))}
      </ol>

      <section>
        <h2 className="chip">Addresses</h2>
        <dl className="num mt-4 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-[auto_1fr]">
          {[
            ["Vault contract", net.vault, L.account(net.vault)],
            ["Vault's MPC address (owns the Hyperliquid and Intents accounts)", addr, L.hlAddress(addr)],
            ["Agent account (NEAR)", state.keeper, L.account(state.keeper)],
            ["Intents verifier", state.config.verifier, L.account(state.config.verifier)],
            ["MPC signer", state.config.mpc, L.account(state.config.mpc)],
          ].map(([k, v, href]) => (
            <div key={k} className="contents">
              <dt className="font-sans">{k}</dt>
              <dd className="break-all">
                <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{v} ↗</a>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="chip">Latest signatures from NEAR&apos;s MPC network</h2>
        <p className="mt-3 text-[14px]">The exact payload the contract built, and the digest MPC signed.</p>
        <ul className="mt-4 grid gap-[var(--pad)]">
          {signed.slice(-4).reverse().map((s) => (
            <li key={s.id} className="border-t border-tc pt-3">
              <details>
                <summary className="cursor-pointer text-[15px]">{describeSigned(s, state.config.usdc_token_id).text}</summary>
                <pre className="num mt-2 max-h-40 overflow-auto overscroll-contain whitespace-pre-wrap break-all text-[12px]">{s.payload}</pre>
                <p className="num mt-2 break-all text-[12px]">digest {s.digest}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {net.network === "testnet" && (
        <p className="text-[13px] leading-[1.5]">
          Testnet stand-ins: <code className="num">{net.verifier}</code> mimics intents.near with real ERC-191 signature checks, and swaps are filled by a mock 1Click whose
          ed25519 key the testnet vault trusts. The MPC network and Hyperliquid testnet are real.
        </p>
      )}
    </main>
  );
}
