#!/usr/bin/env bash
# Deploys NullPoint to NEAR testnet under $OWNER (default nullpoint.testnet):
#   usdc.$OWNER      mock USDC (NEP-141, open mint)
#   verifier.$OWNER  mock intents.near (real ERC-191 checks); $OWNER plays the 1Click solver
#   vault.$OWNER     the vault
#   keeper.$OWNER    keeper account (key saved to ~/.near-credentials for apps/keeper)
# Keys for created accounts go to the OS keychain; the keeper's also to the legacy keychain file.
set -euo pipefail
cd "$(dirname "$0")/.."

OWNER=${OWNER:-nullpoint.testnet}
NET="network-config testnet"
SIGN="sign-with-keychain send"

mkdir -p .keys
if [ ! -f .keys/mock-1click.json ]; then
  node -e '
    const { generateKeyPairSync } = require("node:crypto");
    const { base58 } = require("@scure/base");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
    console.log(JSON.stringify({ public_key: "ed25519:" + base58.encode(pub), seed_hex: seed.toString("hex") }));
  ' > .keys/mock-1click.json
fi
MOCK_PUBKEY=$(node -p 'require("./.keys/mock-1click.json").public_key')

has_code() { # account -> success if a contract is deployed (code hash isn't the empty 111…1)
  curl -s -X POST https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s).result?.code_hash;process.exit(h&&!/^1+$/.test(h)?0:1)})'
}

create() { # account amount [legacy]
  if near account view-account-summary "$1" $NET now >/dev/null 2>&1; then echo "exists: $1"; return; fi
  local save="save-to-keychain"; [ "${3:-}" = legacy ] && save="save-to-legacy-keychain"
  near account create-account fund-myself "$1" "$2 NEAR" autogenerate-new-keypair $save sign-as "$OWNER" $NET $SIGN
}

create "usdc.$OWNER" 1.8
create "verifier.$OWNER" 2.3
create "vault.$OWNER" 3.6
create "keeper.$OWNER" 1.0 legacy

has_code "usdc.$OWNER" && echo "deployed: usdc.$OWNER" || (cd contracts/mock-ft && cargo near deploy build-non-reproducible-wasm "usdc.$OWNER" \
  with-init-call new json-args '{"symbol":"mUSDC","decimals":6}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN)

has_code "verifier.$OWNER" && echo "deployed: verifier.$OWNER" || (cd contracts/mock-verifier && cargo near deploy build-non-reproducible-wasm "verifier.$OWNER" \
  with-init-call new json-args "{\"owner\":\"$OWNER\"}" prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN)

VAULT_ADDRESS=$(node --input-type=module -e "import { deriveEvmAddress } from '@nullpoint/core'; console.log(deriveEvmAddress('testnet', 'vault.$OWNER', 'hl-master'))")
echo "vault EVM address (Intents account + Hyperliquid master): $VAULT_ADDRESS"

# Testnet uses mainnet token ids for spot: the mock verifier keeps them as an internal ledger.
INIT=$(cat <<EOF
{
  "owner": "$OWNER",
  "keeper": "keeper.$OWNER",
  "config": {
    "usdc": "usdc.$OWNER",
    "usdc_token_id": "nep141:usdc.$OWNER",
    "hl_usdc_asset": "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054",
    "hl_token": "USDC:0xeb62eee3685fc4c43992febcd9e75443",
    "hl_chain": "Testnet",
    "hl_signature_chain_id": 421614,
    "verifier": "verifier.$OWNER",
    "mpc": "v1.signer-prod.testnet",
    "mpc_path": "hl-master",
    "vault_address": "$VAULT_ADDRESS",
    "oneclick_pubkey": "$MOCK_PUBKEY"
  },
  "params": {
    "max_tvl": "1000000000",
    "max_swap_usdc": "100000000",
    "max_slippage_bps": 150,
    "margin_slippage_bps": 300,
    "hedge_band_bps": 200,
    "max_funding_bps": 300,
    "dust_usdc": "500000",
    "max_price_age_s": 120,
    "max_nav_age_s": 600,
    "nav_history_interval_s": 600
  },
  "assets": [["BTC", "nep141:nbtc.bridge.near"], ["ETH", "nep141:eth.bridge.near"], ["NEAR", "nep141:wrap.near"]]
}
EOF
)
has_code "vault.$OWNER" && echo "deployed: vault.$OWNER" || (cd contracts/vault && cargo near deploy build-non-reproducible-wasm "vault.$OWNER" \
  with-init-call new json-args "$INIT" prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN)

echo "done: vault.$OWNER  verifier.$OWNER  usdc.$OWNER  keeper.$OWNER  ($VAULT_ADDRESS)"
