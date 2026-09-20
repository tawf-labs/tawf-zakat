#!/usr/bin/env bash
# Local development ceremony only. Never reuse this setup for production.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DIR/../.." && pwd)"
BUILD_DIR="$DIR/build"
if [[ "${1:-}" != "--new-local-setup" ]]; then
  cd "$DIR"
  sha256sum -c artifacts.sha256
  exit
fi
CIRCOM_BIN="${CIRCOM_BIN:-$HOME/.local/bin/circom}"
[[ "$("$CIRCOM_BIN" --version)" == "circom compiler 2.2.3" ]]
[[ "$(node --version)" == "v25.2.1" ]]
SNARKJS="$ROOT_DIR/backend/node_modules/snarkjs/build/cli.cjs"
mkdir -p "$BUILD_DIR"
"$CIRCOM_BIN" "$DIR/contribution_membership.circom" -l "$ROOT_DIR/backend/node_modules/circomlib/circuits" --r1cs --wasm --sym -o "$BUILD_DIR"
node "$SNARKJS" powersoftau new bn128 12 "$BUILD_DIR/pot12_0000.ptau"
# Entropy never persisted; this remains a single-operator trusted LOCAL setup.
node "$SNARKJS" powersoftau contribute "$BUILD_DIR/pot12_0000.ptau" "$BUILD_DIR/pot12_0001.ptau" --name="local-pilot-only" -e="$(openssl rand -hex 64)"
node "$SNARKJS" powersoftau prepare phase2 "$BUILD_DIR/pot12_0001.ptau" "$BUILD_DIR/pot12_final.ptau"
node "$SNARKJS" groth16 setup "$BUILD_DIR/contribution_membership.r1cs" "$BUILD_DIR/pot12_final.ptau" "$BUILD_DIR/circuit_0000.zkey"
node "$SNARKJS" zkey contribute "$BUILD_DIR/circuit_0000.zkey" "$BUILD_DIR/circuit_final.zkey" --name="local-pilot-only" -e="$(openssl rand -hex 64)"
node "$SNARKJS" zkey verify "$BUILD_DIR/contribution_membership.r1cs" "$BUILD_DIR/pot12_final.ptau" "$BUILD_DIR/circuit_final.zkey"
node "$SNARKJS" zkey export verificationkey "$BUILD_DIR/circuit_final.zkey" "$BUILD_DIR/verification_key.json"
node "$SNARKJS" zkey export solidityverifier "$BUILD_DIR/circuit_final.zkey" "$DIR/../src/Groth16Verifier.sol"
rm -f "$BUILD_DIR/pot12_0000.ptau" "$BUILD_DIR/pot12_0001.ptau" "$BUILD_DIR/circuit_0000.zkey"
cd "$DIR"
sha256sum contribution_membership.circom build/contribution_membership_js/contribution_membership.wasm build/circuit_final.zkey build/verification_key.json ../src/Groth16Verifier.sol > artifacts.sha256
bun "$ROOT_DIR/backend/src/scripts/zk-fixture.ts"
sha256sum contribution_membership.circom build/contribution_membership_js/contribution_membership.wasm build/circuit_final.zkey build/verification_key.json ../src/Groth16Verifier.sol ../test/ContributionProofFixture.sol > artifacts.sha256
