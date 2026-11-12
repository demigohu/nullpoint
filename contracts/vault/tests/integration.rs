// Integration test on a local NEAR sandbox: the real vault, mock USDC and the mock Intents verifier
// deployed side by side. Covers what unit tests can't: ft_transfer_call refunds, the sweep into the
// Intents account, access control across accounts. Signing (MPC) isn't available in the sandbox;
// that path is covered by unit tests and the testnet e2e (scripts/e2e-testnet.ts).
//   cd contracts && cargo test -p vault --test integration
use near_api::{AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;

const VAULT_ADDRESS: &str = "0x55c7c56049847f23540209b7dbd401bf242b5908";
const ONECLICK_PUBKEY: &str = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

struct Env {
    net: NetworkConfig,
    signer: Arc<Signer>,
    owner: AccountId,
    alice: AccountId,
    usdc: Contract,
    vault: Contract,
    verifier: Contract,
}

fn wasm(crate_dir: &str) -> Vec<u8> {
    let manifest = format!("{}/../{crate_dir}/Cargo.toml", env!("CARGO_MANIFEST_DIR"));
    let path = cargo_near_build::build_with_cli(cargo_near_build::BuildOpts {
        manifest_path: Some(manifest.into()),
        ..Default::default()
    })
    .expect("cargo near build");
    std::fs::read(path).unwrap()
}

impl Env {
    async fn call(&self, contract: &Contract, method: &str, args: Value, from: &AccountId, deposit: u128) -> bool {
        contract
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(300))
            .deposit(NearToken::from_yoctonear(deposit))
            .with_signer(from.clone(), self.signer.clone())
            .send_to(&self.net)
            .await
            .unwrap()
            .into_result()
            .is_ok()
    }

    async fn view<T: near_sdk::serde::de::DeserializeOwned + Send + Sync>(&self, contract: &Contract, method: &str, args: Value) -> T {
        contract.call_function(method, args).read_only().fetch_from(&self.net).await.unwrap().data
    }

    async fn usdc_of(&self, who: &AccountId) -> u128 {
        let v: String = self.view(&self.usdc, "ft_balance_of", json!({ "account_id": who })).await;
        v.parse().unwrap()
    }

    async fn deposit(&self, amount: u128) -> bool {
        self.call(&self.usdc, "ft_transfer_call", json!({ "receiver_id": self.vault.account_id(), "amount": amount.to_string(), "msg": "" }), &self.alice, 1).await
    }
}

async fn deploy(net: &NetworkConfig, signer: &Arc<Signer>, account: &str, code: Vec<u8>, init: &str, args: Value) {
    Contract::deploy(account.parse().unwrap())
        .use_code(code)
        .with_init_call(init, args)
        .unwrap()
        .with_signer(signer.clone())
        .send_to(net)
        .await
        .unwrap()
        .assert_success();
}

async fn setup(max_tvl: u128) -> (near_sandbox::Sandbox, Env) {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await.unwrap();
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse().unwrap());
    let signer = Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse().unwrap()).unwrap();
    let id = |n: &str| -> AccountId { n.parse().unwrap() };
    for name in ["owner.sandbox", "alice.sandbox", "usdc.sandbox", "vault.sandbox", "verifier.sandbox"] {
        let sandbox_id: near_sdk::AccountId = name.parse().unwrap(); // near-sandbox uses near-sdk's AccountId version
        sandbox.create_account(sandbox_id).initial_balance(NearToken::from_near(50)).send().await.unwrap();
    }
    let (owner, alice) = (id("owner.sandbox"), id("alice.sandbox"));
    deploy(&net, &signer, "usdc.sandbox", wasm("mock-ft"), "new", json!({ "symbol": "mUSDC", "decimals": 6 })).await;
    deploy(&net, &signer, "verifier.sandbox", wasm("mock-verifier"), "new", json!({ "owner": owner })).await;
    deploy(
        &net,
        &signer,
        "vault.sandbox",
        wasm("vault"),
        "new",
        json!({
            "owner": owner,
            "agent": owner,
            "config": {
                "usdc": "usdc.sandbox",
                "usdc_token_id": "nep141:usdc.sandbox",
                "hl_usdc_asset": "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054",
                "hl_token": "USDC:0xeb62eee3685fc4c43992febcd9e75443",
                "hl_chain": "Testnet",
                "hl_signature_chain_id": 421614,
                "verifier": "verifier.sandbox",
                "mpc": "v1.signer-prod.testnet",
                "mpc_path": "hl-master",
                "vault_address": VAULT_ADDRESS,
                "oneclick_pubkey": ONECLICK_PUBKEY
            },
            "params": {
                "max_tvl": max_tvl.to_string(),
                "max_swap_usdc": "100000000",
                "max_slippage_bps": 150,
                "margin_slippage_bps": 300,
                "hedge_band_bps": 200,
                "max_report_drift_bps": 100,
                "dust_usdc": "500000",
                "max_price_age_s": 120,
                "max_nav_age_s": 600,
                "nav_history_interval_s": 600
            },
            "assets": [["BTC", "nep141:nbtc.bridge.near"], ["ETH", "nep141:eth.bridge.near"], ["NEAR", "nep141:wrap.near"]]
        }),
    )
    .await;
    let env = Env {
        usdc: Contract(id("usdc.sandbox")),
        vault: Contract(id("vault.sandbox")),
        verifier: Contract(id("verifier.sandbox")),
        net,
        signer,
        owner,
        alice,
    };
    // Register the contracts on mock USDC and fund alice (mint registers the account).
    for who in [env.vault.account_id().clone(), env.verifier.account_id().clone()] {
        assert!(env.call(&env.usdc, "mint", json!({ "account_id": who, "amount": "0" }), &env.owner, 0).await);
    }
    assert!(env.call(&env.usdc, "mint", json!({ "account_id": env.alice, "amount": "100000000" }), &env.owner, 0).await);
    (sandbox, env)
}

#[tokio::test]
async fn deposit_sweep_report_withdraw() {
    let (_sandbox, e) = setup(1_000_000_000).await;

    // First deposit mints 1:1 and records the cost basis.
    assert!(e.deposit(10_000_000).await);
    let h: Value = e.view(&e.vault, "get_holding", json!({ "account_id": e.alice })).await;
    assert_eq!(h["shares"], "10000000");
    assert_eq!(h["deposited"], "10000000");
    assert_eq!(e.usdc_of(&e.alice).await, 90_000_000);

    // Sweep moves it into the vault's own Intents account on the verifier.
    assert!(e.call(&e.vault, "sweep", json!({}), &e.alice, 0).await);
    let bal: String = e.view(&e.verifier, "mt_balance_of", json!({ "account_id": VAULT_ADDRESS, "token_id": "nep141:usdc.sandbox" })).await;
    assert_eq!(bal, "10000000");

    // Only the agent may report; the report sets the NAV from balances the contract reads itself.
    assert!(!e.call(&e.vault, "report_position", json!({ "positions": [], "account_value": "0" }), &e.alice, 0).await);
    assert!(e.call(&e.vault, "report_position", json!({ "positions": [], "account_value": "0" }), &e.owner, 0).await);
    let state: Value = e.view(&e.vault, "get_state", json!({})).await;
    assert_eq!(state["snapshot"]["nav"], "10000000");
    assert_eq!(state["paused"], false);

    // A second deposit is priced off that NAV.
    assert!(e.deposit(5_000_000).await);
    let shares: String = e.view(&e.vault, "get_shares", json!({ "account_id": e.alice })).await;
    assert_eq!(shares, "15000000");

    // Withdrawal request: shares leave at once, and the cost basis shrinks pro rata.
    assert!(e.call(&e.vault, "request_withdraw", json!({ "shares": "6000000" }), &e.alice, 0).await);
    let h: Value = e.view(&e.vault, "get_holding", json!({ "account_id": e.alice })).await;
    assert_eq!(h["shares"], "9000000");
    assert_eq!(h["deposited"], "9000000");
    let w: Vec<(u64, Value)> = e.view(&e.vault, "get_withdrawals", json!({ "from": "0", "limit": 10 })).await;
    assert_eq!(w[0].1["status"], "queued");

    // Signing a payout is the agent's job alone.
    assert!(!e.call(&e.vault, "fulfill_withdraw", json!({ "id": 0, "salt_hex": "00000000" }), &e.alice, 0).await);
}

#[tokio::test]
async fn cap_and_pause_refund_the_deposit() {
    let (_sandbox, e) = setup(12_000_000).await;
    assert!(e.deposit(10_000_000).await);
    assert!(e.call(&e.vault, "report_position", json!({ "positions": [], "account_value": "0" }), &e.owner, 0).await);

    // Over the TVL cap: the vault refuses, and the token contract hands the USDC back.
    e.deposit(5_000_000).await;
    assert_eq!(e.usdc_of(&e.alice).await, 90_000_000);

    // Paused by the owner (and only the owner): deposits are refused the same way.
    assert!(!e.call(&e.vault, "set_paused", json!({ "paused": true }), &e.alice, 0).await);
    assert!(e.call(&e.vault, "set_paused", json!({ "paused": true }), &e.owner, 0).await);
    e.deposit(1_000_000).await;
    assert_eq!(e.usdc_of(&e.alice).await, 90_000_000);
    let shares: String = e.view(&e.vault, "get_shares", json!({ "account_id": e.alice })).await;
    assert_eq!(shares, "10000000");
}
