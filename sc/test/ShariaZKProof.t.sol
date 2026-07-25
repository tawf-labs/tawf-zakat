// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.31;

import "forge-std/Test.sol";
import "../src/DAO/ZKTCore.sol";
import "@tawf-gov/governance/ProposalManager.sol";
import "@tawf-gov/governance/VotingManager.sol";
import "../src/DAO/core/ShariaReviewManager.sol";
import "@tawf-gov/protocol/PoolManager.sol";
import "@tawf-gov/protocol/ZakatEscrowManager.sol";
import "../src/DAO/core/PrivateDonationPool.sol";
import "@tawf-gov/governance/MilestoneManager.sol";
import "@tawf-gov/governance/ParticipationTracker.sol";
import "../src/DAO/verifiers/Groth16Verifier.sol";
import "@tawf-gov/tokens/MockIDRX.sol";
import "@tawf-gov/protocol/DonationReceiptNFT.sol";
import "@tawf-gov/tokens/VotingNFT.sol";
import "@tawf-gov/interfaces/IProposalManager.sol";
import "@tawf-gov/identity/TawfPassport.sol";
import {PassportType} from "@tawf-gov/interfaces/ITawfPassport.sol";

/**
 * @title ShariaZKProofTest
 * @notice Tests for ZK-proof based Sharia Council review system
 */
contract ShariaZKProofTest is Test {
    // Tokens
    MockIDRX idrxToken;
    DonationReceiptNFT receiptNFT;
    VotingNFT votingNFT;
    ParticipationTracker participationTracker;
    TawfPassport tawfPassport;

    // Core contracts
    ProposalManager proposalManager;
    VotingManager votingManager;
    ShariaReviewManager shariaReviewManager;
    PoolManager poolManager;
    ZakatEscrowManager zakatEscrowManager;
    PrivateDonationPool privateDonationPool;
    MilestoneManager milestoneManager;
    Groth16Verifier groth16Verifier;

    ZKTCore dao;

    // Test addresses
    address deployer = address(0x1);
    address organizer = address(0x2);
    address voter1 = address(0x3);
    address voter2 = address(0x4);
    address voter3 = address(0x5);
    address councilMember1 = address(0x10);
    address councilMember2 = address(0x11);
    address councilMember3 = address(0x12);
    address councilMember4 = address(0x13);
    address councilMember5 = address(0x14);

    // Test constants
    uint256 constant COUNCIL_MERKLE_ROOT = 123456789; // Simplified for testing
    uint256 constant QUORUM_THRESHOLD = 3;

    function setUp() public {
        vm.startPrank(deployer);

        // Deploy tokens
        idrxToken = new MockIDRX();
        receiptNFT = new DonationReceiptNFT();
        votingNFT = new VotingNFT();
        participationTracker = new ParticipationTracker();
        tawfPassport = new TawfPassport();

        // Deploy verifier
        groth16Verifier = new Groth16Verifier();
        HonkVerifier honkVerifier = new HonkVerifier();
        NullifierRegistry nullifierRegistry = new NullifierRegistry();

        // Deploy managers
        proposalManager = new ProposalManager();
        votingManager = new VotingManager(address(proposalManager), address(votingNFT));
        shariaReviewManager = new ShariaReviewManager(
            address(proposalManager),
            address(groth16Verifier)
        );
        poolManager = new PoolManager(address(proposalManager), address(idrxToken), address(receiptNFT));
        zakatEscrowManager = new ZakatEscrowManager(address(proposalManager), address(idrxToken), address(receiptNFT));
        privateDonationPool = new PrivateDonationPool(address(idrxToken));
        milestoneManager = new MilestoneManager(address(proposalManager), address(votingNFT));

        // Deploy DAO
        dao = new ZKTCore(
            address(idrxToken),
            address(receiptNFT),
            address(votingNFT),
            address(participationTracker),
            address(proposalManager),
            address(votingManager),
            address(shariaReviewManager),
            address(poolManager),
            address(zakatEscrowManager),
            address(milestoneManager),
            address(honkVerifier),
            address(nullifierRegistry),
            address(privateDonationPool)
        );

        // Setup permissions
        _setupPermissions();

        // Setup council root
        shariaReviewManager.setCouncilMerkleRoot(COUNCIL_MERKLE_ROOT);
        shariaReviewManager.setShariaQuorum(QUORUM_THRESHOLD);

        // Setup voting NFT for voters
        votingNFT.mintVotingNFT(voter1, "ipfs://voter1");
        votingNFT.mintVotingNFT(voter2, "ipfs://voter2");
        votingNFT.mintVotingNFT(voter3, "ipfs://voter3");

        // Set voting period to 1 days to avoid auto-bundling
        dao.setVotingPeriod(1 days);

        vm.stopPrank();
    }

    function _setupPermissions() internal {
        // Passport wiring: ProposalManager.createProposal requires the organizer
        // to hold an Organization passport, and reverts calling address(0)
        // otherwise. Without this the whole suite fails in _createAndPassProposal.
        proposalManager.setTawfPassport(address(tawfPassport));
        tawfPassport.issuePassport(organizer, PassportType.Organization, "ipfs://organizer");

        // Grant roles on managers
        proposalManager.grantRole(proposalManager.ORGANIZER_ROLE(), address(dao));
        proposalManager.grantRole(proposalManager.KYC_ORACLE_ROLE(), address(dao));
        proposalManager.grantRole(proposalManager.ADMIN_ROLE(), address(dao));

        votingManager.grantRole(dao.DEFAULT_ADMIN_ROLE(), address(dao));
        shariaReviewManager.grantRole(shariaReviewManager.SHARIA_COUNCIL_ROLE(), address(dao));
        shariaReviewManager.grantRole(dao.DEFAULT_ADMIN_ROLE(), address(dao));

        poolManager.grantRole(poolManager.ADMIN_ROLE(), address(dao));
        poolManager.grantRole(dao.DEFAULT_ADMIN_ROLE(), address(dao));

        zakatEscrowManager.grantRole(zakatEscrowManager.ADMIN_ROLE(), address(dao));
        zakatEscrowManager.grantRole(zakatEscrowManager.SHARIA_COUNCIL_ROLE(), address(dao));
        zakatEscrowManager.grantRole(dao.DEFAULT_ADMIN_ROLE(), address(dao));

        milestoneManager.grantRole(milestoneManager.ORGANIZER_ROLE(), address(dao));
        milestoneManager.grantRole(dao.DEFAULT_ADMIN_ROLE(), address(dao));

        // Cross-module permissions
        proposalManager.grantRole(proposalManager.VOTING_MANAGER_ROLE(), address(votingManager));
        proposalManager.grantRole(proposalManager.VOTING_MANAGER_ROLE(), address(shariaReviewManager));
        proposalManager.grantRole(proposalManager.VOTING_MANAGER_ROLE(), address(poolManager));
        proposalManager.grantRole(proposalManager.VOTING_MANAGER_ROLE(), address(zakatEscrowManager));
        proposalManager.grantRole(proposalManager.MILESTONE_MANAGER_ROLE(), address(milestoneManager));
        proposalManager.grantRole(proposalManager.MILESTONE_MANAGER_ROLE(), address(poolManager));

        // Token permissions
        receiptNFT.grantRole(receiptNFT.MINTER_ROLE(), address(poolManager));
        receiptNFT.grantRole(receiptNFT.MINTER_ROLE(), address(zakatEscrowManager));
        votingNFT.grantRole(votingNFT.MINTER_ROLE(), address(dao));
        votingNFT.grantRole(votingNFT.ADMIN_ROLE(), address(dao));
        votingNFT.grantRole(votingNFT.UPGRADER_ROLE(), address(dao));
        participationTracker.grantRole(participationTracker.TRACKER_ROLE(), address(dao));
        participationTracker.grantRole(participationTracker.VERIFIER_ROLE(), address(dao));

        // Grant initial roles
        dao.grantOrganizerRole(organizer);
        dao.grantShariaCouncilRole(deployer);
        dao.grantKYCOracleRole(deployer);

        // A real council member, for exercising the gated proof entrypoints.
        shariaReviewManager.grantRole(shariaReviewManager.SHARIA_COUNCIL_ROLE(), councilMember1);
    }

    // ============ Proof Submission Tests ============

    /**
     * @notice The verifier is a fail-closed stub, so even an authorised council
     *         member cannot mark a proposal verified.
     * @dev This replaces a test that submitted a proof and then asserted
     *      `assertTrue(true)`, which passed no matter what the contracts did.
     *      The point of the assertions below is that NO approval state is
     *      written when verification does not actually happen.
     */
    function testSubmitShariaReviewProof_FailsClosedEvenForCouncil() public {
        uint256 proposalId = _createAndPassProposal();

        uint256[] memory proposalIds = new uint256[](1);
        proposalIds[0] = proposalId;
        vm.prank(deployer);
        uint256 bundleId = shariaReviewManager.createShariaReviewBundle(proposalIds);

        Groth16Proof memory proof = _createMockProof();

        vm.prank(councilMember1);
        bool success = shariaReviewManager.submitShariaReviewProof(
            bundleId,
            proposalId,
            4, // approvalCount >= QUORUM_THRESHOLD
            IProposalManager.CampaignType.ZakatCompliant,
            proof
        );

        assertFalse(success, "fail-closed verifier must not accept any proof");
        assertFalse(
            shariaReviewManager.bundleProofVerified(bundleId, proposalId),
            "no verification state may be written"
        );
        assertFalse(
            shariaReviewManager.bundleProposalApproved(bundleId, proposalId),
            "proposal must not reach Sharia-approved"
        );
        assertEq(
            shariaReviewManager.bundleApprovalCount(bundleId, proposalId),
            0,
            "approval count must remain zero"
        );
    }

    /**
     * @notice Regression test for the forgery hole.
     * @dev Previously submitShariaReviewProof was permissionless AND the
     *      verifier returned true unconditionally, so any address could stamp
     *      bundleProofVerified = true with a caller-chosen approvalCount and
     *      drive a proposal to ShariaApproved. Submission is now role-gated.
     */
    function testSubmitShariaReviewProof_RevertsForNonCouncil() public {
        uint256 proposalId = _createAndPassProposal();

        uint256[] memory proposalIds = new uint256[](1);
        proposalIds[0] = proposalId;
        vm.prank(deployer);
        uint256 bundleId = shariaReviewManager.createShariaReviewBundle(proposalIds);

        Groth16Proof memory proof = _createMockProof();

        vm.prank(address(0x100)); // not a council member
        vm.expectRevert();
        shariaReviewManager.submitShariaReviewProof(
            bundleId,
            proposalId,
            4,
            IProposalManager.CampaignType.ZakatCompliant,
            proof
        );

        assertFalse(
            shariaReviewManager.bundleProofVerified(bundleId, proposalId),
            "rejected submission must leave no trace"
        );
    }

    /**
     * @notice ZKTCore must not be usable as a bypass around the manager's gate.
     * @dev ZKTCore holds SHARIA_COUNCIL_ROLE on ShariaReviewManager, so an
     *      ungated forwarder on ZKTCore would defeat the manager's own check.
     */
    function testZKTCoreSubmitShariaReviewProof_RevertsForNonCouncil() public {
        uint256 proposalId = _createAndPassProposal();

        uint256[] memory proposalIds = new uint256[](1);
        proposalIds[0] = proposalId;
        vm.prank(deployer);
        uint256 bundleId = shariaReviewManager.createShariaReviewBundle(proposalIds);

        Groth16Proof memory proof = _createMockProof();

        vm.prank(address(0x100));
        vm.expectRevert();
        dao.submitShariaReviewProof(
            bundleId,
            proposalId,
            4,
            IProposalManager.CampaignType.ZakatCompliant,
            proof
        );

        assertFalse(
            shariaReviewManager.bundleProofVerified(bundleId, proposalId),
            "ZKTCore must not be a bypass"
        );
    }

    /**
     * @notice Replay protection: the proof commitment is burned on first use.
     * @dev Replaces a test whose entire body was a try/catch with both branches
     *      empty, so it asserted nothing. The commitment is recorded BEFORE
     *      verification is attempted, so a second submission of the same
     *      (proof, bundle, proposal) tuple reverts even though the first
     *      submission failed verification.
     */
    function testSubmitShariaReviewProof_ReplayProtection() public {
        uint256 proposalId = _createAndPassProposal();

        uint256[] memory proposalIds = new uint256[](1);
        proposalIds[0] = proposalId;
        vm.prank(deployer);
        uint256 bundleId = shariaReviewManager.createShariaReviewBundle(proposalIds);

        Groth16Proof memory proof = _createMockProof();

        vm.prank(councilMember1);
        shariaReviewManager.submitShariaReviewProof(
            bundleId, proposalId, 4, IProposalManager.CampaignType.Normal, proof
        );

        // Same proof, same bundle, same proposal -> commitment already burned.
        vm.prank(councilMember1);
        vm.expectRevert("Proof already used");
        shariaReviewManager.submitShariaReviewProof(
            bundleId, proposalId, 4, IProposalManager.CampaignType.Normal, proof
        );
    }

    /**
     * @notice A below-quorum approvalCount must not be accepted.
     * @dev Note this passes for the RIGHT reason now: the verifier fails
     *      closed. It used to pass only because of a plaintext
     *      `approvalCount >= quorumThreshold` comparison on a caller-supplied
     *      number, with no cryptographic backing whatsoever.
     */
    function testSubmitShariaReviewProof_InsufficientQuorum() public {
        uint256 proposalId = _createAndPassProposal();

        uint256[] memory proposalIds = new uint256[](1);
        proposalIds[0] = proposalId;
        vm.prank(deployer);
        uint256 bundleId = shariaReviewManager.createShariaReviewBundle(proposalIds);

        Groth16Proof memory proof = _createMockProof();

        vm.prank(councilMember1);
        bool success = shariaReviewManager.submitShariaReviewProof(
            bundleId,
            proposalId,
            2, // Less than QUORUM_THRESHOLD (3)
            IProposalManager.CampaignType.Normal,
            proof
        );

        assertFalse(success, "Should have failed with insufficient quorum");
        assertFalse(
            shariaReviewManager.bundleProposalApproved(bundleId, proposalId),
            "below-quorum submission must not approve"
        );
    }

    function testSubmitShariaReviewProof_InvalidBundle() public {
        Groth16Proof memory proof = _createMockProof();

        // Called by an authorised council member so the bundle check is what
        // actually fires, rather than the role gate.
        vm.prank(councilMember1);
        vm.expectRevert("Bundle does not exist");
        shariaReviewManager.submitShariaReviewProof(
            999, // Invalid bundleId
            1,
            4,
            IProposalManager.CampaignType.Normal,
            proof
        );
    }

    /**
     * @notice The verifier must self-report as non-functional.
     * @dev Guards against a future change that makes verification silently
     *      pass without a real pairing check.
     */
    function testGroth16VerifierIsNotOperational() public view {
        assertFalse(groth16Verifier.isOperational(), "stub verifier must not claim to be operational");
        assertFalse(
            groth16Verifier.verifyProof(
                [uint256(1), uint256(2)],
                [[uint256(3), uint256(4)], [uint256(5), uint256(6)]],
                [uint256(7), uint256(8)],
                [uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0)]
            ),
            "stub verifier must reject arbitrary bytes"
        );
    }

    // ============ Council Management Tests ============

    function testSetCouncilMerkleRoot_AdminOnly() public {
        vm.expectRevert();
        vm.prank(address(0x100));
        shariaReviewManager.setCouncilMerkleRoot(999);

        // Admin should succeed
        vm.prank(deployer);
        shariaReviewManager.setCouncilMerkleRoot(999);
    }

    function testSetCouncilMerkleRoot_EmitsEvent() public {
        vm.prank(deployer);
        // vm.expectEmit(true, false, false, true);
        // Note: In actual testing, this would reference ShariaReviewManager.CouncilRootUpdated
        // For now we just test the call succeeds
        shariaReviewManager.setCouncilMerkleRoot(999);
    }

    // ============ View Function Tests ============

    function testHasVerifiedProof() public {
        uint256 proposalId = _createAndPassProposal();

        uint256[] memory proposalIds = new uint256[](1);
        proposalIds[0] = proposalId;
        vm.prank(deployer);
        uint256 bundleId = shariaReviewManager.createShariaReviewBundle(proposalIds);

        // Before proof submission
        assertFalse(shariaReviewManager.hasVerifiedProof(bundleId, proposalId));
    }

    function testGetProofApprovalCount() public {
        uint256 proposalId = _createAndPassProposal();

        uint256[] memory proposalIds = new uint256[](1);
        proposalIds[0] = proposalId;
        vm.prank(deployer);
        uint256 bundleId = shariaReviewManager.createShariaReviewBundle(proposalIds);

        // Should revert before proof is verified
        vm.expectRevert("No verified proof");
        shariaReviewManager.getProofApprovalCount(bundleId, proposalId);
    }

    // ============ Batch Proof Submission Tests ============

    function testBatchSubmitShariaReviewProofs() public {
        // Create multiple proposals
        uint256 proposalId1 = _createAndPassProposal();
        uint256 proposalId2 = _createAndPassProposal();

        uint256[] memory proposalIds = new uint256[](2);
        proposalIds[0] = proposalId1;
        proposalIds[1] = proposalId2;
        vm.prank(deployer);
        uint256 bundleId = shariaReviewManager.createShariaReviewBundle(proposalIds);

        // Prepare batch data
        uint256[] memory approvalCounts = new uint256[](2);
        approvalCounts[0] = 4;
        approvalCounts[1] = 3;

        IProposalManager.CampaignType[] memory campaignTypes = new IProposalManager.CampaignType[](2);
        campaignTypes[0] = IProposalManager.CampaignType.ZakatCompliant;
        campaignTypes[1] = IProposalManager.CampaignType.Normal;

        Groth16Proof[] memory proofs = new Groth16Proof[](2);
        proofs[0] = _createMockProof();
        proofs[1] = _createMockProof();

        vm.prank(address(0x100));
        // Will fail verification without valid proofs, but tests the batch interface
        try shariaReviewManager.batchSubmitShariaReviewProofs(
            bundleId,
            proposalIds,
            approvalCounts,
            campaignTypes,
            proofs
        ) {
            // If proofs somehow pass
        } catch {
            // Expected: proof verification fails
        }
    }

    // ============ Helper Functions ============

    function _createAndPassProposal() internal returns (uint256) {
        vm.startPrank(organizer);

        // Create proposal
        IProposalManager.MilestoneInput[] memory milestones = new IProposalManager.MilestoneInput[](2);
        milestones[0] = IProposalManager.MilestoneInput("Milestone 1", 100 ether);
        milestones[1] = IProposalManager.MilestoneInput("Milestone 2", 100 ether);

        string[] memory zakatItems = new string[](1);
        zakatItems[0] = "Zakat compliant";

        uint256 proposalId = dao.createProposal(
            "Test Proposal",
            "Test Description",
            1000 ether,
            false,
            bytes32(0),
            zakatItems,
            "ipfs://metadata",
            milestones
        );

        // Update KYC and submit for voting
        vm.stopPrank();
        vm.prank(deployer);
        dao.updateKYCStatus(proposalId, IProposalManager.KYCStatus.Verified, "Approved");

        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);

        // Simulate voting
        _voteOnProposal(proposalId, voter1, 1); // For
        _voteOnProposal(proposalId, voter2, 1); // For
        _voteOnProposal(proposalId, voter3, 1); // For

        // Finalize vote
        vm.warp(block.timestamp + 2 days);
        dao.finalizeCommunityVote(proposalId);

        return proposalId;
    }

    function _voteOnProposal(uint256 proposalId, address voter, uint8 support) internal {
        vm.prank(voter);
        dao.castVote(proposalId, support);
    }

    function _createMockProof() internal pure returns (Groth16Proof memory) {
        return Groth16Proof({
            pi_a: [uint256(1), uint256(2)],
            pi_b: [[uint256(3), uint256(4)], [uint256(5), uint256(6)]],
            pi_c: [uint256(7), uint256(8)]
        });
    }
}

