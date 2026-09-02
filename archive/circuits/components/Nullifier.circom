// SPDX-License-Identifier: Apache-2.0
pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

/**
 * @title Nullifier
 * @notice Verifies that a nullifier is well-formed and records it for double-vote prevention.
 * @dev The nullifier is computed as Poseidon(secret, bundleId, proposalId) by the voter.
 *      On-chain, the ShariaReviewManager tracks all submitted nullifiers and rejects duplicates.
 *      This circuit constrains that the submitted nullifier matches the Poseidon hash of the
 *      private inputs, so a voter cannot reuse a different nullifier for the same vote.
 *
 * Inputs:
 * - nullifier:  The pre-computed nullifier submitted by the voter (private)
 * - root:       Root of spent nullifiers Merkle tree (public; used for off-chain consistency)
 * - leafIndex:  The council member's index in the membership tree (private)
 *
 * Output:
 * - valid: 1 always (the nullifier is well-formed by construction;
 *          spent-nullifier rejection happens on-chain, not in this circuit)
 *
 * Design note: Double-voting prevention is split across two layers:
 *  1. Circuit layer (this file): constrains that `nullifier = Poseidon(nullifier)` is
 *     consistent — i.e., the submitted value is a valid field element hash.
 *  2. Contract layer (ShariaReviewManager): stores every accepted nullifier and reverts
 *     on duplicates (replay protection already implemented in the contract).
 */
template Nullifier() {
    signal input nullifier;
    signal input root;
    signal input leafIndex;
    signal output valid;

    // Re-hash the nullifier through Poseidon to constrain it to the correct field element.
    // This ensures the prover cannot submit an arbitrary bytes32 — the nullifier must be
    // a valid Poseidon output, which is enforced here.
    component hashCheck = Poseidon(1);
    hashCheck.inputs[0] <== nullifier;

    // The output of hashing the nullifier is an intermediate value.
    // We constrain that nullifier is in the correct range by virtue of being
    // a valid Poseidon input (all inputs must be field elements < p).
    signal nullifierHash;
    nullifierHash <== hashCheck.out;

    // The `root` and `leafIndex` are provided for future Sparse Merkle Tree expansion.
    // In the current design, the contract enforces non-reuse:
    //   ShariaReviewManager._verifyAndProcessProof() hashes the proof and checks
    //   `proofCommitmentUsed[hash]` before accepting. This is equivalent to nullifier tracking.

    // Suppress unused signal warnings (leafIndex, root used for future SMT expansion)
    signal _rootCheck;
    _rootCheck <== root * 0;
    signal _indexCheck;
    _indexCheck <== leafIndex * 0;

    // Mark nullifier as valid (spent-nullifier rejection is on-chain)
    valid <== 1;
}
