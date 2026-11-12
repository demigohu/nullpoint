#!/usr/bin/env bash
# Deploys NullPoint to NEAR mainnet under $OWNER (default nullpoint.near). Every step but `plan` signs
# mainnet transactions with the owner's keychain key, so run them one at a time, in order:
#   bash scripts/deploy-mainnet.sh            plan: prints accounts, addresses and init args; sends nothing
#   bash scripts/deploy-mainnet.sh accounts   creates vault.$OWNER (3.8 NEAR) and agent.$OWNER (1.5 NEAR)
#   bash scripts/deploy-mainnet.sh contract   reproducible build (Docker, clean git tree), deploy + init
#   bash scripts/deploy-mainnet.sh register   registers the vault on the USDC contract (storage deposit)
# Then: node scripts/add-agent-keys.ts --network mainnet, deposit, and approve-agent once margin landed.
set -euo pipefail
cd "$(dirname "$0")/.."

OWNER=${OWNER:-nullpoint.near}
STEP=${1:-plan}
NET="network-config mainnet"
SIGN="sign-with-keychain send"
USDC=17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1

VAULT_ADDRESS=$(node --input-type=module -e "import { deriveEvmAddress } from '@nullpoint/core'; console.log(deriveEvmAddress('mainnet', 'vault.$OWNER', 'hl-master'))")
ONECLICK_PUBKEY=$(node --input-type=module -e "import { ONECLICK_MANAGER_PUBKEY } from '@nullpoint/core'; console.log(ONECLICK_MANAGER_PUBKEY)")

# Mainnet differs from testnet in: real intents.near, native USDC, v1.signer, 1Click's own key, and
# Hyperliquid mainnet. The agent runs every 10 min (INTERVAL_S=600), so NAV may be up to 15 min old.
# Margin moves pay a flat ~0.2-0.3 USDC to 1Click, over 3% below ~$10: margin slippage allows 5%.
INIT=$(cat <<EOF
{
  "owner": "$OWNER",
  "agent": "agent.$OWNER",
  "config": {
    "usdc": "$USDC",
    "usdc_token_id": "nep141:$USDC",
    "hl_usdc_asset": "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054",
    "hl_token": "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
    "hl_chain": "Mainnet",
    "hl_signature_chain_id": 42161,
    "verifier": "intents.near",
    "mpc": "v1.signer",
    "mpc_path": "hl-master",
    "vault_address": "$VAULT_ADDRESS",
    "oneclick_pubkey": "$ONECLICK_PUBKEY"
  },
  "params": {
    "max_tvl": "100000000",
    "max_swap_usdc": "50000000",
    "max_slippage_bps": 150,
    "margin_slippage_bps": 500,
    "hedge_band_bps": 200,
    "max_report_drift_bps": 200,
    "dust_usdc": "500000",
    "max_price_age_s": 120,
    "max_nav_age_s": 900,
    "nav_history_interval_s": 1800,
    "entry_fee_bps": 50,
    "exit_fee_bps": 50,
    "performance_fee_bps": 500,
    "treasury": "$OWNER"
  },
  "assets": [["BTC", "nep141:nbtc.bridge.near"], ["ETH", "nep141:eth.bridge.near"], ["NEAR", "nep141:wrap.near"]]
}
EOF
)

create() { # account amount
  if near account view-account-summary "$1" $NET now >/dev/null 2>&1; then echo "exists: $1"; return; fi
  near account create-account fund-myself "$1" "$2 NEAR" autogenerate-new-keypair save-to-legacy-keychain sign-as "$OWNER" $NET $SIGN
}

case "$STEP" in
  plan)
    echo "owner     $OWNER"
    echo "vault     vault.$OWNER   (EVM / Intents / Hyperliquid address $VAULT_ADDRESS)"
    echo "agent     agent.$OWNER"
    echo "init args:"; echo "$INIT"
    ;;
  accounts)
    create "vault.$OWNER" 3.8
    create "agent.$OWNER" 1.5
    ;;
  contract)
    [ -z "$(git status --porcelain)" ] || { echo "commit first: a reproducible build needs a clean git tree"; exit 1; }
    (cd contracts/vault && cargo near deploy build-reproducible-wasm "vault.$OWNER" \
      with-init-call new json-args "$INIT" prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN)
    ;;
  register)
    near contract call-function as-transaction "$USDC" storage_deposit json-args "{\"account_id\":\"vault.$OWNER\",\"registration_only\":true}" \
      prepaid-gas '30.0 Tgas' attached-deposit '0.00125 NEAR' sign-as "$OWNER" $NET $SIGN
    ;;
  *) echo "unknown step $STEP (plan | accounts | contract | register)"; exit 1 ;;
esac
