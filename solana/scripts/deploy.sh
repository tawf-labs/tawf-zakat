#!/bin/bash
set -e

echo "=== ZKT-Hackathon Solana Deploy ==="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v solana &> /dev/null; then
    echo "ERROR: solana CLI not found. Install: sh -c '$(curl -sSfL https://release.anza.xyz/v3.1.10/install)'"
    exit 1
fi

if ! command -v anchor &> /dev/null; then
    echo "ERROR: anchor CLI not found. Install: cargo install --git https://github.com/solana-foundation/anchor avm && avm install 1.0.2"
    exit 1
fi

if ! command -v arcium &> /dev/null; then
    echo "ERROR: arcium CLI not found. Install: curl -sSfL https://install.arcium.com/ | bash"
    exit 1
fi

ANCHOR_VERSION=$(anchor --version 2>&1)
if [[ "$ANCHOR_VERSION" != *"1.0.2"* ]]; then
    echo "WARNING: Expected anchor 1.0.2, got $ANCHOR_VERSION"
fi

echo "  solana: $(solana --version)"
echo "  anchor: $ANCHOR_VERSION"
echo "  arcium: $(arcium --version)"
echo ""

# Network selection
NETWORK="${1:-devnet}"
case "$NETWORK" in
    localnet)
        SOLANA_URL="http://localhost:8899"
        echo "Deploying to LOCALNET..."
        ;;
    devnet)
        SOLANA_URL="https://api.devnet.solana.com"
        echo "Deploying to DEVNET..."
        ;;
    mainnet)
        SOLANA_URL="https://api.mainnet-beta.solana.com"
        echo "WARNING: Deploying to MAINNET!"
        read -p "Are you sure? (y/N): " confirm
        [[ "$confirm" != "y" ]] && exit 0
        ;;
    *)
        echo "Usage: $0 [localnet|devnet|mainnet]"
        exit 1
        ;;
esac

# Set cluster
solana config set --url "$SOLANA_URL" 2>&1 | tail -1

# Build all programs
echo ""
echo "Building programs..."
arcium build 2>&1 | tail -3

# Deploy to selected network
echo ""
echo "Deploying to $NETWORK..."

if [ "$NETWORK" = "localnet" ]; then
    # Start local validator if not running
    if ! solana cluster-version &>/dev/null; then
        echo "Starting local validator..."
        nohup solana-test-validator --reset --quiet > /tmp/validator.log 2>&1 &
        sleep 10
    fi

    # Airdrop for deployment
    DEPLOY_WALLET="${SOLANA_DEPLOY_KEYPAIR:-~/.config/solana/id.json}"
    solana config set --keypair "$DEPLOY_WALLET" --url localhost 2>&1 | tail -1
    solana airdrop 100 2>&1 | tail -1

    # Deploy all programs
    anchor deploy 2>&1 | tail -3
    echo "Localnet deploy complete!"
else
    echo "Deploying to $NETWORK requires your keypair at ~/.config/solana/id.json"
    echo "Run: anchor deploy --provider.cluster $NETWORK"
    echo ""
    echo "Or for specific programs:"
    echo "  anchor deploy -p zkt-core"
    echo "  anchor deploy -p zkt_hackathon_solana"
fi

echo ""
echo "=== MXE Deployment ==="
echo ""
echo "Arcium MXEs require Docker for local MPC cluster."
echo "To deploy MXEs to devnet:"
echo ""
echo "  1. Start Docker: sudo systemctl start docker"
echo "  2. Deploy MXE: arcium deploy --cluster devnet"
echo "  3. Init computation definitions:"
echo "     - initZkatEligibilityCompDef()"
echo "     - initVoteAggregationCompDef()"
echo "     - initPrivateDonationCompDef()"
echo ""
echo "=== Program IDs ==="
echo ""

# Print all program IDs
if [ -f target/deploy/zkt_core-keypair.json ]; then
    echo "zkt-core:             $(solana address -k target/deploy/zkt_core-keypair.json)"
fi
if [ -f target/deploy/zkt_hackathon_solana-keypair.json ]; then
    echo "zkt_hackathon_solana: $(solana address -k target/deploy/zkt_hackathon_solana-keypair.json)"
fi

echo ""
echo "=== Deploy Complete ==="
