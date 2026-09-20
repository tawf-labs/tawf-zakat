pragma circom 2.1.6;

include "poseidon.circom";

// Merkle inclusion checker for depth 4 (16 leaves)
template MerkleTreeInclusion(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    signal current[levels + 1];
    signal left[levels];
    signal right[levels];
    current[0] <== leaf;

    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        // Enforce pathIndices are boolean (0 or 1)
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        hashers[i] = Poseidon(2);

        // If pathIndices[i] == 0: left = current[i], right = pathElements[i]
        // If pathIndices[i] == 1: left = pathElements[i], right = current[i]
        left[i] <== current[i] + pathIndices[i] * (pathElements[i] - current[i]);
        right[i] <== pathElements[i] + pathIndices[i] * (current[i] - pathElements[i]);

        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];

        current[i + 1] <== hashers[i].out;
    }

    root <== current[levels];
}

/**
 * ContributionMembership circuit (Spec #100, Issue #108)
 *
 * Proves that a private contribution is a member of an institution-endorsed
 * batch with root `batchRoot`, without revealing the donor's identity,
 * contribution amount, salt, or Merkle path to the public or EVM calldata.
 */
template ContributionMembership(levels) {
    // === PUBLIC SIGNALS ===
    signal input batchRoot;
    signal input receiptCommitment;
    signal input institutionKey;
    signal input contributionIdHash;
    signal input fundType;

    // === PRIVATE WITNESS INPUTS ===
    signal input amount;
    signal input salt;
    signal input purposeHash;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // 1. Compute private leaf hash: Poseidon(contributionIdHash, amount, salt, fundType, purposeHash)
    component leafHasher = Poseidon(5);
    leafHasher.inputs[0] <== contributionIdHash;
    leafHasher.inputs[1] <== amount;
    leafHasher.inputs[2] <== salt;
    leafHasher.inputs[3] <== fundType;
    leafHasher.inputs[4] <== purposeHash;

    signal leaf;
    leaf <== leafHasher.out;

    // 2. Verify public receipt commitment: Poseidon(institutionKey, contributionIdHash, leaf)
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== institutionKey;
    commitmentHasher.inputs[1] <== contributionIdHash;
    commitmentHasher.inputs[2] <== leaf;

    receiptCommitment === commitmentHasher.out;

    // 3. Verify Merkle tree membership to batchRoot
    component treeVerifier = MerkleTreeInclusion(levels);
    treeVerifier.leaf <== leaf;
    for (var i = 0; i < levels; i++) {
        treeVerifier.pathElements[i] <== pathElements[i];
        treeVerifier.pathIndices[i] <== pathIndices[i];
    }

    batchRoot === treeVerifier.root;
}

// Compile with depth = 4 (small batch of up to 16 contributions for pilot tracer)
component main {public [batchRoot, receiptCommitment, institutionKey, contributionIdHash, fundType]} = ContributionMembership(4);
