#!/bin/bash
#
# Deploy the ZKT ZK layer (V10Deploy) on top of an already-deployed tawf-gov
# DAO layer.
#
# Usage:
#   ./deploy.sh --network sepolia          # Ethereum Sepolia (the real target)
#   ./deploy.sh --network anvil            # local
#   ./deploy.sh --network sepolia --dry-run
#
# Prior to this rewrite the script rejected `sepolia` outright and ran the
# obsolete DeployZKT script against Base, so it could not reproduce any
# deployment in sc/broadcast/ (all of which are chain 11155111).

set -euo pipefail

if [ ! -f .env ]; then
    echo "Error: .env not found. Copy .env.example and fill it in."
    exit 1
fi
source .env

NETWORK="sepolia"
BROADCAST="--broadcast"

while [[ $# -gt 0 ]]; do
    case $1 in
        "--network")
            NETWORK="$2"
            shift 2
            ;;
        "--dry-run")
            BROADCAST=""
            shift
            ;;
        *)
            echo "unknown option: $1"
            exit 1
            ;;
    esac
done

VERIFY_FLAG=""

case $NETWORK in
    "anvil")
        RPC_URL="$ANVIL_RPC_URL"
        ACCOUNT="$ANVIL_ACCOUNT"
        SENDER="${ANVIL_SENDER:-}"
        ;;
    "sepolia")
        RPC_URL="$SEPOLIA_RPC_URL"
        ACCOUNT="$SEPOLIA_ACCOUNT"
        SENDER="${SEPOLIA_SENDER:-}"
        if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
            VERIFY_FLAG="--verify --verifier etherscan --etherscan-api-key $ETHERSCAN_API_KEY"
        else
            echo "Note: ETHERSCAN_API_KEY unset — skipping contract verification."
        fi
        ;;
    "base-sepolia" | "base")
        echo "Error: '$NETWORK' is configured but nothing has ever been deployed there."
        echo "       ZKTCore calls the tawf-gov DAO contracts synchronously, so the"
        echo "       whole stack must live on one chain. Deploy tawf-gov there first"
        echo "       (lib/tawf-gov/gov/script/DeployTawfSystem.s.sol), then set the"
        echo "       TAWF_* vars in .env before using this script."
        exit 1
        ;;
    *)
        echo "Error: unsupported network '$NETWORK' (use: sepolia | anvil)"
        exit 1
        ;;
esac

# V10Deploy reads the pre-deployed tawf-gov addresses from the environment.
REQUIRED_VARS=(
    TAWF_PASSPORT TAWF_REPUTATION TAWF_VOTING_NFT TAWF_RECEIPT_NFT TAWF_IDRX
    TAWF_PROPOSAL_MANAGER TAWF_VOTING_MANAGER TAWF_MILESTONE_MANAGER
    TAWF_PARTICIPATION_TRACKER TAWF_POOL_MANAGER TAWF_ZAKAT_ESCROW
    CORE_TEAM_ADDRESS
)
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        MISSING+=("$var")
    fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
    echo "Error: V10Deploy needs these unset .env vars: ${MISSING[*]}"
    echo "       They are the addresses of the already-deployed tawf-gov contracts."
    exit 1
fi

if ! cast wallet list | grep -q "$ACCOUNT"; then
    echo "$ACCOUNT not created yet, creating..."
    cast wallet import "$ACCOUNT" --interactive
fi

SENDER_FLAG=""
[ -n "$SENDER" ] && SENDER_FLAG="--sender $SENDER"

echo "Deploying V10 (ZK layer) to $NETWORK ..."
# shellcheck disable=SC2086
forge script script/V10Deploy.s.sol \
    --rpc-url "$RPC_URL" \
    --account "$ACCOUNT" \
    $SENDER_FLAG \
    $BROADCAST \
    $VERIFY_FLAG
