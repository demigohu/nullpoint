// Testnet stand-in for intents.near: the subset NullPoint uses, with real ERC-191 signature checks.
// Deposits via ft_transfer_call (msg = receiver account), balances, and execute_intents with
// `transfer` / `ft_withdraw`. The owner plays the 1Click solver and credits swap outputs.
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, base64, bs58, env, near,
    require, serde_json,
};
use std::collections::HashMap;

const MAGIC: [u8; 4] = [0x56, 0x28, 0xf6, 0xc6];

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Balances,
    Nonces,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    salt: [u8; 4],
    /// (account, token_id) -> amount. token_id is "nep141:<contract>".
    balances: LookupMap<(AccountId, String), u128>,
    /// (signer, nonce) already used.
    nonces: LookupSet<(String, [u8; 32])>,
}

#[near(serializers = [json])]
pub struct SignedPayload {
    pub standard: String,
    pub payload: String,
    pub signature: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Payload {
    signer_id: String,
    verifying_contract: AccountId,
    nonce: String,
    intents: Vec<Intent>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "intent", rename_all = "snake_case")]
enum Intent {
    Transfer { receiver_id: String, tokens: HashMap<String, String> },
    FtWithdraw { token: AccountId, receiver_id: AccountId, amount: String },
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            salt: env::random_seed()[..4].try_into().unwrap(),
            balances: LookupMap::new(Key::Balances),
            nonces: LookupSet::new(Key::Nonces),
        }
    }

    /// NEP-141 deposit. `msg` is the receiver account inside the verifier (like intents.near).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let receiver = if msg.is_empty() { sender_id.to_string() } else { msg };
        let token = format!("nep141:{}", env::predecessor_account_id());
        self.add(&receiver, &token, amount.0);
        PromiseOrValue::Value(U128(0))
    }

    pub fn mt_balance_of(&self, account_id: String, token_id: String) -> U128 {
        U128(self.balance(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: String, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(self.balance(&account_id, t))).collect()
    }

    pub fn current_salt(&self) -> String {
        hex(&self.salt)
    }

    /// Mock 1Click fill: the owner credits the swap output to a recipient.
    pub fn solver_credit(&mut self, account_id: String, token_id: String, amount: U128) {
        require!(env::predecessor_account_id() == self.owner, "only owner");
        self.add(&account_id, &token_id, amount.0);
    }

    pub fn execute_intents(&mut self, signed: Vec<SignedPayload>) -> Vec<Promise> {
        let mut promises = vec![];
        for s in signed {
            require!(s.standard == "erc191", "only erc191 supported");
            let p: Payload = serde_json::from_str(&s.payload).expect("bad payload");
            require!(p.verifying_contract == env::current_account_id(), "wrong verifying_contract");
            require!(recover_erc191(&s.payload, &s.signature) == p.signer_id, "invalid signature");
            self.use_nonce(&p.signer_id, &p.nonce);
            for intent in p.intents {
                match intent {
                    Intent::Transfer { receiver_id, tokens } => {
                        for (token, amount) in tokens {
                            let amount: u128 = amount.parse().expect("bad amount");
                            self.sub(&p.signer_id, &token, amount);
                            self.add(&receiver_id, &token, amount);
                        }
                    }
                    Intent::FtWithdraw { token, receiver_id, amount } => {
                        let amount: u128 = amount.parse().expect("bad amount");
                        self.sub(&p.signer_id, &format!("nep141:{token}"), amount);
                        promises.push(
                            Promise::new(token).function_call(
                                "ft_transfer".to_string(),
                                serde_json::json!({ "receiver_id": receiver_id, "amount": amount.to_string() })
                                    .to_string()
                                    .into_bytes(),
                                NearToken::from_yoctonear(1),
                                Gas::from_tgas(15),
                            ),
                        );
                    }
                }
            }
        }
        promises
    }
}

impl Contract {
    fn balance(&self, account: &str, token: &str) -> u128 {
        self.balances.get(&(account.parse().expect("bad account"), token.to_string())).copied().unwrap_or(0)
    }

    fn add(&mut self, account: &str, token: &str, amount: u128) {
        let key = (account.parse().expect("bad account"), token.to_string());
        let v = self.balances.get(&key).copied().unwrap_or(0) + amount;
        self.balances.insert(key, v);
    }

    fn sub(&mut self, account: &str, token: &str, amount: u128) {
        let key = (account.parse().expect("bad account"), token.to_string());
        let v = self.balances.get(&key).copied().unwrap_or(0);
        require!(v >= amount, "insufficient balance or overflow");
        self.balances.insert(key, v - amount);
    }

    /// Versioned nonce: MAGIC(4) || 0x00 || salt(4) || deadline ns i64 LE(8) || random(15).
    fn use_nonce(&mut self, signer: &str, nonce_b64: &str) {
        use base64::Engine;
        let n: [u8; 32] = base64::engine::general_purpose::STANDARD
            .decode(nonce_b64)
            .ok()
            .and_then(|b| b.try_into().ok())
            .expect("bad nonce");
        require!(n[..4] == MAGIC && n[4] == 0, "nonce must be versioned");
        require!(n[5..9] == self.salt, "invalid salt");
        let deadline = i64::from_le_bytes(n[9..17].try_into().unwrap());
        require!(deadline as u64 >= env::block_timestamp(), "nonce expired");
        require!(self.nonces.insert((signer.to_string(), n)), "nonce already used");
    }
}

/// Recovers the lowercase 0x address that signed `payload` with ERC-191 personal_sign.
pub fn recover_erc191(payload: &str, signature: &str) -> String {
    let sig = bs58::decode(signature.strip_prefix("secp256k1:").expect("bad signature prefix"))
        .into_vec()
        .expect("bad signature");
    require!(sig.len() == 65 && sig[64] <= 1, "signature must be r||s||v with v in {0,1}");
    let mut msg = format!("\x19Ethereum Signed Message:\n{}", payload.len()).into_bytes();
    msg.extend_from_slice(payload.as_bytes());
    let hash = env::keccak256_array(&msg);
    let pk = env::ecrecover(&hash, &sig[..64], sig[64], false).expect("ecrecover failed");
    format!("0x{}", hex(&env::keccak256_array(&pk)[12..]))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;

    // Vector from the G-G spike: a payload signed by MPC (nullpoint.testnet / hl-master).
    // Regenerate with scripts/spike-intents-sig.ts if the format changes.
    #[test]
    fn recovers_known_signer() {
        testing_env!(VMContextBuilder::new().build());
        let payload = include_str!("../testdata/payload.json").trim();
        let signature = include_str!("../testdata/signature.txt").trim();
        assert_eq!(recover_erc191(payload, signature), "0x5e33437e5b871f1aa9e252dd00a36c53dfcb9a8d");
    }

    #[test]
    fn deposit_and_balance() {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(2)).build());
        let mut c = Contract::new(accounts(0));
        let _ = c.ft_on_transfer(accounts(1), U128(10), "0x5e33437e5b871f1aa9e252dd00a36c53dfcb9a8d".into());
        assert_eq!(
            c.mt_balance_of("0x5e33437e5b871f1aa9e252dd00a36c53dfcb9a8d".into(), format!("nep141:{}", accounts(2))).0,
            10
        );
    }
}
