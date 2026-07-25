// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.31;
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@tawf-gov/interfaces/IProposalManager.sol";
import "@tawf-gov/governance/ProposalManager.sol";
import "../verifiers/Groth16Verifier.sol";

/**
 * @title ShariaReviewManager
 * @notice Handles Sharia council review and bundling of proposals with ZK proof verification
 * @dev Council members vote off-chain, coordinator generates Groth16 proof, anyone submits on-chain
 */
contract ShariaReviewManager is AccessControl {
    bytes32 public constant SHARIA_COUNCIL_ROLE = keccak256("SHARIA_COUNCIL_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    ProposalManager public proposalManager;
    Groth16Verifier public groth16Verifier;
    
    struct ShariaReviewBundle {
        uint256 bundleId;
        uint256[] proposalIds;
        uint256 submittedAt;
        bool finalized;
        uint256 approvalCount;
    }

    // ZK Proof specific state
    uint256 public councilMerkleRoot;           // Merkle root of council membership
    uint256 public nullifierMerkleRoot;         // Merkle root of spent nullifiers
    mapping(bytes32 => bool) public usedProofCommitments;  // Proof replay protection

    uint256 public bundleCount;
    uint256 public shariaQuorumRequired = 3;
    uint256 public constant BUNDLE_THRESHOLD = 5;
    uint256 public constant BUNDLE_TIME_THRESHOLD = 7 days;
    uint256 public lastBundleTime;

    mapping(uint256 => ShariaReviewBundle) public shariaBundles;
    mapping(uint256 => mapping(uint256 => bool)) public bundleProposalApproved;
    mapping(uint256 => mapping(uint256 => IProposalManager.CampaignType)) public bundleProposalType;
    mapping(uint256 => mapping(uint256 => bytes32)) public shariaReviewProofs;
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) public shariaVotes;

    // Track ZK proof verification status per bundle and proposal
    mapping(uint256 => mapping(uint256 => bool)) public bundleProofVerified;
    mapping(uint256 => mapping(uint256 => uint256)) public bundleApprovalCount;
    
    event ShariaReviewBundleCreated(uint256 indexed bundleId, uint256[] proposalIds);
    event ProposalShariaApproved(uint256 indexed proposalId, IProposalManager.CampaignType campaignType);
    event ProposalShariaRejected(uint256 indexed proposalId);
    event ShariaBundleFinalized(uint256 indexed bundleId);

    // ZK Proof events
    event ShariaProofSubmitted(
        uint256 indexed bundleId,
        uint256 indexed proposalId,
        uint256 approvalCount,
        address indexed submitter
    );
    event CouncilRootUpdated(uint256 newRoot);
    event NullifierRootUpdated(uint256 newRoot);
    event ProofVerificationFailed(uint256 indexed bundleId, uint256 indexed proposalId, string reason);

    constructor(address _proposalManager, address _groth16Verifier) {
        require(_proposalManager != address(0), "Invalid proposal manager");
        require(_groth16Verifier != address(0), "Invalid verifier");

        proposalManager = ProposalManager(_proposalManager);
        groth16Verifier = Groth16Verifier(_groth16Verifier);
        lastBundleTime = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    function checkAndCreateBundle() external {
        uint256 proposalCount = proposalManager.proposalCount();
        uint256[] memory passedProposals = new uint256[](proposalCount);
        uint256 passedCount = 0;
        
        for (uint256 i = 1; i <= proposalCount; i++) {
            IProposalManager.Proposal memory proposal = proposalManager.getProposal(i);
            if (proposal.status == IProposalManager.ProposalStatus.CommunityPassed) {
                passedProposals[passedCount] = i;
                passedCount++;
            }
        }
        
        bool countThresholdMet = passedCount >= BUNDLE_THRESHOLD;
        bool timeThresholdMet = block.timestamp >= lastBundleTime + BUNDLE_TIME_THRESHOLD;
        
        if ((countThresholdMet || timeThresholdMet) && passedCount > 0) {
            uint256[] memory bundleProposals = new uint256[](passedCount);
            for (uint256 i = 0; i < passedCount; i++) {
                bundleProposals[i] = passedProposals[i];
            }
            
            _createShariaReviewBundle(bundleProposals);
        }
    }
    
    function createShariaReviewBundle(uint256[] memory proposalIds) 
        external 
        onlyRole(ADMIN_ROLE) 
        returns (uint256) 
    {
        return _createShariaReviewBundle(proposalIds);
    }
    
    function _createShariaReviewBundle(uint256[] memory proposalIds) 
        internal 
        returns (uint256) 
    {
        require(proposalIds.length > 0, "No proposals to bundle");
        
        for (uint256 i = 0; i < proposalIds.length; i++) {
            IProposalManager.Proposal memory proposal = proposalManager.getProposal(proposalIds[i]);
            require(
                proposal.status == IProposalManager.ProposalStatus.CommunityPassed,
                "Proposal not passed"
            );
        }
        
        bundleCount++;
        uint256 bundleId = bundleCount;
        
        ShariaReviewBundle storage bundle = shariaBundles[bundleId];
        bundle.bundleId = bundleId;
        bundle.proposalIds = proposalIds;
        bundle.submittedAt = block.timestamp;
        bundle.finalized = false;
        
        for (uint256 i = 0; i < proposalIds.length; i++) {
            IProposalManager.Proposal memory prop = proposalManager.getProposal(proposalIds[i]);
            proposalManager.updateProposalStatus(
                proposalIds[i], 
                IProposalManager.ProposalStatus.ShariaReview,
                prop.votesFor,
                prop.votesAgainst,
                prop.votesAbstain
            );
        }
        
        lastBundleTime = block.timestamp;
        
        emit ShariaReviewBundleCreated(bundleId, proposalIds);
        
        return bundleId;
    }
    
    function reviewProposal(
        address reviewer,
        uint256 bundleId,
        uint256 proposalId,
        bool approved,
        IProposalManager.CampaignType campaignType,
        bytes32 mockZKReviewProof
    ) external onlyRole(SHARIA_COUNCIL_ROLE) {
        ShariaReviewBundle storage bundle = shariaBundles[bundleId];
        
        require(!bundle.finalized, "Bundle already finalized");
        require(_isProposalInBundle(bundleId, proposalId), "Proposal not in bundle");
        require(
            !shariaVotes[bundleId][reviewer][proposalId],
            "Already voted on this proposal"
        );
        
        shariaVotes[bundleId][reviewer][proposalId] = true;
        shariaReviewProofs[bundleId][proposalId] = mockZKReviewProof;
        
        if (approved) {
            bundleProposalApproved[bundleId][proposalId] = true;
            bundleProposalType[bundleId][proposalId] = campaignType;
        }
    }
    
    function finalizeShariaBundle(uint256 bundleId) external onlyRole(SHARIA_COUNCIL_ROLE) {
        ShariaReviewBundle storage bundle = shariaBundles[bundleId];
        
        require(!bundle.finalized, "Bundle already finalized");
        
        bundle.finalized = true;
        
        for (uint256 i = 0; i < bundle.proposalIds.length; i++) {
            uint256 proposalId = bundle.proposalIds[i];
            
            uint256 approvalVotes = _countShariaApprovalVotes(bundleId, proposalId);
            
            if (approvalVotes >= shariaQuorumRequired) {
                IProposalManager.CampaignType cType = bundleProposalType[bundleId][proposalId];
                proposalManager.updateProposalStatus(proposalId, IProposalManager.ProposalStatus.ShariaApproved, 0, 0, 0);
                proposalManager.updateProposalCampaignType(proposalId, cType);
                
                emit ProposalShariaApproved(proposalId, cType);
            } else {
                proposalManager.updateProposalStatus(proposalId, IProposalManager.ProposalStatus.ShariaRejected, 0, 0, 0);
                emit ProposalShariaRejected(proposalId);
            }
        }
        
        emit ShariaBundleFinalized(bundleId);
    }
    
    function _countShariaApprovalVotes(uint256 bundleId, uint256 proposalId)
        internal
        view
        returns (uint256)
    {
        // Use the approval count from ZK proof if verified
        if (bundleProofVerified[bundleId][proposalId]) {
            return bundleApprovalCount[bundleId][proposalId];
        }
        // Fallback to legacy behavior for backward compatibility
        if (!bundleProposalApproved[bundleId][proposalId]) {
            return 0;
        }
        return shariaQuorumRequired; // Simplified for MVP
    }
    
    function _isProposalInBundle(uint256 bundleId, uint256 proposalId) 
        internal 
        view 
        returns (bool) 
    {
        uint256[] memory proposalIds = shariaBundles[bundleId].proposalIds;
        for (uint256 i = 0; i < proposalIds.length; i++) {
            if (proposalIds[i] == proposalId) {
                return true;
            }
        }
        return false;
    }
    
    function setShariaQuorum(uint256 _quorum) external onlyRole(ADMIN_ROLE) {
        shariaQuorumRequired = _quorum;
    }
    
    function getBundle(uint256 bundleId) external view returns (ShariaReviewBundle memory) {
        return shariaBundles[bundleId];
    }

    // ============ ZK Proof Functions ============

    /**
     * @notice Internal function to verify and process a ZK proof
     * @dev Shared logic for single and batch proof submission
     * @param bundleId Bundle being reviewed
     * @param proposalId Proposal being reviewed
     * @param approvalCount Number of approve votes (must match proof)
     * @param campaignType Type of campaign (ZakatCompliant, Normal, Emergency)
     * @param proof Groth16 proof structure
     * @param submitter Address submitting the proof (for event emission)
     * @return success True if proof was verified and accepted
     */
    function _verifyAndProcessProof(
        uint256 bundleId,
        uint256 proposalId,
        uint256 approvalCount,
        IProposalManager.CampaignType campaignType,
        Groth16Proof calldata proof,
        address submitter
    ) internal returns (bool success) {
        ShariaReviewBundle storage bundle = shariaBundles[bundleId];
        require(bundle.bundleId == bundleId, "Bundle does not exist");
        require(!bundle.finalized, "Bundle already finalized");
        require(_isProposalInBundle(bundleId, proposalId), "Proposal not in bundle");
        require(!bundleProofVerified[bundleId][proposalId], "Proof already verified");

        // Verify the proof commitment hasn't been used (replay protection)
        bytes32 proofCommitment = keccak256(abi.encodePacked(
            proof.pi_a,
            proof.pi_b,
            proof.pi_c,
            bundleId,
            proposalId
        ));
        require(!usedProofCommitments[proofCommitment], "Proof already used");
        usedProofCommitments[proofCommitment] = true;

        // Verify the Groth16 proof
        bool proofValid = groth16Verifier.verifyAndValidate(
            proof,
            bundleId,
            proposalId,
            approvalCount,
            shariaQuorumRequired,
            councilMerkleRoot
        );

        if (!proofValid) {
            emit ProofVerificationFailed(bundleId, proposalId, "Invalid proof");
            return false;
        }

        // Store the verified approval data
        bundleProofVerified[bundleId][proposalId] = true;
        bundleApprovalCount[bundleId][proposalId] = approvalCount;

        // Mark as approved if quorum met
        if (approvalCount >= shariaQuorumRequired) {
            bundleProposalApproved[bundleId][proposalId] = true;
            bundleProposalType[bundleId][proposalId] = campaignType;
        }

        emit ShariaProofSubmitted(bundleId, proposalId, approvalCount, submitter);
        return true;
    }

    /**
     * @notice Submit a ZK proof for Sharia council approval
     * @dev RESTRICTED to SHARIA_COUNCIL_ROLE.
     *
     *      This was previously permissionless, on the theory that a valid ZK
     *      proof is self-authenticating so the caller doesn't matter. That
     *      reasoning is sound only when the verifier actually verifies. With
     *      Groth16Verifier failing closed (and, before that, returning true
     *      unconditionally), permissionless submission meant any address could
     *      set bundleProofVerified = true with a caller-chosen approvalCount
     *      and drive a proposal to ShariaApproved.
     *
     *      Keep this gated until Groth16Verifier.isOperational() returns true.
     * @param bundleId Bundle being reviewed
     * @param proposalId Proposal being reviewed
     * @param approvalCount Number of approve votes (must match proof)
     * @param campaignType Type of campaign (ZakatCompliant, Normal, Emergency)
     * @param proof Groth16 proof structure
     * @return success True if proof was verified and accepted
     */
    function submitShariaReviewProof(
        uint256 bundleId,
        uint256 proposalId,
        uint256 approvalCount,
        IProposalManager.CampaignType campaignType,
        Groth16Proof calldata proof
    ) external onlyRole(SHARIA_COUNCIL_ROLE) returns (bool success) {
        return _verifyAndProcessProof(
            bundleId,
            proposalId,
            approvalCount,
            campaignType,
            proof,
            msg.sender
        );
    }

    /**
     * @notice Batch submit ZK proofs for multiple proposals in a bundle
     * @param bundleId Bundle being reviewed
     * @param proposalIds Array of proposal IDs
     * @param approvalCounts Array of approval counts
     * @param campaignTypes Array of campaign types
     * @param proofs Array of Groth16 proofs
     * @return successCount Number of successfully verified proofs
     * @dev RESTRICTED to SHARIA_COUNCIL_ROLE — see submitShariaReviewProof.
     */
    function batchSubmitShariaReviewProofs(
        uint256 bundleId,
        uint256[] calldata proposalIds,
        uint256[] calldata approvalCounts,
        IProposalManager.CampaignType[] calldata campaignTypes,
        Groth16Proof[] calldata proofs
    ) external onlyRole(SHARIA_COUNCIL_ROLE) returns (uint256 successCount) {
        require(proposalIds.length == approvalCounts.length, "Length mismatch");
        require(proposalIds.length == campaignTypes.length, "Length mismatch");
        require(proposalIds.length == proofs.length, "Length mismatch");

        ShariaReviewBundle storage bundle = shariaBundles[bundleId];
        require(bundle.bundleId == bundleId, "Bundle does not exist");
        require(!bundle.finalized, "Bundle already finalized");

        for (uint256 i = 0; i < proposalIds.length; i++) {
            if (bundleProofVerified[bundleId][proposalIds[i]]) {
                continue; // Skip already verified
            }

            if (_verifyAndProcessProof(
                bundleId,
                proposalIds[i],
                approvalCounts[i],
                campaignTypes[i],
                proofs[i],
                msg.sender
            )) {
                successCount++;
            }
        }
    }

    /**
     * @notice Set the council Merkle root (admin only)
     * @dev Should be updated when council membership changes
     * @param newRoot New Merkle root of council membership
     */
    function setCouncilMerkleRoot(uint256 newRoot) external onlyRole(ADMIN_ROLE) {
        councilMerkleRoot = newRoot;
        emit CouncilRootUpdated(newRoot);
    }

    /**
     * @notice Set the nullifier Merkle root (admin only)
     * @dev Should be updated periodically to include spent nullifiers
     * @param newRoot New Merkle root of nullifiers
     */
    function setNullifierMerkleRoot(uint256 newRoot) external onlyRole(ADMIN_ROLE) {
        nullifierMerkleRoot = newRoot;
        emit NullifierRootUpdated(newRoot);
    }

    /**
     * @notice Update the Groth16 verifier address (admin only)
     * @dev Use when updating the circuit or trusted setup
     * @param _verifier New verifier address
     */
    function setVerifier(address _verifier) external onlyRole(ADMIN_ROLE) {
        require(_verifier != address(0), "Invalid verifier");
        groth16Verifier = Groth16Verifier(_verifier);
    }

    /**
     * @notice Check if a proposal has a verified ZK proof
     * @param bundleId Bundle ID
     * @param proposalId Proposal ID
     * @return verified True if proof has been verified
     */
    function hasVerifiedProof(uint256 bundleId, uint256 proposalId)
        external
        view
        returns (bool verified)
    {
        return bundleProofVerified[bundleId][proposalId];
    }

    /**
     * @notice Get the approval count from a verified ZK proof
     * @param bundleId Bundle ID
     * @param proposalId Proposal ID
     * @return count Approval count from ZK proof
     */
    function getProofApprovalCount(uint256 bundleId, uint256 proposalId)
        external
        view
        returns (uint256 count)
    {
        require(bundleProofVerified[bundleId][proposalId], "No verified proof");
        return bundleApprovalCount[bundleId][proposalId];
    }
}
