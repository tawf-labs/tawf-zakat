// SPDX-License-Identifier: Apache-2.0
pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/switcher.circom";

/**
 * @title MerkleProof
 * @notice Verifies a Merkle proof using Poseidon hash
 * @dev Compatible with circomlib's Poseidon hash function
 *
 * @param treeDepth Depth of the Merkle tree
 *
 * Inputs:
 * - leaf: The leaf value to prove
 * - root: The Merkle root to verify against
 * - pathElements[treeDepth]: Sibling nodes at each level
 * - pathIndices[treeDepth]: Direction (0=left, 1=right) at each level
 *
 * Output:
 * - valid: 1 if proof is valid, 0 otherwise
 */
template MerkleProof(treeDepth) {
    signal input leaf;
    signal input root;
    signal input pathElements[treeDepth];
    signal input pathIndices[treeDepth];
    signal output valid;

    signal currentLevel[treeDepth + 1];
    currentLevel[0] <== leaf;

    component hash[treeDepth];
    component switcher[treeDepth];

    // Compute root from leaf and path
    for (var i = 0; i < treeDepth; i++) {
        // Use Switcher to swap based on index
        switcher[i] = Switcher();
        switcher[i].L <== currentLevel[i];
        switcher[i].R <== pathElements[i];
        switcher[i].sel <== pathIndices[i];

        hash[i] = Poseidon(2);
        hash[i].inputs[0] <== switcher[i].outL;
        hash[i].inputs[1] <== switcher[i].outR;

        currentLevel[i + 1] <== hash[i].out;

        // Ensure path indices are binary
        pathIndices[i] * (pathIndices[i] - 1) === 0;
    }

    // Verify computed root matches expected root
    signal isValid;
    isValid <== 1;

    // Force computed root to equal expected root
    currentLevel[treeDepth] === root;

    valid <== isValid;
}
