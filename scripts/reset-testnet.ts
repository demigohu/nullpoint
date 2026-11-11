// Fresh testnet state for a clean demo: same accounts and the same vault EVM address.
//   1. close every Hyperliquid position on the vault's master (agent) and fold spot USDC into perp
//   2. delete + redeploy the vault and the mock verifier (fresh state, fresh salt)
//   3. register both on mock USDC
//   4. sweep the master's leftover USDC to the mock 1Click solver *through the new vault*
//      (verified quote -> MPC-signed sendAsset), then zero the vault's margin record
//   node reset-testnet.ts
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { postSignedAction, signedMessage, view } from "@nullpoint/core";
import { mustCall } from "@nullpoint/core/node";
import * as oneclick from "../apps/keeper/src/mock1click.ts";

const OWNER = process.env.OWNER ?? "nullpoint.testnet";
const [VAULT, VERIFIER, USDC, KEEPER] = ["vault", "verifier", "usdc", "keeper"].map((p) => `${p}.${OWNER}`);
const agent = privateKeyToAccount(JSON.parse(readFileSync(new URL("../.keys/hl-agent.json", import.meta.url), "utf8")).privateKey);
const transport = new HttpTransport({ isTestnet: true });
const info = new InfoClient({ transport });
const exchange = new ExchangeClient({ transport, wallet: agent });
const step = (s: string) => console.log(`\n## ${s}`);

const { config } = await view("testnet", VAULT, "get_state");
const master: string = config.vault_address;

const ONLY_SWEEP = process.env.ONLY_SWEEP === "1"; // resume at step 4
if (!ONLY_SWEEP) {
step("1. close positions and fold spot USDC into perp");
const [meta, ctxs] = await info.metaAndAssetCtxs();
for (const { position: p } of (await info.clearinghouseState({ user: master })).assetPositions) {
  const i = meta.universe.findIndex((u) => u.name === p.coin);
  const isBuy = Number(p.szi) < 0;
  const px = Number(ctxs[i]!.markPx) * (isBuy ? 1.02 : 0.98);
  const res = await exchange.order({
    orders: [{ a: i, b: isBuy, p: Number(px.toPrecision(5)).toString(), s: Math.abs(Number(p.szi)).toString(), r: true, t: { limit: { tif: "Ioc" } } }],
    grouping: "na",
  });
  console.log(`closed ${p.coin} ${p.szi}:`, JSON.stringify(res.response.data.statuses));
}
const spot = (await info.spotClearinghouseState({ user: master })).balances.find((b) => b.coin === "USDC");
if (spot && Number(spot.total) > 0) {
  console.log("spot -> perp", spot.total, JSON.stringify(await exchange.agentSendAsset({ destination: master, sourceDex: "spot", destinationDex: "", token: "USDC", amount: spot.total })));
}

step("2. redeploy vault and verifier with fresh state");
for (const a of [VAULT, VERIFIER]) {
  const r = spawnSync("near", ["account", "delete-account", a, "beneficiary", OWNER, "network-config", "testnet", "sign-with-keychain", "send"], { encoding: "utf8" });
  console.log(`deleted ${a}:`, /deleted|successfully/i.test(r.stdout + r.stderr) ? "ok" : (r.stdout + r.stderr).slice(-300));
}
execFileSync("bash", [new URL("deploy-testnet.sh", import.meta.url).pathname], { stdio: "inherit", env: { ...process.env, OWNER } });

step("3. register vault and verifier on mock USDC");
for (const a of [VAULT, VERIFIER]) await mustCall(OWNER, USDC, "mint", { account_id: a, amount: "0" }, { gas: 30 });

}

step("4. sweep leftover Hyperliquid USDC out through the new vault");
const maxUsdc = Number((await view("testnet", VAULT, "get_state")).params.max_swap_usdc) / 1e6;
for (let free = Number((await info.clearinghouseState({ user: master })).withdrawable); free >= 1; free = Number((await info.clearinghouseState({ user: master })).withdrawable)) {
  // The vault caps each transfer at max_swap_usdc, so sweep in chunks.
  const amount = BigInt(Math.floor(Math.min(free - 0.01, maxUsdc - 1) * 1e8)); // Hyperliquid USDC, 8 decimals
  const q = await oneclick.quote({
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: config.hl_usdc_asset, destinationAsset: `nep141:${USDC}`,
    amount: amount.toString(), depositType: "ORIGIN_CHAIN", refundTo: master, refundType: "ORIGIN_CHAIN", recipient: master, recipientType: "INTENTS",
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  const salt = await view<string>("testnet", VERIFIER, "current_salt");
  await mustCall(KEEPER, VAULT, "sign_quote", { message: signedMessage(q), signature: q.signature, salt_hex: salt }, { gas: 300, legacy: true });
  const { signed_count } = await view("testnet", VAULT, "get_state");
  const [[, s]] = await view("testnet", VAULT, "get_signed", { from: String(signed_count - 1), limit: 1 });
  console.log("vault-signed sendAsset ->", JSON.stringify(await postSignedAction("testnet", s.payload, s.signature)));
  await new Promise((r) => setTimeout(r, 2000));
}
// Not credited back to the vault: these funds predate it. Zero the margin record the sweep moved.
await mustCall(OWNER, VAULT, "set_margin_net", { margin_net: "0" }, { gas: 30 });
const after = await info.clearinghouseState({ user: master });
console.log(`\nmaster ${master}: perp ${after.marginSummary.accountValue} USDC, positions ${after.assetPositions.length}`);
console.log("vault state:", JSON.stringify((({ total_shares, margin_net, snapshot }) => ({ total_shares, margin_net, snapshot }))(await view("testnet", VAULT, "get_state"))));
