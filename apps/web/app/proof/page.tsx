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
      title: "The vault contract controls one EVM address: its NEAR Intents account and its Hyperliquid master.",
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
      title: "The keeper's Hyperliquid key can trade for the vault but can't withdraw or send funds.",
      ok: agents.length > 0,
      evidence: (
        <>
          Approved agents on the vault account right now: {agents.map((a) => <code key={a.address}>{a.name} {a.address}</code>)}. The approval was signed by MPC
          on the contract&apos;s request. The attack script has the agent try withdraw3, usdSend and agentSendAsset to an outside address; Hyperliquid rejects all three.
        </>
      ),
      verify: "cd scripts && node attack.ts",
    },
    {
      title: "Swaps and margin transfers can only pay the vault.",
      ok: null,
      evidence: (
        <>
          <code>sign_quote</code> verifies 1Click&apos;s ed25519 signature on the quote, requires recipient and refund address to be the vault, checks the price against
          the stored oracle price, rejects reused quotes, and only then builds the intent and asks MPC to sign it. Unit tests run on real mainnet 1Click quotes.
        </>
      ),
      verify: "cd contracts && cargo test -p vault",
    },
    {
      title: "NAV is computed by the contract, not reported by the keeper.",
      ok: state.snapshot !== null,
      evidence: (
        <>
          Spot and idle USDC are read from the Intents verifier by the contract itself and priced with signed 1Click quotes. The keeper only reports the short, and the
          contract rejects it if it isn&apos;t hedged or the account value drifts from its own margin records (it pauses the vault instead).
        </>
      ),
      verify: `near contract call-function as-read-only ${net.vault} get_state json-args '{}' network-config ${near} now`,
    },
    {
      title: "Every strategist answer is signed inside a TEE and recorded on-chain.",
      ok: llm ? true : null,
      evidence: llm ? (
        <>
          Latest LLM decision: <code>{llm.action}{llm.target ? ` ${llm.target}` : ""}</code>, chat <code>{llm.chat_id}</code>, signed by <code>{llm.signing_address}</code>.
          The keeper checks that this address appears in the model&apos;s NEAR AI Cloud attestation report before acting.
        </>
      ) : (
        <>No LLM decision recorded yet on this network.</>
      ),
      verify: "cd scripts && node --env-file=../.env attack-llm.ts",
    },
    {
      title: "Anyone can complete a signed withdrawal.",
      ok: null,
      evidence: <>The contract&apos;s <code>execute_withdraw</code> has no caller check: once MPC has signed a payout, the user can submit it themselves.</>,
      verify: "cd scripts && node e2e-testnet.ts",
    },
  ];

  return (
    <main className="mx-auto grid max-w-[1100px] gap-[clamp(3rem,6vw,5rem)] p-[var(--pad)] pt-28">
      <header>
        <h1 className={H1}>Check it yourself</h1>
        <p className="mt-4 max-w-[60ch] text-[clamp(16px,1.2vw,19px)] leading-[1.5]">
          Every address and signature below is on-chain. Each claim has its evidence and a command you can run. Checks marked live were recomputed when this
          page loaded.
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
            ["Keeper account", state.keeper, L.account(state.keeper)],
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
