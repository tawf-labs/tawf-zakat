// SPDX-License-Identifier: Apache-2.0
pragma circom 2.0.0;

include "./components/VoteCounter.circom";
include "./components/MerkleProof.circom";
include "./components/Nullifier.circom";
include "./node_modules/circomlib/circuits/poseidon.circom";
include "./node_modules/circomlib/circuits/comparators.circom";

/**
 * @title ShariaVoteAggregator
 * @notice Groth16 circuit for aggregating Sharia council votes off-chain
 * @dev Proves that for a given bundle and proposal, approvalCount >= quorumThreshold
 *      while keeping individual votes private.
 *
 * Security properties:
 * - Vote privacy: individual votes are private inputs
 * - Council membership: each voter is proven to be in the council Merkle tree
 * - Nullifier binding: each voter's nullifier prevents double-voting
 * - Quorum enforcement: approvalCount >= quorumThreshold enforced via LessEqThan
 * - Binding hash: bundleId + proposalId bound via Poseidon (collision-resistant)
 *
 * Parameters:
 * - N_COUNCIL: Number of Sharia council members (5)
 * - TREE_DEPTH: Merkle tree depth (3 -> supports up to 8 leaves)
 */
template ShariaVoteAggregator(N_COUNCIL, TREE_DEPTH) {
    // ========== Private Inputs (Witness) ==========

    // Individual votes from each council member (0 or 1)
    signal input councilMemberVote[N_COUNCIL];

    // Member identity commitments (Poseidon hash of member address + secret)
    signal input memberCommitment[N_COUNCIL];

    // Nullifiers to prevent double-voting (Poseidon(secret, bundleId, proposalId))
    signal input voteNullifier[N_COUNCIL];

    // Merkle proof paths for council membership verification
    signal input merkleProofElements[N_COUNCIL][TREE_DEPTH];

    // Merkle proof path indices (0 = left sibling, 1 = right sibling)
    signal input merkleProofPathIndices[N_COUNCIL][TREE_DEPTH];

    // ========== Public Inputs ==========

    signal input bundleId;
    signal input proposalId;
    signal input approvalCount;
    signal input quorumThreshold;
    signal input councilRoot;
    signal input nullifierRoot;

    // ========== Internal Components ==========

    // Vote counting component
    component voteCounter = VoteCounter(N_COUNCIL);

    // Merkle proof verification for each council member
    component merkleVerifier[N_COUNCIL];
    component nullifierChecker[N_COUNCIL];

    // ========== Connect Vote Counter ==========

    signal countedVotes;

    for (var i = 0; i < N_COUNCIL; i++) {
        voteCounter.votes[i] <== councilMemberVote[i];

        // Enforce that votes are binary (0 or 1)
        councilMemberVote[i] * (councilMemberVote[i] - 1) === 0;
    }

    countedVotes <== voteCounter.totalVotes;

    // ========== Enforce Approval Count Matches ==========

    // The counted votes must equal the public approvalCount
    countedVotes === approvalCount;

    // ========== Enforce Quorum (FIX: use LessEqThan for range-safe comparison) ==========

    // Prove: quorumThreshold <= approvalCount
    // LessEqThan(n) checks a <= b where both are n-bit integers
    // N_COUNCIL is at most 5, so 4 bits suffice (supports 0-15)
    component quorumCheck = LessEqThan(4);
    quorumCheck.in[0] <== quorumThreshold;
    quorumCheck.in[1] <== approvalCount;
    // quorumCheck.out === 1 means quorumThreshold <= approvalCount
    quorumCheck.out === 1;

    // ========== Verify Council Membership & Nullifiers ==========

    signal membershipValid[N_COUNCIL];
    signal nullifierValid[N_COUNCIL];

    for (var i = 0; i < N_COUNCIL; i++) {
        // --- Merkle membership proof ---
        merkleVerifier[i] = MerkleProof(TREE_DEPTH);
        merkleVerifier[i].leaf <== memberCommitment[i];
        merkleVerifier[i].root <== councilRoot;

        for (var j = 0; j < TREE_DEPTH; j++) {
            merkleVerifier[i].pathElements[j] <== merkleProofElements[i][j];
            merkleVerifier[i].pathIndices[j]  <== merkleProofPathIndices[i][j];
        }

        // Membership proof is only required if vote == 1.
        // If vote == 0, membershipValid[i] = 0 * anything = 0 = councilMemberVote[i] => passes.
        // If vote == 1, membershipValid[i] = valid * 1 must equal 1.
        membershipValid[i] <== merkleVerifier[i].valid * councilMemberVote[i];
        membershipValid[i] === councilMemberVote[i];

        // --- Nullifier check ---
        nullifierChecker[i] = Nullifier();
        nullifierChecker[i].nullifier  <== voteNullifier[i];
        nullifierChecker[i].root       <== nullifierRoot;
        nullifierChecker[i].leafIndex  <== i;

        nullifierValid[i] <== nullifierChecker[i].valid * councilMemberVote[i];
        nullifierValid[i] === councilMemberVote[i];
    }

    // ========== Binding Hash: Poseidon(bundleId, proposalId) (FIX: replace multiplication) ==========

    // Use Poseidon hash instead of multiplication to achieve collision resistance.
    // bundleId=2,proposalId=6 and bundleId=3,proposalId=4 both multiply to 12,
    // but Poseidon(2,6) != Poseidon(3,4).
    component bindingHash = Poseidon(2);
    bindingHash.inputs[0] <== bundleId;
    bindingHash.inputs[1] <== proposalId;

    // Expose the binding hash as an output signal so on-chain verifier can cross-check
    signal output bundleProposalHash;
    bundleProposalHash <== bindingHash.out;
}

component main { public [bundleId, proposalId, approvalCount, quorumThreshold, councilRoot, nullifierRoot] } = ShariaVoteAggregator(5, 3);
