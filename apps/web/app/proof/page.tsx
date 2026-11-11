import { CheckCircle, XCircle } from "@phosphor-icons/react/dist/ssr";
import { deriveEvmAddress, hlInfo } from "@nullpoint/core";
import { links } from "@/lib/config";
import { currentNet, vaultOverview } from "@/lib/data";

export default async function Proof() {
  const net = await currentNet();
  const ov = await vaultOverview(net).catch(() => null);
  if (!ov) {
    return (
      <main className="mx-auto max-w-5xl px-4 pt-12 md:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Proof</h1>
        <p className="mt-4 text-text-2">The {net.network} vault isn&apos;t live yet. Switch to testnet in the top bar.</p>
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
    <main className="mx-auto max-w-5xl px-4 pt-12 md:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Proof</h1>
      <p className="mt-2 max-w-[62ch] text-text-2">Each claim, the evidence for it, and a command to check it yourself. Checks marked live were recomputed when this page loaded.</p>

      <ol className="mt-10 grid grid-cols-1 gap-4">
        {claims.map((c) => (
          <li key={c.title} className="min-w-0 rounded-panel border border-line bg-surface p-5">
            <div className="flex items-start gap-3">
              {c.ok === null ? (
                <CheckCircle size={22} className="mt-0.5 shrink-0 text-text-3" />
              ) : c.ok ? (
                <CheckCircle size={22} weight="fill" className="mt-0.5 shrink-0 text-accent" />
              ) : (
                <XCircle size={22} weight="fill" className="mt-0.5 shrink-0 text-danger" />
              )}
              <div className="min-w-0">
                <h2 className="font-medium">
                  {c.title}
                  {c.ok !== null && <span className="ml-2 text-xs font-normal text-text-3">{c.ok ? "live check passed" : "live check failed"}</span>}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-text-2 [&_code]:num [&_code]:break-all [&_code]:text-text">{c.evidence}</p>
                <pre className="num mt-3 overflow-x-auto rounded-control bg-bg px-3 py-2 text-xs text-text-2">{c.verify}</pre>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">Addresses</h2>
        <dl className="num mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
          {[
            ["Vault contract", net.vault, L.account(net.vault)],
            ["Keeper", state.keeper, L.account(state.keeper)],
            ["Vault EVM address", addr, L.hlAddress(addr)],
            ["Intents verifier", state.config.verifier, L.account(state.config.verifier)],
            ["MPC signer", state.config.mpc, L.account(state.config.mpc)],
          ].map(([k, v, href]) => (
            <div key={k} className="contents">
              <dt className="font-sans text-text-3">{k}</dt>
              <dd className="break-all">
                <a href={href} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{v}</a>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">Latest MPC signatures</h2>
        <p className="mt-1 text-sm text-text-3">The exact payload the contract built, and the digest MPC signed.</p>
        <ul className="mt-4 grid gap-3">
          {signed.slice(-4).reverse().map((s) => (
            <li key={s.id} className="rounded-panel border border-line bg-surface p-4">
              <p className="text-sm font-medium">{s.kind}</p>
              <pre className="num mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all text-xs text-text-2">{s.payload}</pre>
              <p className="num mt-2 break-all text-xs text-text-3">digest {s.digest}</p>
            </li>
          ))}
        </ul>
      </section>

      {net.network === "testnet" && (
        <p className="mt-12 text-sm text-text-3">
          Testnet stand-ins: <code className="num">{net.verifier}</code> mimics intents.near with real ERC-191 signature checks, and swaps are filled by a mock 1Click whose
          ed25519 key the testnet vault trusts. The MPC network and Hyperliquid testnet are real.
        </p>
      )}
    </main>
  );
}
