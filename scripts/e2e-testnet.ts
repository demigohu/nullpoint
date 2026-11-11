// Testnet end-to-end: deposit -> sweep into the vault's Intents account -> NAV -> withdraw via an
// MPC-signed intent executed by the (mock) verifier -> USDC back to the user.
//   node e2e-testnet.ts
import { view } from "@nullpoint/core";
import { mustCall } from "@nullpoint/core/node";

const OWNER = process.env.OWNER ?? "nullpoint.testnet";
const USER = OWNER; // the owner doubles as a depositor here
const [USDC, VAULT, VERIFIER, KEEPER] = ["usdc", "vault", "verifier", "keeper"].map((p) => `${p}.${OWNER}`);
const N = "testnet";

const step = (name: string) => console.log(`\n## ${name}`);
const usdc = (a: string) => view<string>(N, USDC, "ft_balance_of", { account_id: a });

const state = await view(N, VAULT, "get_state");
const vaultAddress: string = state.config.vault_address;

step("register vault + verifier on mUSDC, top up user");
for (const a of [VAULT, VERIFIER]) await mustCall(OWNER, USDC, "mint", { account_id: a, amount: "0" }, { gas: 30 });
if (BigInt(await usdc(USER)) < 10_000_000n) await mustCall(OWNER, USDC, "mint", { account_id: USER, amount: "100000000" }, { gas: 30 });

step("deposit 10 mUSDC");
const before = BigInt(await usdc(USER));
let r = await mustCall(USER, USDC, "ft_transfer_call", { receiver_id: VAULT, amount: "10000000", msg: "" }, { deposit: "1 yoctoNEAR" });
console.log("tx", r.tx, "| shares:", await view(N, VAULT, "get_shares", { account_id: USER }));

step("sweep into the vault's Intents account");
r = await mustCall(USER, VAULT, "sweep", {}, { gas: 150 });
console.log("tx", r.tx, "| verifier balance of", vaultAddress, "=", await view(N, VERIFIER, "mt_balance_of", { account_id: vaultAddress, token_id: `nep141:${USDC}` }));

step("keeper: report position (none) -> NAV snapshot");
r = await mustCall(KEEPER, VAULT, "report_position", { positions: [], account_value: "0" }, { legacy: true });
const s = await view(N, VAULT, "get_state");
console.log("tx", r.tx, "| snapshot", JSON.stringify(s.snapshot), "| paused", s.paused);

step("request withdraw 4 shares -> keeper fulfills (MPC signs ft_withdraw intent)");
const shares = BigInt(await view<string>(N, VAULT, "get_shares", { account_id: USER }));
const take = shares < 4_000_000n ? shares : 4_000_000n;
await mustCall(USER, VAULT, "request_withdraw", { shares: take.toString() });
const { withdrawal_count } = await view(N, VAULT, "get_state");
const id = withdrawal_count - 1;
const salt = await view<string>(N, VERIFIER, "current_salt");
r = await mustCall(KEEPER, VAULT, "fulfill_withdraw", { id, salt_hex: salt }, { gas: 300, legacy: true });
const [[, w]] = await view(N, VAULT, "get_withdrawals", { from: String(id), limit: 1 });
const [[, signed]] = await view(N, VAULT, "get_signed", { from: String(w.signed_id), limit: 1 });
console.log("tx", r.tx, "| withdrawal", JSON.stringify(w), "\n  signed payload", signed.payload, "\n  MPC signature", signed.signature);

step("execute withdraw (anyone can call)");
r = await mustCall(USER, VAULT, "execute_withdraw", { id }, { gas: 200 });
const [[, done]] = await view(N, VAULT, "get_withdrawals", { from: String(id), limit: 1 });
const after = BigInt(await usdc(USER));
console.log("tx", r.tx, "| status", done.status, "| user mUSDC change since deposit:", Number(after - before) / 1e6);
if (done.status !== "done") throw new Error("withdrawal did not execute");
console.log("\nE2E OK");
