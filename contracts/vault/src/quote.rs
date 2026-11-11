// Verifies 1Click-signed quotes. 1Click signs base58(sha256(message)) with ed25519, where
// `message` is the stable-stringified {...quoteRequest, ...quote, timestamp}; see
// packages/core/src/oneclick.ts. The contract receives `message` itself so it can read the fields.
use near_sdk::serde::Deserialize;
use near_sdk::{bs58, env, require, serde_json};

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "camelCase")]
pub struct Quote {
    pub dry: bool,
    pub origin_asset: String,
    pub destination_asset: String,
    pub deposit_type: String,
    pub recipient: String,
    pub recipient_type: String,
    pub refund_to: String,
    pub refund_type: String,
    pub amount_in: String,
    pub amount_out: String,
    pub min_amount_out: String,
    pub deposit_address: Option<String>,
    pub timestamp: String,
}

impl Quote {
    pub fn amount_in(&self) -> u128 {
        self.amount_in.parse().expect("bad amountIn")
    }
    pub fn amount_out(&self) -> u128 {
        self.amount_out.parse().expect("bad amountOut")
    }
    pub fn min_amount_out(&self) -> u128 {
        self.min_amount_out.parse().expect("bad minAmountOut")
    }
}

/// Returns the quote hash (sha256 of the message, used for replay protection) and the parsed quote.
pub fn verify(message: &str, signature: &str, pubkey: &[u8; 32]) -> ([u8; 32], Quote) {
    let sig: [u8; 64] = bs58::decode(signature.strip_prefix("ed25519:").unwrap_or(signature))
        .into_vec()
        .ok()
        .and_then(|v| v.try_into().ok())
        .expect("bad quote signature");
    let hash = env::sha256_array(message.as_bytes());
    let signed = bs58::encode(hash).into_string();
    require!(env::ed25519_verify(&sig, signed.as_bytes(), pubkey), "quote not signed by 1Click");
    (hash, serde_json::from_str(message).expect("bad quote message"))
}

pub fn decode_pubkey(key: &str) -> [u8; 32] {
    bs58::decode(key.strip_prefix("ed25519:").unwrap_or(key))
        .into_vec()
        .ok()
        .and_then(|v| v.try_into().ok())
        .expect("bad ed25519 public key")
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const MANAGER: &str = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

    // Real mainnet quotes saved by scripts/fixtures-oneclick.ts.
    #[test]
    fn verifies_real_1click_quote() {
        testing_env!(VMContextBuilder::new().build());
        let msg = include_str!("../testdata/swap_usdc_btc.json");
        let sig = include_str!("../testdata/swap_usdc_btc.sig").trim();
        let (_, q) = verify(msg, sig, &decode_pubkey(MANAGER));
        assert!(!q.dry);
        assert_eq!(q.destination_asset, "nep141:nbtc.bridge.near");
        assert_eq!(q.recipient, "0x5e33437e5b871f1aa9e252dd00a36c53dfcb9a8d");
        assert!(q.deposit_address.is_some());
    }

    #[test]
    #[should_panic(expected = "quote not signed by 1Click")]
    fn rejects_tampered_quote() {
        testing_env!(VMContextBuilder::new().build());
        let msg = include_str!("../testdata/swap_usdc_btc.json")
            .replace("0x5e33437e5b871f1aa9e252dd00a36c53dfcb9a8d", "0x000000000000000000000000000000000000dead");
        let sig = include_str!("../testdata/swap_usdc_btc.sig").trim();
        verify(&msg, sig, &decode_pubkey(MANAGER));
    }
}
