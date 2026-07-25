// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.31;
import "forge-std/Test.sol";
import "@tawf-gov/tokens/MockIDRX.sol";
import "@tawf-gov/protocol/DonationReceiptNFT.sol";
import "@tawf-gov/tokens/VotingNFT.sol";
import "../src/DAO/ZKTCore.sol";
import "@tawf-gov/interfaces/IProposalManager.sol";
import "@tawf-gov/protocol/PoolManager.sol";
import "@tawf-gov/protocol/ZakatEscrowManager.sol";
import "../src/DAO/core/PrivateDonationPool.sol";
import "@tawf-gov/governance/ParticipationTracker.sol";
import "../src/DAO/verifiers/Groth16Verifier.sol";
import "@tawf-gov/identity/TawfPassport.sol";
import {PassportType} from "@tawf-gov/interfaces/ITawfPassport.sol";

contract ZKTCoreTest is Test {
    MockIDRX public idrxToken;
    DonationReceiptNFT public receiptNFT;
    VotingNFT public votingNFT;
    ParticipationTracker public participationTracker;
    ZKTCore public dao;

    address public deployer = address(this);
    address public organizer = address(0x1);
    address public member1 = address(0x2);
    address public member2 = address(0x3);
    address public member3 = address(0x4);
    address public shariaCouncil1 = address(0x5);
    address public shariaCouncil2 = address(0x6);
    address public shariaCouncil3 = address(0x7);
    address public donor1 = address(0x8);
    address public donor2 = address(0x9);

    function setUp() public {
        // Deploy tokens
        idrxToken = new MockIDRX();
        receiptNFT = new DonationReceiptNFT();
        votingNFT = new VotingNFT();
        participationTracker = new ParticipationTracker();

        // Deploy Groth16Verifier
        Groth16Verifier groth16Verifier = new Groth16Verifier();

        // Deploy ZK verifier and nullifier registry
        HonkVerifier honkVerifier = new HonkVerifier();
        NullifierRegistry nullifierRegistry = new NullifierRegistry();

        // Deploy Managers
        ProposalManager proposalManager = new ProposalManager();
        VotingManager votingManager = new VotingManager(
            address(proposalManager),
            address(votingNFT)
        );
        ShariaReviewManager shariaReviewManager = new ShariaReviewManager(
            address(proposalManager),
            address(groth16Verifier)
        );
        PoolManager poolManager = new PoolManager(
            address(proposalManager),
            address(idrxToken),
            address(receiptNFT)
        );
        ZakatEscrowManager zakatEscrowManager = new ZakatEscrowManager(
            address(proposalManager),
            address(idrxToken),
            address(receiptNFT)
        );
        PrivateDonationPool privatePool = new PrivateDonationPool(address(idrxToken));
        MilestoneManager milestoneManager = new MilestoneManager(
            address(proposalManager),
            address(votingNFT)
        );

        // Deploy ZKTCore Orchestrator
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
            address(privatePool)
        );

        // --- Wiring Permissions (Admin & Functional Roles) ---

        // Grant ZKTCore roles on ProposalManager
        proposalManager.grantRole(
            proposalManager.ORGANIZER_ROLE(),
            address(dao)
        );
        proposalManager.grantRole(
            proposalManager.KYC_ORACLE_ROLE(),
            address(dao)
        );
        proposalManager.grantRole(proposalManager.ADMIN_ROLE(), address(dao));

        // Grant ZKTCore roles on VotingManager
        votingManager.grantRole(dao.DEFAULT_ADMIN_ROLE(), address(dao));

        // Grant ZKTCore roles on ShariaReviewManager
        shariaReviewManager.grantRole(
            shariaReviewManager.SHARIA_COUNCIL_ROLE(),
            address(dao)
        );
        shariaReviewManager.grantRole(dao.DEFAULT_ADMIN_ROLE(), address(dao));

        // Grant ZKTCore roles on PoolManager
        poolManager.grantRole(poolManager.ADMIN_ROLE(), address(dao));
        poolManager.grantRole(poolManager.CORE_ROLE(), address(dao));
        poolManager.grantRole(dao.DEFAULT_ADMIN_ROLE(), address(dao));

        // Grant ZKTCore roles on ZakatEscrowManager
        zakatEscrowManager.grantRole(
            zakatEscrowManager.ADMIN_ROLE(),
            address(dao)
        );
        zakatEscrowManager.grantRole(
            zakatEscrowManager.SHARIA_COUNCIL_ROLE(),
            address(dao)
        );
        zakatEscrowManager.grantRole(dao.DEFAULT_ADMIN_ROLE(), address(dao));

        // Grant ZKTCore roles on MilestoneManager
        milestoneManager.grantRole(
            milestoneManager.ORGANIZER_ROLE(),
            address(dao)
        );
        milestoneManager.grantRole(dao.DEFAULT_ADMIN_ROLE(), address(dao));

        // Cross-module permissions on ProposalManager
        proposalManager.grantRole(
            proposalManager.VOTING_MANAGER_ROLE(),
            address(votingManager)
        );
        proposalManager.grantRole(
            proposalManager.VOTING_MANAGER_ROLE(),
            address(shariaReviewManager)
        );
        proposalManager.grantRole(
            proposalManager.VOTING_MANAGER_ROLE(),
            address(poolManager)
        );
        proposalManager.grantRole(
            proposalManager.VOTING_MANAGER_ROLE(),
            address(zakatEscrowManager)
        );
        proposalManager.grantRole(
            proposalManager.MILESTONE_MANAGER_ROLE(),
            address(milestoneManager)
        );
        proposalManager.grantRole(
            proposalManager.MILESTONE_MANAGER_ROLE(),
            address(poolManager)
        );

        // Grant MINTER_ROLE to PoolManager
        receiptNFT.grantRole(receiptNFT.MINTER_ROLE(), address(poolManager));

        // Grant MINTER_ROLE to ZakatEscrowManager for NFT receipts
        receiptNFT.grantRole(
            receiptNFT.MINTER_ROLE(),
            address(zakatEscrowManager)
        );

        // Grant MINTER_ROLE to DAO for VotingNFT
        votingNFT.grantRole(votingNFT.MINTER_ROLE(), address(dao));
        votingNFT.grantRole(votingNFT.ADMIN_ROLE(), address(dao));
        votingNFT.grantRole(votingNFT.UPGRADER_ROLE(), address(dao));

        // Grant roles to ParticipationTracker
        participationTracker.grantRole(participationTracker.TRACKER_ROLE(), address(dao));
        participationTracker.grantRole(participationTracker.VERIFIER_ROLE(), address(dao));

        // Passport wiring: ProposalManager.createProposal requires the organizer
        // to hold an Organization passport and reverts calling address(0)
        // otherwise, which previously failed every proposal-creating test here.
        TawfPassport tawfPassport = new TawfPassport();
        proposalManager.setTawfPassport(address(tawfPassport));
        tawfPassport.issuePassport(organizer, PassportType.Organization, "ipfs://organizer");

        // Setup roles (no ADMIN_ROLE - fully decentralized)
        dao.grantOrganizerRole(organizer);
        dao.grantShariaCouncilRole(shariaCouncil1);
        dao.grantShariaCouncilRole(shariaCouncil2);
        dao.grantShariaCouncilRole(shariaCouncil3);
        dao.grantKYCOracleRole(deployer); // Grant deployer KYC oracle role for tests

        // Grant voting NFTs to members (each gets 1 NFT with tier-based voting power)
        dao.grantVotingNFT(member1, "ipfs://member1");
        dao.grantVotingNFT(member2, "ipfs://member2");
        dao.grantVotingNFT(member3, "ipfs://member3");

        // Verify members so they can vote
        dao.verifyVoter(member1);
        dao.verifyVoter(member2);
        dao.verifyVoter(member3);

        // Give IDRX to donors
        idrxToken.adminMint(donor1, 10000 * 10 ** 18);
        idrxToken.adminMint(donor2, 10000 * 10 ** 18);

        // Setup default fallback pool for Zakat tests (use deployer as fallback)
        dao.setDefaultFallbackPool(deployer);
    }

    function testCreateProposal() public {
        vm.startPrank(organizer);

        string[] memory checklist = new string[](2);
        checklist[0] = "Funds go to eligible recipients";
        checklist[1] = "No personal benefit for organizer";

        IProposalManager.MilestoneInput[]
            memory milestones = new IProposalManager.MilestoneInput[](0);

        uint256 proposalId = dao.createProposal(
            "Build School in Village",
            "Detailed description of school project",
            1000 * 10 ** 18,
            false,
            keccak256("mock_kyc_proof"),
            checklist,
            "", // metadataURI (empty for test)
            milestones
        );

        vm.stopPrank();

        assertEq(proposalId, 1);
        assertEq(dao.proposalManager().proposalCount(), 1);

        IProposalManager.Proposal memory proposal = dao.proposalManager().getProposal(1);
        assertEq(proposal.organizer, organizer);
        assertEq(proposal.title, "Build School in Village");
        assertEq(proposal.fundingGoal, 1000 * 10 ** 18);
        assertEq(
            uint8(proposal.status),
            uint8(IProposalManager.ProposalStatus.Draft)
        );
        assertEq(
            uint8(proposal.kycStatus),
            uint8(IProposalManager.KYCStatus.Pending)
        );
    }

    function testEmergencyProposal() public {
        vm.startPrank(organizer);

        IProposalManager.MilestoneInput[]
            memory emptyMilestones = new IProposalManager.MilestoneInput[](0);

        uint256 proposalId = dao.createProposal(
            "Emergency Flood Relief",
            "Urgent flood relief needed",
            500 * 10 ** 18,
            true, // emergency
            bytes32(0),
            new string[](0),
            "", // metadataURI (empty for test)
            emptyMilestones
        );

        vm.stopPrank();

        IProposalManager.Proposal memory proposal = dao.proposalManager().getProposal(proposalId);
        assertTrue(proposal.isEmergency);
        assertEq(
            uint8(proposal.kycStatus),
            uint8(IProposalManager.KYCStatus.NotRequired)
        );
    }

    function testKYCUpdate() public {
        vm.prank(organizer);
        IProposalManager.MilestoneInput[]
            memory noMilestones = new IProposalManager.MilestoneInput[](0);

        uint256 proposalId = dao.createProposal(
            "Test Proposal",
            "Description",
            1000 * 10 ** 18,
            false,
            keccak256("kyc_hash"),
            new string[](0),
            "", // metadataURI (empty for test)
            noMilestones
        );

        // Update KYC status
        dao.updateKYCStatus(
            proposalId,
            IProposalManager.KYCStatus.Verified,
            "KYC verified via mock ZK proof"
        );

        IProposalManager.Proposal memory proposal = dao.proposalManager().getProposal(proposalId);
        assertEq(
            uint8(proposal.kycStatus),
            uint8(IProposalManager.KYCStatus.Verified)
        );
    }

    function testCommunityVoteFlow() public {
        // Create and verify proposal
        vm.prank(organizer);
        IProposalManager.MilestoneInput[]
            memory noMilestones = new IProposalManager.MilestoneInput[](0);

        uint256 proposalId = dao.createProposal(
            "Test Campaign",
            "Description",
            1000 * 10 ** 18,
            false,
            keccak256("kyc"),
            new string[](0),
            "", // metadataURI (empty for test)
            noMilestones
        );

        dao.updateKYCStatus(
            proposalId,
            IProposalManager.KYCStatus.Verified,
            "Verified"
        );

        // Submit for vote
        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);

        IProposalManager.Proposal memory proposal = dao.proposalManager().getProposal(proposalId);
        assertEq(
            uint8(proposal.status),
            uint8(IProposalManager.ProposalStatus.CommunityVote)
        );

        // Cast votes
        vm.prank(member1);
        dao.castVote(proposalId, 1); // For

        vm.prank(member2);
        dao.castVote(proposalId, 1); // For

        vm.prank(member3);
        dao.castVote(proposalId, 0); // Against

        // Fast forward time
        vm.warp(block.timestamp + 8 days);

        // Finalize vote
        dao.finalizeCommunityVote(proposalId);

        proposal = dao.proposalManager().getProposal(proposalId);
        // After finalization with passing vote, automatic bundling occurs
        // Status changes from CommunityPassed → ShariaReview
        assertEq(
            uint8(proposal.status),
            uint8(IProposalManager.ProposalStatus.ShariaReview)
        );
        // Each member has 1 vote at Tier 1, so votes are weighted
        assertEq(proposal.votesFor, 2); // member1 + member2
        assertEq(proposal.votesAgainst, 1); // member3
    }

    function testShariaReviewFlow() public {
        // Create passed proposal
        vm.prank(organizer);
        IProposalManager.MilestoneInput[]
            memory noMilestones = new IProposalManager.MilestoneInput[](0);

        uint256 proposalId = dao.createProposal(
            "Test Campaign",
            "Description",
            1000 * 10 ** 18,
            true, // emergency
            bytes32(0),
            new string[](0),
            "", // metadataURI (empty for test)
            noMilestones
        );

        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);

        vm.prank(member1);
        dao.castVote(proposalId, 1);
        vm.prank(member2);
        dao.castVote(proposalId, 1);

        vm.warp(block.timestamp + 8 days);
        dao.finalizeCommunityVote(proposalId);

        // Automatic bundling occurred during finalizeCommunityVote
        uint256 bundleId = 1; // Auto-created bundle ID

        assertEq(bundleId, 1);

        // Sharia council reviews
        // All 3 Sharia council members need to review (multi-sig 2/3 quorum)
        vm.prank(shariaCouncil1);
        dao.reviewProposal(
            bundleId,
            proposalId,
            true,
            IProposalManager.CampaignType.ZakatCompliant,
            keccak256("sharia_proof_1")
        );

        vm.prank(shariaCouncil2);
        dao.reviewProposal(
            bundleId,
            proposalId,
            true,
            IProposalManager.CampaignType.ZakatCompliant,
            keccak256("sharia_proof_2")
        );

        // Finalize bundle after 2/3 quorum reached
        vm.prank(shariaCouncil1);
        dao.finalizeShariaBundle(bundleId);

        IProposalManager.Proposal memory proposal = dao.proposalManager().getProposal(proposalId);
        assertEq(
            uint8(proposal.status),
            uint8(IProposalManager.ProposalStatus.ShariaApproved)
        );
        assertEq(
            uint8(proposal.campaignType),
            uint8(IProposalManager.CampaignType.ZakatCompliant)
        );

        // Organizer creates pool for their approved proposal
        vm.prank(organizer);
        uint256 poolId = dao.createCampaignPool(proposalId);
        assertEq(poolId, 1);
    }

    function testFullDonationFlow() public {
        // Setup approved proposal
        vm.prank(organizer);
        IProposalManager.MilestoneInput[]
            memory noMilestones = new IProposalManager.MilestoneInput[](0);

        uint256 proposalId = dao.createProposal(
            "Test Campaign",
            "Description",
            1000 * 10 ** 18,
            true,
            bytes32(0),
            new string[](0),
            "", // metadataURI (empty for test)
            noMilestones
        );

        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);

        vm.prank(member1);
        dao.castVote(proposalId, 1);
        vm.prank(member2);
        dao.castVote(proposalId, 1);

        vm.warp(block.timestamp + 8 days);
        dao.finalizeCommunityVote(proposalId);

        // Automatic bundling occurred during finalizeCommunityVote
        uint256 bundleId = 1; // Auto-created bundle ID

        vm.prank(shariaCouncil1);
        dao.reviewProposal(
            bundleId,
            proposalId,
            true,
            IProposalManager.CampaignType.ZakatCompliant,
            bytes32(0)
        );

        vm.prank(shariaCouncil1);
        dao.finalizeShariaBundle(bundleId);

        // Create pool (organizer creates their own pool after Sharia approval)
        vm.prank(organizer);
        uint256 poolId = dao.createCampaignPool(proposalId);
        assertEq(poolId, 1);

        // Donor1 donates (first donation) with IPFS CID from Pinata
        vm.startPrank(donor1);
        // For Zakat campaigns, approve ZakatEscrowManager instead of PoolManager
        idrxToken.approve(
            address(dao.getZakatEscrowManagerAddress()),
            500 * 10 ** 18
        );
        dao.donate(poolId, 500 * 10 ** 18, "QmX1Y2Z3ReceiptMetadata1");
        vm.stopPrank();

        // Check first receipt NFT minted with IPFS metadata
        uint256[] memory donor1Receipts = receiptNFT.getDonorReceipts(donor1);
        assertEq(donor1Receipts.length, 1);
        assertEq(receiptNFT.ownerOf(donor1Receipts[0]), donor1);

        // Verify IPFS URI is set correctly
        uint256 firstTokenId = donor1Receipts[0];
        string memory tokenURI = receiptNFT.tokenURI(firstTokenId);
        assertEq(tokenURI, "ipfs://QmX1Y2Z3ReceiptMetadata1");

        // Verify metadata stored correctly
        (
            uint256 poolId_,
            address donor_,
            uint256 amount_,
            uint256 donatedAt_,
            string memory title_,
            string memory type_,
            string memory ipfsCID_,
            bool isActive_
        ) = receiptNFT.tokenMetadata(firstTokenId);
        assertEq(poolId_, poolId);
        assertEq(donor_, donor1);
        assertEq(amount_, 500 * 10 ** 18);
        assertEq(ipfsCID_, "QmX1Y2Z3ReceiptMetadata1");
        assertTrue(isActive_);

        // Donor1 donates again (should mint ANOTHER receipt NFT with different IPFS CID)
        vm.startPrank(donor1);
        idrxToken.approve(
            address(dao.getZakatEscrowManagerAddress()),
            300 * 10 ** 18
        );
        dao.donate(poolId, 300 * 10 ** 18, "QmA2B3C4ReceiptMetadata2");
        vm.stopPrank();

        // Check second receipt NFT minted for same donor
        donor1Receipts = receiptNFT.getDonorReceipts(donor1);
        assertEq(donor1Receipts.length, 2); // Now has 2 receipt NFTs

        // Verify second NFT has different IPFS CID
        uint256 secondTokenId = donor1Receipts[1];
        string memory tokenURI2 = receiptNFT.tokenURI(secondTokenId);
        assertEq(tokenURI2, "ipfs://QmA2B3C4ReceiptMetadata2");

        // Donor2 donates with their own IPFS CID
        vm.startPrank(donor2);
        idrxToken.approve(
            address(dao.getZakatEscrowManagerAddress()),
            600 * 10 ** 18
        );
        dao.donate(poolId, 600 * 10 ** 18, "QmD5E6F7ReceiptMetadata3");
        vm.stopPrank();

        // Check donor2 has 1 receipt NFT
        uint256[] memory donor2Receipts = receiptNFT.getDonorReceipts(donor2);
        assertEq(donor2Receipts.length, 1);

        // Check pool status - use getZakatPool for Zakat campaigns
        ZakatEscrowManager.ZakatPool memory zakatPool = dao.zakatEscrowManager().getPool(
            poolId
        );
        assertEq(zakatPool.raisedAmount, 1400 * 10 ** 18); // 500 + 300 + 600
        assertTrue(zakatPool.raisedAmount >= zakatPool.fundingGoal);

        // Organizer withdraws
        uint256 organizerBalanceBefore = idrxToken.balanceOf(organizer);
        vm.prank(organizer);
        dao.withdrawFunds(poolId);

        assertEq(
            idrxToken.balanceOf(organizer),
            organizerBalanceBefore + 1400 * 10 ** 18
        );
    }

    function testFaucet() public {
        // Fast forward past initial cooldown period
        vm.warp(block.timestamp + 25 hours);

        vm.startPrank(donor1);

        uint256 balanceBefore = idrxToken.balanceOf(donor1);
        idrxToken.faucet();
        uint256 balanceAfter = idrxToken.balanceOf(donor1);

        assertEq(balanceAfter - balanceBefore, 1000 * 10 ** 18);

        // Try to claim again immediately (should fail)
        vm.expectRevert("MockIDRX: Faucet cooldown not expired");
        idrxToken.faucet();

        // Fast forward 24 hours
        vm.warp(block.timestamp + 24 hours + 1);

        // Should work now
        idrxToken.faucet();
        assertEq(idrxToken.balanceOf(donor1), balanceAfter + 1000 * 10 ** 18);

        vm.stopPrank();
    }

    function testReceiptNFTNonTransferable() public {
        // Setup and create donation to mint receipt NFT
        vm.prank(organizer);
        IProposalManager.MilestoneInput[]
            memory noMilestones = new IProposalManager.MilestoneInput[](0);

        uint256 proposalId = dao.createProposal(
            "Test",
            "Desc",
            1000 * 10 ** 18,
            true,
            bytes32(0),
            new string[](0),
            "", // metadataURI (empty for test)
            noMilestones
        );

        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);
        vm.prank(member1);
        dao.castVote(proposalId, 1);
        vm.prank(member2);
        dao.castVote(proposalId, 1);

        vm.warp(block.timestamp + 8 days);
        dao.finalizeCommunityVote(proposalId);

        // Automatic bundling occurred during finalizeCommunityVote
        uint256 bundleId = 1; // Auto-created bundle ID
        vm.prank(shariaCouncil1);
        dao.reviewProposal(
            bundleId,
            proposalId,
            true,
            IProposalManager.CampaignType.Normal,
            bytes32(0)
        );
        vm.prank(shariaCouncil1);
        dao.finalizeShariaBundle(bundleId);

        vm.prank(organizer);
        uint256 poolId = dao.createCampaignPool(proposalId);

        vm.startPrank(donor1);
        idrxToken.approve(address(dao.getPoolManagerAddress()), 100 * 10 ** 18);
        dao.donate(poolId, 100 * 10 ** 18, "QmTestNonTransferable");
        vm.stopPrank();

        uint256[] memory receipts = receiptNFT.getDonorReceipts(donor1);
        uint256 tokenId = receipts[0];

        // Try to transfer receipt NFT (should fail)
        vm.prank(donor1);
        vm.expectRevert("DonationReceipt: soulbound");
        receiptNFT.transferFrom(donor1, donor2, tokenId);
    }

    function testIPFSReceiptMetadata() public {
        // Setup approved proposal and pool
        vm.prank(organizer);
        IProposalManager.MilestoneInput[]
            memory noMilestones = new IProposalManager.MilestoneInput[](0);

        uint256 proposalId = dao.createProposal(
            "Disaster Relief Campaign",
            "Emergency assistance",
            2000 * 10 ** 18,
            true,
            bytes32(0),
            new string[](0),
            "", // metadataURI (empty for test)
            noMilestones
        );

        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);
        vm.prank(member1);
        dao.castVote(proposalId, 1);
        vm.prank(member2);
        dao.castVote(proposalId, 1);

        vm.warp(block.timestamp + 8 days);
        dao.finalizeCommunityVote(proposalId);

        uint256 bundleId = 1;
        vm.prank(shariaCouncil1);
        dao.reviewProposal(
            bundleId,
            proposalId,
            true,
            IProposalManager.CampaignType.ZakatCompliant,
            bytes32(0)
        );
        vm.prank(shariaCouncil1);
        dao.finalizeShariaBundle(bundleId);

        vm.prank(organizer);
        uint256 poolId = dao.createCampaignPool(proposalId);

        // Simulate Pinata IPFS upload: Frontend uploads metadata to Pinata and gets CID
        // Metadata JSON contains: campaign reports, images, donation details, etc.
        string memory pinataIPFSCID = "QmPinataExampleCID123WithFullMetadata";

        // Donor donates and passes IPFS CID
        vm.startPrank(donor1);
        // For Zakat campaigns, approve ZakatEscrowManager
        idrxToken.approve(
            address(dao.getZakatEscrowManagerAddress()),
            500 * 10 ** 18
        );
        dao.donate(poolId, 500 * 10 ** 18, pinataIPFSCID);
        vm.stopPrank();

        // Verify NFT was minted with IPFS metadata
        uint256[] memory receipts = receiptNFT.getDonorReceipts(donor1);
        assertEq(receipts.length, 1);

        uint256 tokenId = receipts[0];

        // Check tokenURI points to IPFS
        string memory tokenURI = receiptNFT.tokenURI(tokenId);
        assertEq(tokenURI, "ipfs://QmPinataExampleCID123WithFullMetadata");

        // Verify metadata struct contains IPFS CID
        (, , , , , , string memory storedIPFSCID, ) = receiptNFT.tokenMetadata(
            tokenId
        );
        assertEq(storedIPFSCID, pinataIPFSCID);

        // Test that donation without IPFS CID fails
        // Call ZakatEscrowManager directly to test the revert (dao.donate has try-catch fallback)
        address zakatEscrowMgr = dao.getZakatEscrowManagerAddress();
        vm.startPrank(donor2);
        idrxToken.approve(zakatEscrowMgr, 300 * 10 ** 18);
        vm.expectRevert("IPFS CID required");
        ZakatEscrowManager(zakatEscrowMgr).donate(
            donor2,
            poolId,
            300 * 10 ** 18,
            ""
        );
        vm.stopPrank();
    }

    // ============ Milestone Tests ============

    function testCreateProposalWithMilestones() public {
        vm.startPrank(organizer);

        // Create milestones using MilestoneInput (only description + targetAmount)
        IProposalManager.MilestoneInput[]
            memory milestones = new IProposalManager.MilestoneInput[](3);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Complete Well #1",
            targetAmount: 30000 * 10 ** 18
        });
        milestones[1] = IProposalManager.MilestoneInput({
            description: "Complete Well #2",
            targetAmount: 30000 * 10 ** 18
        });
        milestones[2] = IProposalManager.MilestoneInput({
            description: "Complete Well #3",
            targetAmount: 30000 * 10 ** 18
        });

        uint256 proposalId = dao.createProposal(
            "Build 3 Water Wells",
            "Provide clean water to villages",
            90000 * 10 ** 18,
            false,
            keccak256("kyc_proof"),
            new string[](0),
            "",
            milestones
        );

        vm.stopPrank();

        // Verify proposal created
        assertEq(proposalId, 1);

        // Verify milestones stored correctly
        assertEq(dao.proposalManager().getMilestoneCount(proposalId), 3);

        IProposalManager.Milestone memory m1 = dao.proposalManager().getMilestone(proposalId, 0);
        assertEq(m1.description, "Complete Well #1");
        assertEq(m1.targetAmount, 30000 * 10 ** 18);
        assertEq(
            uint8(m1.status),
            uint8(IProposalManager.MilestoneStatus.Pending)
        );
    }

    function testRejectEmergencyWithMilestones() public {
        vm.startPrank(organizer);

        IProposalManager.MilestoneInput[]
            memory milestones = new IProposalManager.MilestoneInput[](1);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Emergency milestone",
            targetAmount: 1000 * 10 ** 18
        });

        // Should revert
        vm.expectRevert("Emergency campaigns cannot have milestones");
        dao.createProposal(
            "Emergency Campaign",
            "Description",
            1000 * 10 ** 18,
            true, // emergency = true
            bytes32(0),
            new string[](0),
            "",
            milestones
        );

        vm.stopPrank();
    }

    function testMilestoneProofSubmission() public {
        // Create proposal with milestones
        vm.startPrank(organizer);

        IProposalManager.MilestoneInput[]
            memory milestones = new IProposalManager.MilestoneInput[](2);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Phase 1",
            targetAmount: 500 * 10 ** 18
        });
        milestones[1] = IProposalManager.MilestoneInput({
            description: "Phase 2",
            targetAmount: 500 * 10 ** 18
        });

        uint256 proposalId = dao.createProposal(
            "Test Campaign",
            "Description",
            1000 * 10 ** 18,
            false,
            keccak256("kyc"),
            new string[](0),
            "",
            milestones
        );

        vm.stopPrank();

        // Approve proposal through voting and sharia review
        dao.updateKYCStatus(
            proposalId,
            IProposalManager.KYCStatus.Verified,
            "Verified"
        );

        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);

        vm.prank(member1);
        dao.castVote(proposalId, 1);
        vm.prank(member2);
        dao.castVote(proposalId, 1);

        vm.warp(block.timestamp + 8 days);
        dao.finalizeCommunityVote(proposalId);

        uint256 bundleId = 1;
        vm.prank(shariaCouncil1);
        dao.reviewProposal(
            bundleId,
            proposalId,
            true,
            IProposalManager.CampaignType.Normal,
            bytes32(0)
        );
        vm.prank(shariaCouncil1);
        dao.finalizeShariaBundle(bundleId);

        // Create pool
        vm.prank(organizer);
        uint256 poolId = dao.createCampaignPool(proposalId);

        // Submit proof for milestone 0
        vm.prank(organizer);
        dao.submitMilestoneProof(proposalId, 0, "QmProofWell1Complete");

        // Verify proof submitted
        IProposalManager.Milestone memory m = dao.proposalManager().getMilestone(proposalId, 0);
        assertEq(m.proofIPFS, "QmProofWell1Complete");
        assertEq(
            uint8(m.status),
            uint8(IProposalManager.MilestoneStatus.ProofSubmitted)
        );
    }

    function testMilestoneVotingFlow() public {
        // Setup proposal with milestones and get to PoolCreated status
        vm.startPrank(organizer);

        IProposalManager.MilestoneInput[]
            memory milestones = new IProposalManager.MilestoneInput[](1);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Complete Project",
            targetAmount: 1000 * 10 ** 18
        });

        uint256 proposalId = dao.createProposal(
            "Test Campaign",
            "Description",
            1000 * 10 ** 18,
            false,
            keccak256("kyc"),
            new string[](0),
            "",
            milestones
        );

        vm.stopPrank();

        dao.updateKYCStatus(
            proposalId,
            IProposalManager.KYCStatus.Verified,
            "Verified"
        );

        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);

        vm.prank(member1);
        dao.castVote(proposalId, 1);
        vm.prank(member2);
        dao.castVote(proposalId, 1);

        vm.warp(block.timestamp + 8 days);
        dao.finalizeCommunityVote(proposalId);

        uint256 bundleId = 1;
        vm.prank(shariaCouncil1);
        dao.reviewProposal(
            bundleId,
            proposalId,
            true,
            IProposalManager.CampaignType.Normal,
            bytes32(0)
        );
        vm.prank(shariaCouncil1);
        dao.finalizeShariaBundle(bundleId);

        vm.prank(organizer);
        uint256 poolId = dao.createCampaignPool(proposalId);

        // Submit proof
        vm.prank(organizer);
        dao.submitMilestoneProof(proposalId, 0, "QmProof");

        // Start voting
        dao.startMilestoneVoting(proposalId, 0);

        IProposalManager.Milestone memory m = dao.proposalManager().getMilestone(proposalId, 0);
        assertEq(
            uint8(m.status),
            uint8(IProposalManager.MilestoneStatus.Voting)
        );

        // Cast votes
        vm.prank(member1);
        dao.voteMilestone(proposalId, 0, 1); // For

        vm.prank(member2);
        dao.voteMilestone(proposalId, 0, 1); // For

        vm.prank(member3);
        dao.voteMilestone(proposalId, 0, 0); // Against

        // Fast forward to end of voting period
        IProposalManager.Milestone memory mBeforeFinalize = dao.proposalManager().getMilestone(
            proposalId,
            0
        );
        vm.warp(mBeforeFinalize.voteEnd + 1);
        dao.finalizeMilestoneVote(proposalId, 0);

        m = dao.proposalManager().getMilestone(proposalId, 0);
        assertEq(
            uint8(m.status),
            uint8(IProposalManager.MilestoneStatus.Approved)
        );
        assertEq(m.votesFor, 2); // member1 + member2 (1 vote each at Tier 1)
        assertEq(m.votesAgainst, 1); // member3
    }

    function testMilestoneFundRelease() public {
        // Setup with approved milestone
        vm.startPrank(organizer);

        IProposalManager.MilestoneInput[]
            memory milestones = new IProposalManager.MilestoneInput[](1);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Complete Project",
            targetAmount: 1000 * 10 ** 18
        });

        uint256 proposalId = dao.createProposal(
            "Test Campaign",
            "Description",
            1000 * 10 ** 18,
            false,
            keccak256("kyc"),
            new string[](0),
            "",
            milestones
        );

        vm.stopPrank();

        dao.updateKYCStatus(
            proposalId,
            IProposalManager.KYCStatus.Verified,
            "Verified"
        );

        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);

        vm.prank(member1);
        dao.castVote(proposalId, 1);
        vm.prank(member2);
        dao.castVote(proposalId, 1);

        vm.warp(block.timestamp + 8 days);
        dao.finalizeCommunityVote(proposalId);

        uint256 bundleId = 1;
        vm.prank(shariaCouncil1);
        dao.reviewProposal(
            bundleId,
            proposalId,
            true,
            IProposalManager.CampaignType.Normal,
            bytes32(0)
        );
        vm.prank(shariaCouncil1);
        dao.finalizeShariaBundle(bundleId);

        vm.prank(organizer);
        uint256 poolId = dao.createCampaignPool(proposalId);

        // Donate
        vm.startPrank(donor1);
        idrxToken.approve(
            address(dao.getPoolManagerAddress()),
            1000 * 10 ** 18
        );
        dao.donate(poolId, 1000 * 10 ** 18, "QmDonation");
        vm.stopPrank();

        // Submit and approve milestone
        vm.prank(organizer);
        dao.submitMilestoneProof(proposalId, 0, "QmProof");

        dao.startMilestoneVoting(proposalId, 0);

        vm.prank(member1);
        dao.voteMilestone(proposalId, 0, 1);
        vm.prank(member2);
        dao.voteMilestone(proposalId, 0, 1);

        IProposalManager.Milestone memory mBeforeFinalize = dao.proposalManager().getMilestone(
            proposalId,
            0
        );
        vm.warp(mBeforeFinalize.voteEnd + 1);
        dao.finalizeMilestoneVote(proposalId, 0);

        // Withdraw milestone funds
        uint256 organizerBalanceBefore = idrxToken.balanceOf(organizer);
        vm.prank(organizer);
        dao.withdrawMilestoneFunds(poolId, 0);

        assertEq(
            idrxToken.balanceOf(organizer),
            organizerBalanceBefore + 1000 * 10 ** 18
        );

        // Verify milestone completed
        IProposalManager.Milestone memory m = dao.proposalManager().getMilestone(proposalId, 0);
        assertEq(
            uint8(m.status),
            uint8(IProposalManager.MilestoneStatus.Completed)
        );
    }

    function testRejectFullWithdrawalWithMilestones() public {
        // Create proposal with milestones
        vm.startPrank(organizer);

        IProposalManager.MilestoneInput[]
            memory milestones = new IProposalManager.MilestoneInput[](1);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Complete Project",
            targetAmount: 1000 * 10 ** 18
        });

        uint256 proposalId = dao.createProposal(
            "Test Campaign",
            "Description",
            1000 * 10 ** 18,
            false,
            keccak256("kyc"),
            new string[](0),
            "",
            milestones
        );

        vm.stopPrank();

        dao.updateKYCStatus(
            proposalId,
            IProposalManager.KYCStatus.Verified,
            "Verified"
        );

        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);

        vm.prank(member1);
        dao.castVote(proposalId, 1);
        vm.prank(member2);
        dao.castVote(proposalId, 1);

        vm.warp(block.timestamp + 8 days);
        dao.finalizeCommunityVote(proposalId);

        uint256 bundleId = 1;
        vm.prank(shariaCouncil1);
        dao.reviewProposal(
            bundleId,
            proposalId,
            true,
            IProposalManager.CampaignType.Normal,
            bytes32(0)
        );
        vm.prank(shariaCouncil1);
        dao.finalizeShariaBundle(bundleId);

        vm.prank(organizer);
        uint256 poolId = dao.createCampaignPool(proposalId);

        // Donate first to have funds in pool
        vm.startPrank(donor1);
        idrxToken.approve(
            address(dao.getPoolManagerAddress()),
            1000 * 10 ** 18
        );
        dao.donate(poolId, 1000 * 10 ** 18, "QmDonation");
        vm.stopPrank();

        // Try to use withdrawFunds (should fail)
        vm.prank(organizer);
        vm.expectRevert("Use withdrawMilestoneFunds for milestone campaigns");
        dao.withdrawFunds(poolId);
    }

    function testMilestoneInputSecureByDesign() public {
        // SECURITY TEST: With MilestoneInput struct, users can ONLY provide
        // description and targetAmount - no way to specify malicious fields
        // like pre-approved status, fake votes, or proof
        vm.startPrank(organizer);

        // Users can only specify description and targetAmount
        // All other fields (status, votes, proof, timestamps) are
        // set by the contract - impossible to manipulate!
        IProposalManager.MilestoneInput[]
            memory milestones = new IProposalManager.MilestoneInput[](1);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Legitimate Description",
            targetAmount: 1000 * 10 ** 18
        });

        uint256 proposalId = dao.createProposal(
            "Test Campaign",
            "Description",
            1000 * 10 ** 18,
            false,
            keccak256("kyc"),
            new string[](0),
            "",
            milestones
        );

        vm.stopPrank();

        // Verify all sensitive fields are initialized to safe defaults
        IProposalManager.Milestone memory created = dao.proposalManager().getMilestone(
            proposalId,
            0
        );

        // Contract-controlled fields are properly initialized
        assertEq(
            created.milestoneId,
            0,
            "milestoneId should be set by contract"
        );
        assertEq(created.proofIPFS, "", "proofIPFS should be empty");
        assertEq(
            uint8(created.status),
            uint8(IProposalManager.MilestoneStatus.Pending),
            "status should be Pending"
        );
        assertEq(created.proofSubmittedAt, 0, "proofSubmittedAt should be 0");
        assertEq(created.voteStart, 0, "voteStart should be 0");
        assertEq(created.voteEnd, 0, "voteEnd should be 0");
        assertEq(created.votesFor, 0, "votesFor should be 0");
        assertEq(created.votesAgainst, 0, "votesAgainst should be 0");
        assertEq(created.votesAbstain, 0, "votesAbstain should be 0");
        assertEq(created.releasedAt, 0, "releasedAt should be 0");

        // User-provided fields are preserved
        assertEq(
            created.description,
            "Legitimate Description",
            "description should be preserved"
        );
        assertEq(
            created.targetAmount,
            1000 * 10 ** 18,
            "targetAmount should be preserved"
        );
    }

    function testMultipleMilestoneCompletionFlow() public {
        // Create proposal with 2 milestones
        vm.startPrank(organizer);

        IProposalManager.MilestoneInput[]
            memory milestones = new IProposalManager.MilestoneInput[](2);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Phase 1",
            targetAmount: 500 * 10 ** 18
        });
        milestones[1] = IProposalManager.MilestoneInput({
            description: "Phase 2",
            targetAmount: 500 * 10 ** 18
        });

        uint256 proposalId = dao.createProposal(
            "Test Campaign",
            "Description",
            1000 * 10 ** 18,
            false,
            keccak256("kyc"),
            new string[](0),
            "",
            milestones
        );

        vm.stopPrank();

        // Approve proposal
        dao.updateKYCStatus(
            proposalId,
            IProposalManager.KYCStatus.Verified,
            "Verified"
        );
        vm.prank(organizer);
        dao.submitForCommunityVote(proposalId);
        vm.prank(member1);
        dao.castVote(proposalId, 1);
        vm.prank(member2);
        dao.castVote(proposalId, 1);
        vm.warp(block.timestamp + 8 days);
        dao.finalizeCommunityVote(proposalId);

        uint256 bundleId = 1;
        vm.prank(shariaCouncil1);
        dao.reviewProposal(
            bundleId,
            proposalId,
            true,
            IProposalManager.CampaignType.Normal,
            bytes32(0)
        );
        vm.prank(shariaCouncil1);
        dao.finalizeShariaBundle(bundleId);

        vm.prank(organizer);
        uint256 poolId = dao.createCampaignPool(proposalId);

        // Donate
        vm.startPrank(donor1);
        idrxToken.approve(
            address(dao.getPoolManagerAddress()),
            1000 * 10 ** 18
        );
        dao.donate(poolId, 1000 * 10 ** 18, "QmDonation");
        vm.stopPrank();

        // Complete milestone 0
        vm.prank(organizer);
        dao.submitMilestoneProof(proposalId, 0, "QmProof1");
        dao.startMilestoneVoting(proposalId, 0);
        vm.prank(member1);
        dao.voteMilestone(proposalId, 0, 1);
        vm.prank(member2);
        dao.voteMilestone(proposalId, 0, 1);
        IProposalManager.Milestone memory m0 = dao.proposalManager().getMilestone(proposalId, 0);
        vm.warp(m0.voteEnd + 1);
        dao.finalizeMilestoneVote(proposalId, 0);

        uint256 organizerBalance1 = idrxToken.balanceOf(organizer);
        vm.prank(organizer);
        dao.withdrawMilestoneFunds(poolId, 0);
        assertEq(
            idrxToken.balanceOf(organizer),
            organizerBalance1 + 500 * 10 ** 18
        );

        // Complete milestone 1
        vm.prank(organizer);
        dao.submitMilestoneProof(proposalId, 1, "QmProof2");
        dao.startMilestoneVoting(proposalId, 1);
        vm.prank(member1);
        dao.voteMilestone(proposalId, 1, 1);
        vm.prank(member2);
        dao.voteMilestone(proposalId, 1, 1);
        IProposalManager.Milestone memory m1 = dao.proposalManager().getMilestone(proposalId, 1);
        vm.warp(m1.voteEnd + 1);
        dao.finalizeMilestoneVote(proposalId, 1);

        uint256 organizerBalance2 = idrxToken.balanceOf(organizer);
        vm.prank(organizer);
        dao.withdrawMilestoneFunds(poolId, 1);
        assertEq(
            idrxToken.balanceOf(organizer),
            organizerBalance2 + 500 * 10 ** 18
        );

        // Verify proposal completed
        IProposalManager.Proposal memory proposal = dao.proposalManager().getProposal(proposalId);
        assertEq(
            uint8(proposal.status),
            uint8(IProposalManager.ProposalStatus.Completed)
        );
    }
}
