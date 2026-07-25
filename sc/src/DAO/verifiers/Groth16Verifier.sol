// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.31;

/**
 * @title Groth16Verifier
 * @notice FAIL-CLOSED PLACEHOLDER. This contract does NOT verify anything.
 *
 * @dev  ############################################################
 *       #  THIS IS NOT A WORKING VERIFIER.                         #
 *       #  Every verification entrypoint returns false.            #
 *       #  Any flow gated on it is inert by design.                #
 *       ############################################################
 *
 *       History: this file previously returned `true` unconditionally while
 *       being wired into ShariaReviewManager as the Sharia council's proof
 *       check. Combined with a permissionless submit entrypoint, that allowed
 *       anyone to stamp a proposal as Sharia-approved using arbitrary bytes.
 *       It now fails closed so that "not implemented" can never be mistaken
 *       for "verified".
 *
 *       To make this real:
 *         1. cd circuits && npx snarkjs zkey export solidityverifier \
 *              build/sharia_final.zkey Groth16Verifier_Prod.sol
 *         2. Replace this contract's body with the generated pairing check.
 *         3. NOTE the arity mismatch that must be resolved first: the compiled
 *            circuit has nPublic = 7 (see circuits/build/verification_key.json),
 *            but IShariaVoteAggregatorVerifier below declares uint256[6]. The
 *            7th signal is the Poseidon bundleProposalHash output. A generated
 *            verifier will expect uint[7].
 *         4. verifyAndValidate() currently hardcodes nullifierRoot = 0; the
 *            circuit treats it as a real public input. That must be plumbed
 *            through before the pairing check will ever succeed.
 *
 *       Public inputs order for ShariaVoteAggregator:
 *         1. bundleId   2. proposalId  3. approvalCount  4. quorumThreshold
 *         5. councilRoot  6. nullifierRoot  7. bundleProposalHash (output)
 */

/**
 * @dev Struct representing a Groth16 proof
 */
struct Groth16Proof {
    uint256[2] pi_a;      // First G1 point (A)
    uint256[2][2] pi_b;   // G2 point (B) - 2 points with 2 coordinates each
    uint256[2] pi_c;      // Second G1 point (C)
}

/**
 * @title IShariaVoteAggregatorVerifier
 * @notice Interface for the Groth16 verifier
 * @dev The uint256[6] arity here is stale relative to the compiled circuit
 *      (nPublic = 7). See the note in the file header.
 */
interface IShariaVoteAggregatorVerifier {
    /**
     * @notice Verify a Groth16 proof
     * @param pi_a Proof A point
     * @param pi_b Proof B points (G2)
     * @param pi_c Proof C point
     * @param publicInputs Array of public inputs
     * @return True if proof is valid
     */
    function verifyProof(
        uint256[2] calldata pi_a,
        uint256[2][2] calldata pi_b,
        uint256[2] calldata pi_c,
        uint256[6] calldata publicInputs
    ) external pure returns (bool);
}

/**
 * @title Groth16Verifier
 * @notice Fail-closed stand-in for the Sharia council ZK proof verifier.
 * @dev Every entrypoint returns false. Callers must treat a false result as
 *      "verification unavailable", not as "proof rejected" — the two are
 *      indistinguishable from this contract and will remain so until a real
 *      pairing check is generated. Use isOperational() to tell them apart.
 */
contract Groth16Verifier is IShariaVoteAggregatorVerifier {
    /**
     * @notice Whether this verifier can actually verify proofs.
     * @dev Always false for this placeholder. A real generated verifier should
     *      return true. Deployment scripts and monitoring should assert on this
     *      rather than assuming a deployed verifier is a working one.
     */
    function isOperational() external pure returns (bool) {
        return false;
    }

    /// @inheritdoc IShariaVoteAggregatorVerifier
    function verifyProof(
        uint256[2] calldata, /* pi_a */
        uint256[2][2] calldata, /* pi_b */
        uint256[2] calldata, /* pi_c */
        uint256[6] calldata /* publicInputs */
    ) external pure returns (bool) {
        return false;
    }

    /**
     * @notice Verify a Sharia review proof with full validation
     * @dev Fails closed. The quorum comparison that used to live here was
     *      operating on a caller-supplied approvalCount with no cryptographic
     *      backing, so it is deliberately not reachable any more.
     * @return valid Always false.
     */
    function verifyAndValidate(
        Groth16Proof calldata proof,
        uint256 bundleId,
        uint256 proposalId,
        uint256 approvalCount,
        uint256 quorumThreshold,
        uint256 councilRoot
    ) external pure returns (bool valid) {
        return _verifyShariaReviewProof(
            proof,
            bundleId,
            proposalId,
            approvalCount,
            quorumThreshold,
            councilRoot,
            0 // nullifierRoot - not plumbed through; see file header
        );
    }

    /**
     * @notice Batch verify multiple Sharia review proofs
     * @dev Fails closed. Length checks are retained so callers still get a
     *      clear revert on malformed input rather than a bare false.
     * @return allValid Always false.
     */
    function batchVerify(
        Groth16Proof[] calldata proofs,
        uint256[] calldata bundleIds,
        uint256[] calldata proposalIds,
        uint256[] calldata approvalCounts,
        uint256 quorumThreshold,
        uint256 councilRoot
    ) external pure returns (bool allValid) {
        require(proofs.length == bundleIds.length, "Length mismatch");
        require(proofs.length == proposalIds.length, "Length mismatch");
        require(proofs.length == approvalCounts.length, "Length mismatch");
        return false;
    }

    /**
     * @notice Verify a Sharia review proof
     * @return Always false.
     */
    function verifyShariaReviewProof(
        Groth16Proof calldata proof,
        uint256 bundleId,
        uint256 proposalId,
        uint256 approvalCount,
        uint256 quorumThreshold,
        uint256 councilRoot,
        uint256 nullifierRoot
    ) external pure returns (bool) {
        return _verifyShariaReviewProof(
            proof,
            bundleId,
            proposalId,
            approvalCount,
            quorumThreshold,
            councilRoot,
            nullifierRoot
        );
    }

    /**
     * @notice Internal proof verification.
     * @dev NOT IMPLEMENTED. Returns false so that no caller can ever mistake
     *      an unimplemented check for a successful one. Replace with the
     *      snarkjs-generated pairing check to make this real.
     */
    function _verifyShariaReviewProof(
        Groth16Proof calldata, /* proof */
        uint256, /* bundleId */
        uint256, /* proposalId */
        uint256, /* approvalCount */
        uint256, /* quorumThreshold */
        uint256, /* councilRoot */
        uint256  /* nullifierRoot */
    ) internal pure returns (bool) {
        return false;
    }
}
