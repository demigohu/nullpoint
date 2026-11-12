// NullPoint vault: USDC in, delta-neutral (spot in the vault's NEAR Intents account, short perp on
// Hyperliquid). One MPC-derived EVM address is both the Intents account and the Hyperliquid master.
// The agent can only move funds through 1Click quotes the contract has verified (quote.rs).
mod quote;
mod util;

use near_sdk::json_types::{U64, U128};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, bs58, env,
    near, require, serde_json,
};
use serde_json::json;
use util::eip712::{self, Field};
use util::{erc191_digest, fmt_decimal, hex, iso_from_ms, ms_from_iso, unhex, versioned_nonce};

const MPC_GAS: Gas = Gas::from_tgas(250);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const XCC_GAS: Gas = Gas::from_tgas(30);
const INTENT_TTL_MS: u64 = 5 * 60_000;
/// Share prices (high-water mark) are stored as USDC per share scaled by this.
const PRICE_ONE: u128 = 1_000_000_000_000;
/// Caps the owner can't raise: entry/exit 1%, performance 20%.
const MAX_FLOW_FEE_BPS: u32 = 100;
const MAX_PERFORMANCE_FEE_BPS: u32 = 2_000;

#[near]
#[derive(BorshStorageKey)]
/// Storage prefixes carry a generation so `reinit` starts from empty collections on the same account
/// (NEAR won't delete an account with large state, and reusing prefixes would revive old balances).
enum Key {
    Shares(u8),
    UsedQuotes(u8),
    Withdrawals(u8),
    Signed(u8),
    Decisions(u8),
    NavHistory(u8),
    Deposited(u8),
    EntryCost(u8),
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Config {
    /// USDC NEP-141 contract and its Intents token id ("nep141:<usdc>").
    pub usdc: AccountId,
    pub usdc_token_id: String,
    /// 1Click asset id of USDC on Hyperliquid, e.g. "1cs_v1:hypercore:hip1:0x6d1e…".
    pub hl_usdc_asset: String,
    /// Hyperliquid token name used in sendAsset, e.g. "USDC:0x6d1e…".
    pub hl_token: String,
    /// "Testnet" | "Mainnet".
    pub hl_chain: String,
    pub hl_signature_chain_id: u64,
    pub verifier: AccountId,
    pub mpc: AccountId,
    pub mpc_path: String,
    /// Lowercase 0x address derived from (this contract, mpc_path) on `mpc`.
    pub vault_address: String,
    pub oneclick_pubkey: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Params {
    pub max_tvl: U128,
    pub max_swap_usdc: U128,
    pub max_slippage_bps: u32,
    pub margin_slippage_bps: u32,
    pub hedge_band_bps: u32,
    /// Max unexplained change in the Hyperliquid account value between two reports.
    pub max_report_drift_bps: u32,
    pub dust_usdc: U128,
    pub max_price_age_s: u64,
    pub max_nav_age_s: u64,
    pub nav_history_interval_s: u64,
    /// Kept in the vault: each depositor pays for the swaps that put their money to work, and each
    /// leaver for the ones that take it out, instead of the other holders.
    pub entry_fee_bps: u32,
    pub exit_fee_bps: u32,
    /// Share of gains above the high-water mark, minted as shares to `treasury`.
    pub performance_fee_bps: u32,
    pub treasury: AccountId,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Asset {
    pub symbol: String,
    /// Intents token id, e.g. "nep141:nbtc.bridge.near".
    pub token_id: String,
    /// Last verified 1Click price: `price_in` of the asset sold for `price_out` USDC.
    pub price_in: U128,
    pub price_out: U128,
    pub price_ms: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Position {
    pub symbol: String,
    /// Short size in the asset's base units.
    pub size: U128,
    /// USDC received when the short was opened (size × entry price).
    pub entry_notional: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Snapshot {
    pub nav: U128,
    pub ms: u64,
    pub usdc_in_verifier: U128,
    pub spot: Vec<U128>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Withdrawal {
    pub account: AccountId,
    pub shares: U128,
    pub usdc: U128,
    /// queued | signed | done | failed
    pub status: String,
    pub signed_id: Option<u64>,
}

#[near(serializers = [json])]
pub struct Holding {
    pub shares: U128,
    pub deposited: U128,
    /// The part of `deposited` that went to the entry fee, so the app can show it apart from earnings.
    pub entry_cost: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Signed {
    /// intent_transfer | intent_ft_withdraw | hl_approve_agent | hl_send_asset
    pub kind: String,
    /// Intent payload (erc191 string) or Hyperliquid action JSON, exactly as signed.
    pub payload: String,
    pub digest: String,
    /// Raw MPC response JSON once signed.
    pub signature: Option<String>,
    pub ms: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Decision {
    pub ms: u64,
    /// sha256 of the full strategist record (input, output, NEAR AI chat signature).
    pub hash: String,
    /// "llm" or "rule".
    pub source: String,
    pub action: String,
    pub target: Option<String>,
    pub accepted: bool,
    /// Model reasoning, or the guardrail's rejection reason.
    pub note: String,
    /// NEAR AI Cloud chat id and the TEE-attested address that signed the answer (empty for "rule").
    pub chat_id: String,
    pub signing_address: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct NavPoint {
    pub ms: u64,
    pub nav: U128,
    pub total_shares: U128,
}

#[near(serializers = [json])]
pub struct SignedQuote {
    pub message: String,
    pub signature: String,
}

#[near(serializers = [json])]
pub struct State {
    pub owner: AccountId,
    pub agent: AccountId,
    pub config: Config,
    pub params: Params,
    pub assets: Vec<Asset>,
    pub paused: bool,
    pub total_shares: U128,
    pub pending_usdc: U128,
    pub owed_usdc: U128,
    pub margin_net: String,
    pub positions: Vec<Position>,
    pub account_value: U128,
    pub snapshot: Option<Snapshot>,
    /// Highest share price the performance fee has been charged up to (USDC per share × 1e12).
    pub high_water_mark: U128,
    pub signed_count: u32,
    pub withdrawal_count: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    agent: AccountId,
    config: Config,
    params: Params,
    assets: Vec<Asset>,
    paused: bool,
    shares: LookupMap<AccountId, u128>,
    /// USDC each account has put in and not yet taken out (pro rata on withdrawals): its cost basis,
    /// so the app can show what the shares earned.
    deposited: LookupMap<AccountId, u128>,
    /// Entry fees each account paid, reduced pro rata on withdrawals like `deposited`.
    entry_cost: LookupMap<AccountId, u128>,
    total_shares: u128,
    /// Share price × PRICE_ONE up to which gains have already paid the performance fee.
    high_water_mark: u128,
    /// Deposited USDC still on this contract, not yet swept into the Intents account.
    pending_usdc: u128,
    /// USDC promised to fulfilled withdrawals that hasn't left the Intents account yet.
    owed_usdc: u128,
    /// USDC sent to Hyperliquid minus USDC pulled back (6 decimals).
    margin_net: i128,
    positions: Vec<Position>,
    account_value: u128,
    /// margin_net and asset prices (price_in, price_out) at the last accepted report; None before it.
    last_report: Option<(i128, Vec<(U128, U128)>)>,
    snapshot: Option<Snapshot>,
    used_quotes: LookupSet<[u8; 32]>,
    withdrawals: Vector<Withdrawal>,
    signed: Vector<Signed>,
    decisions: Vector<Decision>,
    nav_history: Vector<NavPoint>,
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn bps(amount: u128, bps: u32) -> u128 {
    amount * bps as u128 / 10_000
}

fn assert_fee_caps(p: &Params) {
    require!(
        p.entry_fee_bps <= MAX_FLOW_FEE_BPS && p.exit_fee_bps <= MAX_FLOW_FEE_BPS && p.performance_fee_bps <= MAX_PERFORMANCE_FEE_BPS,
        "fee above cap"
    );
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, agent: AccountId, config: Config, params: Params, assets: Vec<(String, String)>) -> Self {
        Self::fresh(0, owner, agent, config, params, assets)
    }

    /// Wipes the vault to a fresh state on the same account (testnet resets). `#[private]`: only a
    /// transaction signed by the vault account itself can call it, never the agent or a user.
    #[private]
    #[init(ignore_state)]
    pub fn reinit(generation: u8, owner: AccountId, agent: AccountId, config: Config, params: Params, assets: Vec<(String, String)>) -> Self {
        require!(generation > 0, "use a new generation");
        Self::fresh(generation, owner, agent, config, params, assets)
    }
}

impl Contract {
    fn fresh(g: u8, owner: AccountId, agent: AccountId, config: Config, params: Params, assets: Vec<(String, String)>) -> Self {
        quote::decode_pubkey(&config.oneclick_pubkey);
        assert_fee_caps(&params);
        Self {
            owner,
            agent,
            config,
            params,
            assets: assets
                .into_iter()
                .map(|(symbol, token_id)| Asset { symbol, token_id, price_in: U128(0), price_out: U128(0), price_ms: 0 })
                .collect(),
            paused: false,
            shares: LookupMap::new(Key::Shares(g)),
            deposited: LookupMap::new(Key::Deposited(g)),
            entry_cost: LookupMap::new(Key::EntryCost(g)),
            total_shares: 0,
            high_water_mark: 0,
            pending_usdc: 0,
            owed_usdc: 0,
            margin_net: 0,
            positions: vec![],
            account_value: 0,
            last_report: None,
            snapshot: None,
            used_quotes: LookupSet::new(Key::UsedQuotes(g)),
            withdrawals: Vector::new(Key::Withdrawals(g)),
            signed: Vector::new(Key::Signed(g)),
            decisions: Vector::new(Key::Decisions(g)),
            nav_history: Vector::new(Key::NavHistory(g)),
        }
    }
}

#[near]
impl Contract {
    // ---------- owner ----------

    pub fn set_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        self.agent = agent;
    }

    pub fn set_params(&mut self, params: Params) {
        self.assert_owner();
        assert_fee_caps(&params);
        self.params = params;
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }

    /// Correct margin accounting after a refunded 1Click margin transfer.
    pub fn set_margin_net(&mut self, margin_net: String) {
        self.assert_owner();
        self.margin_net = margin_net.parse().expect("bad i128");
    }

    /// Hyperliquid approveAgent signed by the vault's MPC key. Approving the zero address under the
    /// same name revokes the previous agent.
    pub fn approve_agent(&mut self, agent: String, name: String) -> Promise {
        self.assert_owner();
        let agent = agent.to_lowercase();
        require!(agent.len() == 42 && agent.starts_with("0x"), "agent must be a 0x address");
        let nonce = now_ms();
        let digest = eip712::digest(
            self.config.hl_signature_chain_id,
            eip712::APPROVE_AGENT,
            &[Field::Str(&self.config.hl_chain), Field::Addr(&agent), Field::Str(&name), Field::U64(nonce)],
        );
        let action = json!({
            "type": "approveAgent",
            "signatureChainId": format!("0x{:x}", self.config.hl_signature_chain_id),
            "hyperliquidChain": self.config.hl_chain,
            "agentAddress": agent,
            "agentName": name,
            "nonce": nonce,
        });
        self.request_signature("hl_approve_agent", action.to_string(), digest)
    }

    // ---------- deposits ----------

    /// USDC deposit. Shares are priced off the latest NAV snapshot.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let _ = msg;
        require!(env::predecessor_account_id() == self.config.usdc, "only USDC");
        require!(!self.paused, "paused");
        let amount = amount.0;
        // The entry fee buys no shares and stays in the vault.
        let fee = bps(amount, self.params.entry_fee_bps);
        let net = amount - fee;
        let shares = if self.total_shares == 0 {
            self.high_water_mark = 0; // an emptied vault starts over
            net
        } else {
            let nav = self.fresh_nav();
            require!(nav > 0, "nav is zero");
            net * self.total_shares / nav
        };
        require!(shares > 0, "deposit too small");
        let nav_after = self.snapshot.as_ref().map_or(0, |s| s.nav.0) + amount;
        require!(nav_after <= self.params.max_tvl.0, "max TVL reached");
        if let Some(s) = self.snapshot.as_mut() {
            s.nav = U128(nav_after);
        }
        let balance = self.shares.get(&sender_id).copied().unwrap_or(0);
        let basis = self.deposited.get(&sender_id).copied().unwrap_or(0);
        self.deposited.insert(sender_id.clone(), basis + amount);
        let paid = self.entry_cost.get(&sender_id).copied().unwrap_or(0);
        self.entry_cost.insert(sender_id.clone(), paid + fee);
        self.shares.insert(sender_id, balance + shares);
        self.total_shares += shares;
        self.pending_usdc += amount;
        self.raise_high_water_mark(nav_after);
        PromiseOrValue::Value(U128(0))
    }

    /// Moves deposited USDC into the vault's Intents account. Anyone can call.
    pub fn sweep(&mut self) -> Promise {
        let amount = self.pending_usdc;
        require!(amount > 0, "nothing to sweep");
        self.pending_usdc = 0;
        Promise::new(self.config.usdc.clone())
            .function_call(
                "ft_transfer_call".to_string(),
                json!({ "receiver_id": self.config.verifier, "amount": amount.to_string(), "msg": self.config.vault_address })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(60),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_sweep(U128(amount)))
    }

    #[private]
    pub fn on_sweep(&mut self, amount: U128, #[callback_result] used: Result<U128, PromiseError>) {
        // ft_transfer_call returns the amount the receiver kept; anything else stayed here.
        let used = used.map_or(0, |u| u.0);
        self.pending_usdc += amount.0 - used;
    }

    // ---------- agent: prices, positions, NAV ----------

    /// Stores asset prices from dry 1Click quotes (asset -> USDC), verified on-chain.
    pub fn report_prices(&mut self, quotes: Vec<SignedQuote>) {
        self.assert_agent();
        let pubkey = quote::decode_pubkey(&self.config.oneclick_pubkey);
        for sq in quotes {
            let (_, q) = quote::verify(&sq.message, &sq.signature, &pubkey);
            require!(q.destination_asset == self.config.usdc_token_id, "price quote must be priced in USDC");
            let ms = self.assert_fresh(&q.timestamp);
            let asset = self.assets.iter_mut().find(|a| a.token_id == q.origin_asset).expect("asset not allowlisted");
            require!(ms >= asset.price_ms, "older than stored price");
            asset.price_in = U128(q.amount_in());
            asset.price_out = U128(q.amount_out());
            asset.price_ms = ms;
        }
    }

    /// Agent reports the Hyperliquid side; the contract reads spot balances itself, checks the
    /// hedge and account value against its own records, then recomputes NAV.
    pub fn report_position(&mut self, positions: Vec<Position>, account_value: U128) -> Promise {
        self.assert_agent();
        let mut tokens = vec![self.config.usdc_token_id.clone()];
        tokens.extend(self.assets.iter().map(|a| a.token_id.clone()));
        Promise::new(self.config.verifier.clone())
            .function_call(
                "mt_batch_balance_of".to_string(),
                json!({ "account_id": self.config.vault_address, "token_ids": tokens }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                XCC_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(30))
                    .on_balances(positions, account_value),
            )
    }

    #[private]
    pub fn on_balances(
        &mut self,
        positions: Vec<Position>,
        account_value: U128,
        #[callback_result] balances: Result<Vec<U128>, PromiseError>,
    ) {
        let Ok(balances) = balances else { return env::log_str("balance read failed") };
        match self.check_and_value(&positions, account_value.0, &balances) {
            Ok(nav) => {
                self.charge_performance_fee(nav);
                self.positions = positions;
                self.account_value = account_value.0;
                self.last_report = Some((self.margin_net, self.assets.iter().map(|a| (a.price_in, a.price_out)).collect()));
                self.snapshot = Some(Snapshot {
                    nav: U128(nav),
                    ms: now_ms(),
                    usdc_in_verifier: balances[0],
                    spot: balances[1..].to_vec(),
                });
                let due = self.nav_history.len() == 0
                    || now_ms() - self.nav_history[self.nav_history.len() - 1].ms
                        >= self.params.nav_history_interval_s * 1000;
                if due {
                    self.nav_history.push(NavPoint { ms: now_ms(), nav: U128(nav), total_shares: U128(self.total_shares) });
                }
            }
            Err(reason) => {
                // Don't panic in a callback: record the violation and stop the vault.
                self.paused = true;
                env::log_str(&format!("PAUSED: {reason}"));
            }
        }
    }

    pub fn report_decision(&mut self, decision: Decision) {
        self.assert_agent();
        require!(decision.note.len() <= 280 && decision.hash.len() == 64, "note <= 280 chars, hash = sha256 hex");
        self.decisions.push(Decision { ms: now_ms(), ..decision });
    }

    // ---------- agent: moving funds through verified 1Click quotes ----------

    /// Verifies a 1Click quote and asks MPC to sign the matching transfer:
    /// - spot swap / rotation (Intents balance -> Intents balance),
    /// - margin out (Intents USDC -> Hyperliquid master),
    /// - margin in (Hyperliquid master -> Intents USDC, as a Hyperliquid sendAsset).
    /// `salt_hex` is the verifier's current salt; a wrong salt only makes the intent invalid.
    pub fn sign_quote(&mut self, message: String, signature: String, salt_hex: String) -> Promise {
        self.assert_agent();
        require!(!self.paused, "paused");
        let pubkey = quote::decode_pubkey(&self.config.oneclick_pubkey);
        let (hash, q) = quote::verify(&message, &signature, &pubkey);
        require!(!q.dry, "dry quote");
        self.assert_fresh(&q.timestamp);
        require!(self.used_quotes.insert(hash), "quote already used");
        require!(q.recipient.to_lowercase() == self.config.vault_address, "recipient must be the vault");
        require!(q.refund_to.to_lowercase() == self.config.vault_address, "refund must go to the vault");
        let deposit = q.deposit_address.clone().expect("quote has no depositAddress");
        let (usdc, hl) = (self.config.usdc_token_id.clone(), self.config.hl_usdc_asset.clone());
        let (amount_in, min_out) = (q.amount_in(), q.min_amount_out());

        if q.origin_asset == hl {
            // Margin in: Hyperliquid USDC (8 dp) -> Intents USDC (6 dp).
            require!(q.deposit_type == "ORIGIN_CHAIN" && q.refund_type == "ORIGIN_CHAIN", "bad deposit/refund type");
            require!(q.destination_asset == usdc && q.recipient_type == "INTENTS", "margin must return to Intents USDC");
            let usdc_in = amount_in / 100;
            require!(usdc_in <= self.params.max_swap_usdc.0, "amount over max_swap_usdc");
            require!(min_out >= usdc_in - bps(usdc_in, self.params.margin_slippage_bps), "minAmountOut too low");
            self.margin_net -= usdc_in as i128;
            let nonce = now_ms();
            let amount = fmt_decimal(amount_in, 8);
            let digest = eip712::digest(
                self.config.hl_signature_chain_id,
                eip712::SEND_ASSET,
                &[
                    Field::Str(&self.config.hl_chain),
                    Field::Str(&deposit),
                    Field::Str(""),
                    Field::Str("spot"),
                    Field::Str(&self.config.hl_token),
                    Field::Str(&amount),
                    Field::Str(""),
                    Field::U64(nonce),
                ],
            );
            let action = json!({
                "type": "sendAsset",
                "signatureChainId": format!("0x{:x}", self.config.hl_signature_chain_id),
                "hyperliquidChain": self.config.hl_chain,
                "destination": deposit,
                "sourceDex": "",
                "destinationDex": "spot",
                "token": self.config.hl_token,
                "amount": amount,
                "fromSubAccount": "",
                "nonce": nonce,
            });
            return self.request_signature("hl_send_asset", action.to_string(), digest);
        }

        require!(q.deposit_type == "INTENTS" && q.refund_type == "INTENTS", "must spend from the Intents balance");
        if q.destination_asset == hl {
            // Margin out: Intents USDC (6 dp) -> Hyperliquid perp balance (8 dp).
            require!(q.origin_asset == usdc && q.recipient_type == "DESTINATION_CHAIN", "bad margin route");
            require!(amount_in <= self.params.max_swap_usdc.0, "amount over max_swap_usdc");
            let usdc_out = min_out / 100;
            require!(usdc_out >= amount_in - bps(amount_in, self.params.margin_slippage_bps), "minAmountOut too low");
            self.margin_net += usdc_out as i128;
        } else {
            // Spot swap or rotation inside the Intents account.
            require!(q.recipient_type == "INTENTS", "swap output must stay in Intents");
            require!(q.origin_asset != q.destination_asset, "same asset");
            let value_in = self.value_of(&q.origin_asset, amount_in);
            require!(value_in <= self.params.max_swap_usdc.0, "amount over max_swap_usdc");
            let value_out = self.value_of(&q.destination_asset, min_out);
            require!(value_out >= value_in - bps(value_in, self.params.max_slippage_bps), "price worse than oracle");
        }
        let payload = self.intent_payload(
            json!({ "intent": "transfer", "receiver_id": deposit, "tokens": { q.origin_asset: amount_in.to_string() } }),
            &salt_hex,
        );
        let digest = erc191_digest(&payload);
        self.request_signature("intent_transfer", payload, digest)
    }

    // ---------- withdrawals ----------

    /// Escrows shares for withdrawal. The agent prices and signs it with `fulfill_withdraw`.
    pub fn request_withdraw(&mut self, shares: U128) -> u64 {
        let account = env::predecessor_account_id();
        let balance = self.shares.get(&account).copied().unwrap_or(0);
        require!(shares.0 > 0 && shares.0 <= balance, "not enough shares");
        let basis = self.deposited.get(&account).copied().unwrap_or(0);
        self.deposited.insert(account.clone(), basis - basis * shares.0 / balance);
        let paid = self.entry_cost.get(&account).copied().unwrap_or(0);
        self.entry_cost.insert(account.clone(), paid - paid * shares.0 / balance);
        self.shares.insert(account.clone(), balance - shares.0);
        self.withdrawals.push(Withdrawal { account, shares, usdc: U128(0), status: "queued".into(), signed_id: None });
        self.withdrawals.len() as u64 - 1
    }

    /// Prices a queued withdrawal off a fresh NAV, burns its shares and has MPC sign an Intents
    /// ft_withdraw to the user. A failed one can be re-signed at the same price.
    pub fn fulfill_withdraw(&mut self, id: u64, salt_hex: String) -> Promise {
        self.assert_agent();
        let mut w = self.withdrawals.get(id as u32).cloned().expect("no such withdrawal");
        if w.status == "queued" {
            let nav = self.fresh_nav();
            let value = w.shares.0 * nav / self.total_shares;
            // The exit fee stays in the vault.
            let usdc = value - bps(value, self.params.exit_fee_bps);
            let available = self.snapshot.as_ref().unwrap().usdc_in_verifier.0.saturating_sub(self.owed_usdc);
            require!(usdc <= available, "not enough idle USDC; unwind first");
            self.total_shares -= w.shares.0;
            if let Some(s) = self.snapshot.as_mut() {
                s.nav = U128(nav - usdc);
            }
            self.raise_high_water_mark(nav - usdc);
            self.owed_usdc += usdc;
            w.usdc = U128(usdc);
        } else {
            require!(w.status == "failed", "withdrawal not fulfillable");
        }
        let payload = self.intent_payload(
            json!({ "intent": "ft_withdraw", "token": self.config.usdc, "receiver_id": w.account, "amount": w.usdc.0.to_string() }),
            &salt_hex,
        );
        w.status = "signed".into();
        w.signed_id = Some(self.signed.len() as u64);
        self.withdrawals.replace(id as u32, w);
        let digest = erc191_digest(&payload);
        self.request_signature("intent_ft_withdraw", payload, digest)
    }

    /// Submits a signed withdrawal to the verifier. Anyone can call, so the agent can't hold funds.
    pub fn execute_withdraw(&mut self, id: u64) -> Promise {
        let w = self.withdrawals.get(id as u32).cloned().expect("no such withdrawal");
        require!(w.status == "signed", "withdrawal not signed");
        let s = self.signed.get(w.signed_id.unwrap() as u32).cloned().unwrap();
        let signature = intents_signature(s.signature.as_deref().expect("MPC signature pending"));
        Promise::new(self.config.verifier.clone())
            .function_call(
                "execute_intents".to_string(),
                json!({ "signed": [{ "standard": "erc191", "payload": s.payload, "signature": signature }] })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(80),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_withdraw_executed(id))
    }

    #[private]
    pub fn on_withdraw_executed(&mut self, id: u64, #[callback_result] result: Result<(), PromiseError>) {
        let mut w = self.withdrawals.get(id as u32).cloned().unwrap();
        if result.is_ok() {
            self.owed_usdc -= w.usdc.0;
            w.status = "done".into();
        } else {
            w.status = "failed".into();
        }
        self.withdrawals.replace(id as u32, w);
    }

    // ---------- MPC ----------

    #[private]
    pub fn on_signed(&mut self, id: u64, #[callback_result] result: Result<serde_json::Value, PromiseError>) {
        let mut s = self.signed.get(id as u32).cloned().unwrap();
        s.signature = Some(result.map_or_else(|_| "error".into(), |v| v.to_string()));
        self.signed.replace(id as u32, s);
    }

    // ---------- views ----------

    pub fn get_state(&self) -> State {
        State {
            owner: self.owner.clone(),
            agent: self.agent.clone(),
            config: self.config.clone(),
            params: self.params.clone(),
            assets: self.assets.clone(),
            paused: self.paused,
            total_shares: U128(self.total_shares),
            pending_usdc: U128(self.pending_usdc),
            owed_usdc: U128(self.owed_usdc),
            margin_net: self.margin_net.to_string(),
            positions: self.positions.clone(),
            account_value: U128(self.account_value),
            snapshot: self.snapshot.clone(),
            high_water_mark: U128(self.high_water_mark),
            signed_count: self.signed.len(),
            withdrawal_count: self.withdrawals.len(),
        }
    }

    pub fn get_shares(&self, account_id: AccountId) -> U128 {
        U128(self.shares.get(&account_id).copied().unwrap_or(0))
    }

    /// Shares and cost basis (USDC put in, minus the share of it already withdrawn).
    pub fn get_holding(&self, account_id: AccountId) -> Holding {
        Holding {
            shares: U128(self.shares.get(&account_id).copied().unwrap_or(0)),
            deposited: U128(self.deposited.get(&account_id).copied().unwrap_or(0)),
            entry_cost: U128(self.entry_cost.get(&account_id).copied().unwrap_or(0)),
        }
    }

    pub fn get_signed(&self, from: U64, limit: u32) -> Vec<(u64, Signed)> {
        page(&self.signed, from.0, limit)
    }

    pub fn get_withdrawals(&self, from: U64, limit: u32) -> Vec<(u64, Withdrawal)> {
        page(&self.withdrawals, from.0, limit)
    }

    pub fn get_decisions(&self, from: U64, limit: u32) -> Vec<(u64, Decision)> {
        page(&self.decisions, from.0, limit)
    }

    pub fn get_nav_history(&self, from: U64, limit: u32) -> Vec<(u64, NavPoint)> {
        page(&self.nav_history, from.0, limit)
    }
}

impl Contract {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only owner");
    }

    fn assert_agent(&self) {
        require!(env::predecessor_account_id() == self.agent, "only agent");
    }

    /// Returns the quote's timestamp in ms after checking it's within max_price_age_s.
    fn assert_fresh(&self, timestamp: &str) -> u64 {
        let ms = ms_from_iso(timestamp).expect("bad quote timestamp");
        require!(now_ms().saturating_sub(ms) <= self.params.max_price_age_s * 1000, "quote too old");
        ms
    }

    /// Entry and exit fees lift the share price without any earnings; raising the mark with them
    /// keeps the performance fee off money that only pays for swaps.
    fn raise_high_water_mark(&mut self, nav: u128) {
        if self.total_shares > 0 {
            self.high_water_mark = self.high_water_mark.max(nav * PRICE_ONE / self.total_shares);
        }
    }

    /// Mints the treasury `performance_fee_bps` of the gain above the high-water mark, as shares, so
    /// holders pay it only out of funding actually earned.
    fn charge_performance_fee(&mut self, nav: u128) {
        if self.total_shares == 0 || nav == 0 {
            return;
        }
        let price = nav * PRICE_ONE / self.total_shares;
        if price <= self.high_water_mark {
            return;
        }
        let fee = bps((price - self.high_water_mark) * self.total_shares / PRICE_ONE, self.params.performance_fee_bps);
        if fee > 0 && fee < nav {
            let minted = fee * self.total_shares / (nav - fee);
            let t = self.params.treasury.clone();
            let balance = self.shares.get(&t).copied().unwrap_or(0);
            self.shares.insert(t, balance + minted);
            self.total_shares += minted;
        }
        self.high_water_mark = nav * PRICE_ONE / self.total_shares;
    }

    fn fresh_nav(&self) -> u128 {
        let s = self.snapshot.as_ref().expect("no NAV snapshot yet");
        require!(now_ms() - s.ms <= self.params.max_nav_age_s * 1000, "NAV snapshot stale");
        s.nav.0
    }

    fn asset(&self, token_id: &str) -> &Asset {
        let a = self.assets.iter().find(|a| a.token_id == token_id).expect("asset not allowlisted");
        require!(now_ms() - a.price_ms <= self.params.max_price_age_s * 1000, "price stale");
        a
    }

    /// USDC value (6 dp) of `amount` base units of `token_id`, priced off the stored 1Click quote.
    fn value_of(&self, token_id: &str, amount: u128) -> u128 {
        if token_id == self.config.usdc_token_id {
            return amount;
        }
        let a = self.asset(token_id);
        amount * a.price_out.0 / a.price_in.0
    }

    /// Checks the reported Hyperliquid side against on-chain spot balances and the contract's own
    /// margin records, and returns NAV. `balances` = [USDC, asset_0, asset_1, ...] in the Intents account.
    fn check_and_value(&self, positions: &[Position], account_value: u128, balances: &[U128]) -> Result<u128, String> {
        if balances.len() != self.assets.len() + 1 {
            return Err("balance count mismatch".into());
        }
        let p = &self.params;
        let (mut spot_value, mut short_value, mut pnl) = (0u128, 0u128, 0i128);
        for (i, a) in self.assets.iter().enumerate() {
            let spot = balances[i + 1].0;
            let pos = positions.iter().find(|x| x.symbol == a.symbol);
            let short = pos.map_or(0, |x| x.size.0);
            if spot == 0 && short == 0 {
                continue;
            }
            if now_ms() - a.price_ms > p.max_price_age_s * 1000 {
                return Err(format!("{} price stale", a.symbol));
            }
            let px = |q: u128| q * a.price_out.0 / a.price_in.0;
            let (sv, shv) = (px(spot), px(short));
            if px(spot.abs_diff(short)) > bps(sv, p.hedge_band_bps) + p.dust_usdc.0 {
                return Err(format!("{} not hedged: spot {spot} vs short {short}", a.symbol));
            }
            spot_value += sv;
            short_value += shv;
            pnl += pos.map_or(0, |x| x.entry_notional.0 as i128) - shv as i128;
        }
        if positions.iter().any(|x| !self.assets.iter().any(|a| a.symbol == x.symbol)) {
            return Err("position in non-allowlisted asset".into());
        }
        // The Hyperliquid account value must be explained by what the contract knows. Compared with the
        // last accepted report: + margin moved since, + what the old shorts gained or lost at the new
        // prices. Funding and realized PnL are already inside the last value, so they don't pile up.
        // The very first report has nothing to compare with: margin sent + open short PnL.
        let expected = match &self.last_report {
            None => self.margin_net + pnl,
            Some((margin_then, px_then)) => {
                let mut price_effect = 0i128;
                for (a, (pin, pout)) in self.assets.iter().zip(px_then) {
                    let Some(old) = self.positions.iter().find(|x| x.symbol == a.symbol) else { continue };
                    let then = (old.size.0 * pout.0 / pin.0.max(1)) as i128;
                    let now = (old.size.0 * a.price_out.0 / a.price_in.0.max(1)) as i128;
                    price_effect += then - now; // a short gains when the price falls
                }
                self.account_value as i128 + (self.margin_net - margin_then) + price_effect
            }
        };
        let base = short_value.max(self.account_value);
        let tolerance = (bps(base, p.max_report_drift_bps) + p.dust_usdc.0) as i128;
        if (account_value as i128 - expected).abs() > tolerance {
            return Err(format!("account value {account_value} outside expected {expected} ± {tolerance}"));
        }
        Ok((self.pending_usdc + balances[0].0 + spot_value + account_value).saturating_sub(self.owed_usdc))
    }

    fn intent_payload(&self, intent: serde_json::Value, salt_hex: &str) -> String {
        let salt: [u8; 4] = unhex(salt_hex).try_into().expect("salt must be 4 bytes");
        let deadline = now_ms() + INTENT_TTL_MS;
        json!({
            "signer_id": self.config.vault_address,
            "verifying_contract": self.config.verifier,
            "deadline": iso_from_ms(deadline),
            "nonce": versioned_nonce(salt, deadline * 1_000_000, &env::random_seed_array()),
            "intents": [intent],
        })
        .to_string()
    }

    fn request_signature(&mut self, kind: &str, payload: String, digest: [u8; 32]) -> Promise {
        let id = self.signed.len() as u64;
        self.signed.push(Signed { kind: kind.into(), payload, digest: hex(&digest), signature: None, ms: now_ms() });
        Promise::new(self.config.mpc.clone())
            .function_call(
                "sign".to_string(),
                json!({ "request": { "payload_v2": { "Ecdsa": hex(&digest) }, "path": self.config.mpc_path, "domain_id": 0 } })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(1),
                MPC_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_signed(id))
    }
}

/// MPC response {"big_r":{"affine_point":"02…"},"s":{"scalar":"…"},"recovery_id":n} -> "secp256k1:<base58 r||s||v>".
fn intents_signature(mpc_json: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(mpc_json).expect("bad MPC signature");
    let r = unhex(v["big_r"]["affine_point"].as_str().expect("no big_r"));
    let s = unhex(v["s"]["scalar"].as_str().expect("no s"));
    let mut sig = r[1..].to_vec();
    sig.extend_from_slice(&s);
    sig.push(v["recovery_id"].as_u64().expect("no recovery_id") as u8);
    format!("secp256k1:{}", bs58::encode(sig).into_string())
}

fn page<T: Clone + near_sdk::borsh::BorshSerialize + near_sdk::borsh::BorshDeserialize>(
    v: &Vector<T>,
    from: u64,
    limit: u32,
) -> Vec<(u64, T)> {
    (from..v.len() as u64).take(limit as usize).map(|i| (i, v[i as u32].clone())).collect()
}

#[cfg(test)]
mod tests;
