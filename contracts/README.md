# contracts

NEAR contracts in Rust (near-sdk 5), one Cargo workspace.

| Crate | What | Deployed at |
|---|---|---|
| [`vault`](vault) | The NullPoint vault: shares, fees, deposits and withdrawals, 1Click quote verification, MPC signing of every payload, report checks, the AI decision log | `vault.nullpoint.near`, `vault.nullpoint.testnet` |
| [`mock-verifier`](mock-verifier) | Testnet stand-in for `intents.near` with the same interface and real ERC-191 signature checks (NEAR Intents has no testnet) | `verifier.nullpoint.testnet` |
| [`mock-ft`](mock-ft) | Testnet USDC with an open `mint` | `usdc.nullpoint.testnet` |

## Test

```bash
cd contracts
cargo test                        # everything
cargo test -p vault --lib         # 25 unit tests: real mainnet 1Click quotes, a real MPC signature, fees, report checks
cargo test -p vault --test integration   # 2 tests on a local NEAR sandbox: deposit, sweep, report, withdraw, cap, pause
```

Requires Rust (pinned in `rust-toolchain.toml`) and `cargo-near`. The integration tests build the three contracts and start a sandbox themselves.

## Build and deploy

```bash
cd contracts/vault
cargo near build reproducible-wasm   # Docker; prints the code hash NearBlocks verifies against
```

Deploying, including the step-by-step mainnet script and source verification: [docs → Deploy and verify](../apps/docs/content/docs/deploy.mdx). Method and parameter reference: [docs → Contract reference](../apps/docs/content/docs/contract.mdx).

## Key files in `vault/src`

| File | What |
|---|---|
| `lib.rs` | State, all methods, fee and report logic |
| `quote.rs` | 1Click quote parsing and ed25519 verification |
| `util.rs` | Hex, ISO time, Intents nonces, ERC-191 and Hyperliquid EIP-712 (`approveAgent`, `sendAsset`) digests |
| `tests.rs` | Unit tests; fixtures in `vault/testdata` are real 1Click quotes |
