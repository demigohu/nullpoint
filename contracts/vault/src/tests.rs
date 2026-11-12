use super::*;
use near_sdk::test_utils::{VMContextBuilder, accounts};
use near_sdk::testing_env;

const VAULT: &str = "0x5e33437e5b871f1aa9e252dd00a36c53dfcb9a8d";
const USDC_ID: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SWAP: &str = include_str!("../testdata/swap_usdc_btc.json");
const SWAP_SIG: &str = include_str!("../testdata/swap_usdc_btc.sig");
const PRICE: &str = include_str!("../testdata/price_btc.json");
const PRICE_SIG: &str = include_str!("../testdata/price_btc.sig");

fn usdc() -> AccountId {
    "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1".parse().unwrap()
}

fn quote_ms(msg: &str) -> u64 {
    let v: serde_json::Value = serde_json::from_str(msg).unwrap();
    ms_from_iso(v["timestamp"].as_str().unwrap()).unwrap()
}

fn ctx(predecessor: AccountId, ms: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id("vault.testnet".parse().unwrap())
            .predecessor_account_id(predecessor)
            .block_timestamp(ms * 1_000_000)
            .prepaid_gas(Gas::from_tgas(300))
            .build()
    );
}

fn vault() -> Contract {
    Contract::new(
        accounts(0),
        accounts(1),
        Config {
            usdc: usdc(),
            usdc_token_id: USDC_ID.into(),
            hl_usdc_asset: "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054".into(),
            hl_token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054".into(),
            hl_chain: "Mainnet".into(),
            hl_signature_chain_id: 421614,
            verifier: "intents.near".parse().unwrap(),
            mpc: "v1.signer".parse().unwrap(),
            mpc_path: "hl-master".into(),
            vault_address: VAULT.into(),
            oneclick_pubkey: "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc".into(),
        },
        Params {
            max_tvl: U128(100_000_000),
            max_swap_usdc: U128(25_000_000),
            max_slippage_bps: 150,
            margin_slippage_bps: 300,
            hedge_band_bps: 200,
            max_report_drift_bps: 100,
            dust_usdc: U128(500_000),
            max_price_age_s: 120,
            max_nav_age_s: 600,
            nav_history_interval_s: 600,
            entry_fee_bps: 0,
            exit_fee_bps: 0,
            performance_fee_bps: 0,
            treasury: accounts(5),
        },
        vec![
            ("BTC".into(), "nep141:nbtc.bridge.near".into()),
            ("ETH".into(), "nep141:eth.bridge.near".into()),
        ],
    )
}

/// Vault with the real BTC price fixture reported, at the swap fixture's time.
fn priced_vault() -> Contract {
    let mut v = vault();
    ctx(accounts(1), quote_ms(PRICE) + 1000);
    v.report_prices(vec![SignedQuote { message: PRICE.into(), signature: PRICE_SIG.trim().into() }]);
    ctx(accounts(1), quote_ms(SWAP).max(quote_ms(PRICE)) + 1000);
    v
}

#[test]
fn first_deposit_is_one_to_one_then_priced_by_nav() {
    let mut v = vault();
    ctx(usdc(), 1_000);
    let _ = v.ft_on_transfer(accounts(2), U128(10_000_000), String::new());
    assert_eq!(v.get_shares(accounts(2)).0, 10_000_000);
    // NAV grew 10% (funding): the next depositor gets fewer shares per USDC.
    v.snapshot = Some(Snapshot { nav: U128(11_000_000), ms: 1_000, usdc_in_verifier: U128(0), spot: vec![] });
    let _ = v.ft_on_transfer(accounts(3), U128(11_000_000), String::new());
    assert_eq!(v.get_shares(accounts(3)).0, 10_000_000);
    assert_eq!(v.pending_usdc, 21_000_000);
}

#[test]
#[should_panic(expected = "NAV snapshot stale")]
fn deposit_needs_fresh_nav() {
    let mut v = vault();
    ctx(usdc(), 1_000);
    let _ = v.ft_on_transfer(accounts(2), U128(10_000_000), String::new());
    v.snapshot = Some(Snapshot { nav: U128(10_000_000), ms: 1_000, usdc_in_verifier: U128(0), spot: vec![] });
    ctx(usdc(), 1_000 + 601_000);
    let _ = v.ft_on_transfer(accounts(3), U128(1_000_000), String::new());
}

#[test]
#[should_panic(expected = "only USDC")]
fn deposit_rejects_other_tokens() {
    let mut v = vault();
    ctx(accounts(4), 1_000);
    let _ = v.ft_on_transfer(accounts(2), U128(1), String::new());
}

#[test]
fn reports_real_1click_price() {
    let v = priced_vault();
    let btc = &v.assets[0];
    assert!(btc.price_in.0 > 0 && btc.price_out.0 > 0);
    // 0.001 BTC (100_000 sat) priced somewhere sane in USDC.
    let usd_per_btc = btc.price_out.0 * 100_000_000 / btc.price_in.0 / 1_000_000;
    assert!((10_000..500_000).contains(&usd_per_btc), "BTC price {usd_per_btc}");
}

#[test]
fn signs_verified_swap_quote_once() {
    let mut v = priced_vault();
    let _ = v.sign_quote(SWAP.into(), SWAP_SIG.trim().into(), "252812b3".into());
    let s = &v.signed[0];
    assert_eq!(s.kind, "intent_transfer");
    let q: serde_json::Value = serde_json::from_str(SWAP).unwrap();
    let p: serde_json::Value = serde_json::from_str(&s.payload).unwrap();
    assert_eq!(p["signer_id"], VAULT);
    assert_eq!(p["verifying_contract"], "intents.near");
    assert_eq!(p["intents"][0]["receiver_id"], q["depositAddress"]);
    assert_eq!(p["intents"][0]["tokens"][USDC_ID], q["amountIn"]);
    assert_eq!(s.digest, hex(&erc191_digest(&s.payload)));
    let swap = s.swap.as_ref().unwrap();
    assert_eq!((swap.from.as_str(), swap.to.as_str()), (q["originAsset"].as_str().unwrap(), q["destinationAsset"].as_str().unwrap()));
    assert_eq!(swap.amount_in.0.to_string(), q["amountIn"].as_str().unwrap());
}

#[test]
#[should_panic(expected = "quote already used")]
fn rejects_replayed_quote() {
    let mut v = priced_vault();
    let _ = v.sign_quote(SWAP.into(), SWAP_SIG.trim().into(), "252812b3".into());
    let _ = v.sign_quote(SWAP.into(), SWAP_SIG.trim().into(), "252812b3".into());
}

#[test]
#[should_panic(expected = "recipient must be the vault")]
fn rejects_quote_paying_someone_else() {
    let mut v = priced_vault();
    v.config.vault_address = "0x000000000000000000000000000000000000dead".into();
    let _ = v.sign_quote(SWAP.into(), SWAP_SIG.trim().into(), "252812b3".into());
}

#[test]
#[should_panic(expected = "only agent")]
fn only_agent_signs_quotes() {
    let mut v = priced_vault();
    ctx(accounts(3), quote_ms(SWAP) + 1000);
    let _ = v.sign_quote(SWAP.into(), SWAP_SIG.trim().into(), "252812b3".into());
}

#[test]
#[should_panic(expected = "price worse than oracle")]
fn rejects_swap_far_below_oracle_price() {
    let mut v = priced_vault();
    // Oracle says BTC is 10% cheaper, so the BTC this quote delivers is worth too little for its USDC.
    v.assets[0].price_out = U128(v.assets[0].price_out.0 * 90 / 100);
    let _ = v.sign_quote(SWAP.into(), SWAP_SIG.trim().into(), "252812b3".into());
}

#[test]
fn hedge_and_account_value_checks() {
    let v = priced_vault();
    let a = &v.assets[0];
    let spot = 27_000u128; // sats
    let short_value = spot * a.price_out.0 / a.price_in.0;
    let hedged = vec![Position { symbol: "BTC".into(), size: U128(spot), entry_notional: U128(short_value) }];
    let balances = [U128(5_000_000), U128(spot), U128(0)];
    // margin_net 0 + flat PnL: account value ≈ 0 within tolerance.
    let nav = v.check_and_value(&hedged, 0, &balances).unwrap();
    assert_eq!(nav, 5_000_000 + short_value);

    let unhedged = vec![Position { symbol: "BTC".into(), size: U128(spot / 2), entry_notional: U128(short_value / 2) }];
    assert!(v.check_and_value(&unhedged, 0, &balances).unwrap_err().contains("not hedged"));

    // Agent inflating the Hyperliquid account value is rejected.
    assert!(v.check_and_value(&hedged, 5_000_000, &balances).unwrap_err().contains("account value"));

    let rogue = vec![Position { symbol: "DOGE".into(), size: U128(1), entry_notional: U128(1) }];
    assert!(v.check_and_value(&rogue, 0, &[U128(0), U128(0), U128(0)]).is_err());
}

#[test]
fn withdrawal_burns_shares_and_signs_ft_withdraw() {
    let mut v = vault();
    ctx(usdc(), 1_000);
    let _ = v.ft_on_transfer(accounts(2), U128(10_000_000), String::new());
    v.snapshot = Some(Snapshot { nav: U128(10_000_000), ms: 1_000, usdc_in_verifier: U128(10_000_000), spot: vec![] });
    ctx(accounts(2), 2_000);
    let id = v.request_withdraw(U128(4_000_000));
    ctx(accounts(1), 2_000);
    let _ = v.fulfill_withdraw(id, "252812b3".into());
    let w = v.withdrawals[id as u32].clone();
    assert_eq!(w.usdc.0, 4_000_000);
    assert_eq!(w.status, "signed");
    assert_eq!(v.total_shares, 6_000_000);
    assert_eq!(v.owed_usdc, 4_000_000);
    let p: serde_json::Value = serde_json::from_str(&v.signed[0].payload).unwrap();
    assert_eq!(p["intents"][0]["intent"], "ft_withdraw");
    assert_eq!(p["intents"][0]["receiver_id"], accounts(2).as_str());
}

#[test]
fn mpc_response_converts_to_intents_signature() {
    // Round-trip the MPC-signed vector from the G-G spike (see contracts/mock-verifier/testdata).
    let expected = include_str!("../../mock-verifier/testdata/signature.txt").trim();
    let raw = bs58::decode(expected.strip_prefix("secp256k1:").unwrap()).into_vec().unwrap();
    let mpc = json!({
        "big_r": { "affine_point": format!("02{}", hex(&raw[..32])) },
        "s": { "scalar": hex(&raw[32..64]) },
        "recovery_id": raw[64],
    });
    assert_eq!(intents_signature(&mpc.to_string()), expected);
}

#[test]
fn account_value_is_checked_against_the_last_report() {
    let mut v = priced_vault();
    let a = v.assets[0].clone();
    let value = |q: u128, out: u128| q * out / a.price_in.0;
    // Last accepted report: 27_000 sat short, account 50 USDC, margin 50 sent.
    v.margin_net = 50_000_000;
    v.account_value = 50_000_000;
    v.positions = vec![Position { symbol: "BTC".into(), size: U128(27_000), entry_notional: U128(value(27_000, a.price_out.0)) }];
    v.last_report = Some((v.margin_net, v.assets.iter().map(|x| (x.price_in, x.price_out)).collect()));

    // Parked since: short closed, spot sold. Funding earned in between (0.4 USDC) sits in the account.
    // The old cumulative check paused here once the position shrank; this one accepts it.
    let parked = v.check_and_value(&[], 50_400_000, &[U128(20_000_000), U128(0), U128(0)]);
    assert!(parked.is_ok(), "{parked:?}");

    // Price falls 10% with the short still open: the short's gain explains the higher account value.
    let gain = value(27_000, a.price_out.0) / 10;
    v.assets[0].price_out = U128(a.price_out.0 * 9 / 10);
    let hedged = vec![Position { symbol: "BTC".into(), size: U128(27_000), entry_notional: U128(value(27_000, a.price_out.0)) }];
    assert!(v.check_and_value(&hedged, 50_000_000 + gain, &[U128(0), U128(27_000), U128(0)]).is_ok());

    // A agent reporting 5 USDC that nothing explains is rejected.
    let err = v.check_and_value(&hedged, 55_000_000 + gain, &[U128(0), U128(27_000), U128(0)]).unwrap_err();
    assert!(err.contains("account value"), "{err}");
}

#[test]
fn cost_basis_follows_deposits_and_withdrawals() {
    let mut v = vault();
    ctx(usdc(), 1_000);
    let _ = v.ft_on_transfer(accounts(2), U128(10_000_000), String::new());
    v.snapshot = Some(Snapshot { nav: U128(12_000_000), ms: 1_000, usdc_in_verifier: U128(0), spot: vec![] });
    // Second deposit at a higher share price: basis adds USDC, not shares.
    let _ = v.ft_on_transfer(accounts(2), U128(6_000_000), String::new());
    let p = v.get_holding(accounts(2));
    assert_eq!(p.deposited.0, 16_000_000);
    assert_eq!(p.shares.0, 15_000_000);
    // Withdrawing a third of the shares takes a third of the basis with it.
    ctx(accounts(2), 2_000);
    let _ = v.request_withdraw(U128(5_000_000));
    let p = v.get_holding(accounts(2));
    assert_eq!(p.shares.0, 10_000_000);
    assert_eq!(p.deposited.0, 10_666_667); // 16 - floor(16 * 5/15)
    assert_eq!(v.get_holding(accounts(3)).deposited.0, 0);
}

fn vault_with_fees() -> Contract {
    let mut v = vault();
    ctx(accounts(0), 1_000);
    v.set_params(Params { entry_fee_bps: 50, exit_fee_bps: 50, performance_fee_bps: 500, ..v.params.clone() });
    v
}

#[test]
fn entry_and_exit_fees_stay_in_the_vault() {
    let mut v = vault_with_fees();
    ctx(usdc(), 1_000);
    let _ = v.ft_on_transfer(accounts(2), U128(10_000_000), String::new());
    assert_eq!(v.get_shares(accounts(2)).0, 9_950_000);
    v.snapshot = Some(Snapshot { nav: U128(10_000_000), ms: 1_000, usdc_in_verifier: U128(10_000_000), spot: vec![] });
    // A second depositor pays their own entry: alice's shares are worth what she put in less hers.
    let _ = v.ft_on_transfer(accounts(3), U128(10_000_000), String::new());
    assert_eq!(v.get_shares(accounts(3)).0, 9_900_250); // 9.95 USDC at 10/9.95 per share
    let h = v.get_holding(accounts(3));
    assert_eq!((h.deposited.0, h.entry_cost.0), (10_000_000, 50_000));
    let price_before = v.snapshot.as_ref().unwrap().nav.0 * PRICE_ONE / v.total_shares;
    // Leaving pays 0.5% of the value out; what stays lifts the share price for everyone else.
    ctx(accounts(2), 2_000);
    let id = v.request_withdraw(U128(9_950_000));
    assert_eq!(v.get_holding(accounts(2)).entry_cost.0, 0); // left with all shares, so none of the cost stays
    ctx(accounts(1), 2_000);
    v.snapshot.as_mut().unwrap().ms = 2_000;
    v.snapshot.as_mut().unwrap().usdc_in_verifier = U128(20_000_000);
    let _ = v.fulfill_withdraw(id, "252812b3".into());
    let value = 9_950_000 * 20_000_000 / 19_850_250u128;
    assert_eq!(v.withdrawals[id as u32].usdc.0, value - value * 50 / 10_000);
    assert!(v.snapshot.as_ref().unwrap().nav.0 * PRICE_ONE / v.total_shares > price_before);
}

#[test]
fn performance_fee_only_on_gains_above_the_high_water_mark() {
    let mut v = vault_with_fees();
    ctx(usdc(), 1_000);
    let _ = v.ft_on_transfer(accounts(2), U128(10_000_000), String::new());
    let mark = v.high_water_mark;
    assert_eq!(mark, 10_000_000 * PRICE_ONE / 9_950_000); // the entry fee itself is not a gain

    // Below or at the mark: nothing minted.
    v.charge_performance_fee(10_000_000);
    v.charge_performance_fee(9_000_000);
    assert_eq!(v.get_shares(accounts(5)).0, 0);

    // Funding lifts NAV by 1 USDC: the treasury gets 5% of that gain as shares.
    v.charge_performance_fee(11_000_000);
    let t = v.get_shares(accounts(5)).0;
    let treasury_value = t * 11_000_000 / v.total_shares;
    assert!((49_000..=50_000).contains(&treasury_value), "{treasury_value}");
    assert_eq!(v.high_water_mark, 11_000_000 * PRICE_ONE / v.total_shares);

    // The same NAV reported again charges nothing more.
    v.charge_performance_fee(11_000_000);
    assert_eq!(v.get_shares(accounts(5)).0, t);
}

#[test]
#[should_panic(expected = "fee above cap")]
fn owner_cannot_raise_fees_past_the_caps() {
    let mut v = vault();
    ctx(accounts(0), 1_000);
    v.set_params(Params { performance_fee_bps: 2_001, ..v.params.clone() });
}

#[test]
fn margin_arriving_above_the_quote_minimum_is_not_a_violation() {
    // Testnet regression: 68.66 USDC sent, quote minimum 67.77, 68.46 arrived in an account that held
    // 0.01. The tolerance was 1% of the old 0.01 plus dust (0.5) and the vault paused itself.
    let mut v = vault();
    ctx(accounts(1), 1_000);
    v.account_value = 10_000;
    v.last_report = Some((0, v.assets.iter().map(|a| (a.price_in, a.price_out)).collect()));
    v.margin_net = 67_769_479;
    let ok = v.check_and_value(&[], 68_464_020, &[U128(0), U128(0), U128(0)]);
    assert!(ok.is_ok(), "{ok:?}");
    // A report far outside what the transfer explains still pauses.
    assert!(v.check_and_value(&[], 75_000_000, &[U128(0), U128(0), U128(0)]).is_err());
}

#[test]
fn a_late_report_is_dropped_without_pausing() {
    // Testnet regression: the agent reported its position 3 minutes after its prices and the vault
    // paused itself over a stale BTC price.
    let mut v = priced_vault();
    let held = vec![U128(0), U128(27_000), U128(0)];
    let short = vec![Position { symbol: "BTC".into(), size: U128(27_000), entry_notional: U128(20_000_000) }];
    ctx("vault.testnet".parse().unwrap(), quote_ms(PRICE) + 121_000);
    v.on_balances(short, U128(10_000_000), Ok(held));
    assert!(!v.paused);
    assert!(v.snapshot.is_none());
}
