// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.31;

/**
 * @title ZKVerifier
 * @notice Proof-hash anchoring and nullifier registry. NOT a proof verifier.
 *
 * @dev  ############################################################
 *       #  THIS CONTRACT PERFORMS NO CRYPTOGRAPHIC VERIFICATION.   #
 *       #  verify() fails closed and always returns false.         #
 *       #  Use anchorProof() for the bookkeeping this can do.      #
 *       ############################################################
 *
 *       History: this contract was previously documented as a "Real UltraHONK
 *       proof verifier" and its verify() returned true for ANY input — the
 *       proof bytes were never inspected beyond keccak256, so an empty proof
 *       was accepted. It was deployed as the _honkVerifier in the V9 stack,
 *       which means the end-to-end donateZK benchmark recorded against V9
 *       (benchmarks/sepolia-donatezk-gas.txt) proved nothing.
 *
 *       What it can legitimately do: record that a given proof blob was seen
 *       and that a nullifier was spent, preventing replay of the SAME blob.
 *       That is replay protection, not soundness — it says nothing about
 *       whether the proof was ever valid.
 *
 *       Real on-chain UltraHONK verification is blocked on code size: the
 *       Barretenberg-generated verifier (sc/script/artifacts/HonkVerifier.json)
 *       is 33,880 bytes of deployed bytecode against the EIP-170 limit of
 *       24,576. It requires splitting or a proxy/delegatecall layout.
 */
contract ZKVerifier {
    mapping(bytes32 => bool) public verifiedProofs;
    mapping(bytes32 => bool) public spentNullifiers;

    event ProofAnchored(bytes32 indexed proofHash, bytes32 indexed nullifier);

    /**
     * @notice Whether this contract can actually verify proofs.
     * @dev Always false. See the contract header.
     */
    function isOperational() external pure returns (bool) {
        return false;
    }

    /**
     * @notice Verification entrypoint — FAILS CLOSED.
     * @dev Returns false unconditionally. This contract cannot verify an
     *      UltraHONK proof; returning false ensures no caller mistakes
     *      "unimplemented" for "valid". Kept for ABI compatibility with
     *      IHonkVerifier so legacy call sites get a safe answer.
     * @return Always false.
     */
    function verify(bytes calldata, /* proof */ bytes32[] calldata /* publicInputs */)
        external pure returns (bool) {
        return false;
    }

    /**
     * @notice Record a proof blob and burn its nullifier.
     * @dev Replay protection ONLY — this does not validate the proof. Reverts
     *      if the blob or the nullifier has been seen before.
     * @param proof The proof bytes, hashed for identity.
     * @param publicInputs Public inputs; index 5 is the nullifier.
     */
    function anchorProof(bytes calldata proof, bytes32[] calldata publicInputs) external {
        require(publicInputs.length > 5, "publicInputs too short");

        bytes32 proofHash = keccak256(proof);
        bytes32 nullifier = publicInputs[5];

        require(!verifiedProofs[proofHash], "Proof already used");
        require(!spentNullifiers[nullifier], "Nullifier already spent");

        verifiedProofs[proofHash] = true;
        spentNullifiers[nullifier] = true;

        emit ProofAnchored(proofHash, nullifier);
    }

    /**
     * @notice Whether a proof blob has been anchored.
     * @dev Anchored means "seen", not "valid".
     */
    function isAnchored(bytes32 proofHash) external view returns (bool) {
        return verifiedProofs[proofHash];
    }

    /// @dev Deprecated alias for isAnchored. The old name implied verification.
    function isVerified(bytes32 proofHash) external view returns (bool) {
        return verifiedProofs[proofHash];
    }
}
