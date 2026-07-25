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
import "@tawf-gov/identity/TawfPassport.sol";
import {PassportType} from "@tawf-gov/interfaces/ITawfPassport.sol";

/**
 * @title CoreTeamTest
 * @notice Proves that all contracts can be deployed with a single core team address
 *         holding ALL roles, functioning as an interim centralized DAO.
 *
 *         The core team can:
 *         1. Create proposals and fast-track them through governance alone
 *         2. Create campaign pools
 *         3. Accept public/private donations
 *         4. Transition to community governance by granting roles to others
 */
contract CoreTeamTest is Test {
    MockIDRX public idrx;
    DonationReceiptNFT public receiptNFT;
    VotingNFT public votingNFT;
    ParticipationTracker public tracker;
    ZKTCore public dao;
    ProposalManager public pm;
    PoolManager public poolMgr;
    ZakatEscrowManager public escrow;
    PrivateDonationPool public privatePool;

    address public coreTeam = address(0xC07E);
    address public donor = address(0xD0D0);

    function setUp() public {
        vm.startPrank(coreTeam);

        // Deploy tokens
        idrx = new MockIDRX();
        receiptNFT = new DonationReceiptNFT();
        votingNFT = new VotingNFT();
        tracker = new ParticipationTracker();

        // ZK infra
        HonkVerifier honk = new HonkVerifier();
        NullifierRegistry nullifierReg = new NullifierRegistry();
        privatePool = new PrivateDonationPool(address(idrx));

        // Managers
        pm = new ProposalManager();
        VotingManager vmgr = new VotingManager(address(pm), address(votingNFT));
        ShariaReviewManager srm = new ShariaReviewManager(address(pm), address(honk));
        poolMgr = new PoolManager(address(pm), address(idrx), address(receiptNFT));
        escrow = new ZakatEscrowManager(address(pm), address(idrx), address(receiptNFT));
        MilestoneManager mm = new MilestoneManager(address(pm), address(votingNFT));

        // Orchestrator
        dao = new ZKTCore(
            address(idrx), address(receiptNFT), address(votingNFT), address(tracker),
            address(pm), address(vmgr), address(srm),
            address(poolMgr), address(escrow), address(mm),
            address(honk), address(nullifierReg),
            address(privatePool)
        );

        // Grant roles to ZKTCore on sub-contracts (ZKTCore is the caller)
        pm.grantRole(pm.ORGANIZER_ROLE(), address(dao));
        pm.grantRole(pm.ADMIN_ROLE(), address(dao));
        pm.grantRole(pm.KYC_ORACLE_ROLE(), address(dao));

        receiptNFT.grantRole(receiptNFT.MINTER_ROLE(), address(dao));
        receiptNFT.grantRole(receiptNFT.MINTER_ROLE(), address(poolMgr));
        receiptNFT.grantRole(receiptNFT.MINTER_ROLE(), address(escrow));

        votingNFT.grantRole(votingNFT.MINTER_ROLE(), address(dao));
        votingNFT.grantRole(votingNFT.ADMIN_ROLE(), address(dao));

        srm.grantRole(srm.SHARIA_COUNCIL_ROLE(), address(dao));
        srm.grantRole(srm.ADMIN_ROLE(), address(dao));

        poolMgr.grantRole(poolMgr.ADMIN_ROLE(), address(dao));
        poolMgr.grantRole(poolMgr.CORE_ROLE(), address(dao));

        escrow.grantRole(escrow.ADMIN_ROLE(), address(dao));
        escrow.grantRole(escrow.SHARIA_COUNCIL_ROLE(), address(dao));

        privatePool.grantRole(privatePool.CORE_ROLE(), address(dao));

        mm.grantRole(mm.ORGANIZER_ROLE(), address(dao));

        tracker.grantRole(tracker.TRACKER_ROLE(), address(dao));
        tracker.grantRole(tracker.VERIFIER_ROLE(), address(dao));

        // Cross-module permissions (VotingManager/ShariaReviewManager need VOTING_MANAGER_ROLE)
        pm.grantRole(pm.VOTING_MANAGER_ROLE(), address(vmgr));
        pm.grantRole(pm.VOTING_MANAGER_ROLE(), address(srm));
        pm.grantRole(pm.VOTING_MANAGER_ROLE(), address(poolMgr));
        pm.grantRole(pm.VOTING_MANAGER_ROLE(), address(escrow));
        pm.grantRole(pm.MILESTONE_MANAGER_ROLE(), address(mm));
        pm.grantRole(pm.MILESTONE_MANAGER_ROLE(), address(poolMgr));

        // Passport wiring: ProposalManager.createProposal requires an
        // Organization passport and reverts calling address(0) without one.
        TawfPassport tawfPassport = new TawfPassport();
        pm.setTawfPassport(address(tawfPassport));
        tawfPassport.issuePassport(coreTeam, PassportType.Organization, "ipfs://coreteam");

        // Grant ZKTCore-level roles to core team
        dao.grantOrganizerRole(coreTeam);
        dao.grantShariaCouncilRole(coreTeam);
        dao.grantKYCOracleRole(coreTeam);

        escrow.setDefaultFallbackPool(coreTeam);

        vm.stopPrank();

        // Give donor some IDRX via admin mint
        vm.startPrank(coreTeam);
        idrx.adminMint(donor, 10000 ether);
        vm.stopPrank();
        vm.startPrank(donor);
        idrx.approve(address(escrow), type(uint256).max);
        idrx.approve(address(poolMgr), type(uint256).max);
        vm.stopPrank();
    }

    /**
     * @notice Core team fast-tracks a proposal through all governance stages alone.
     *         This proves centralized control is possible without external actors.
     */
    function test_coreTeamFastTracksProposalAndCreatesPool() public {
        vm.startPrank(coreTeam);

        // Lower sharia quorum to 1 (core team is sole reviewer)
        dao.setShariaQuorum(1);

        IProposalManager.MilestoneInput[] memory milestones = new IProposalManager.MilestoneInput[](2);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Initial aid distribution",
            targetAmount: 500 ether
        });
        milestones[1] = IProposalManager.MilestoneInput({
            description: "Final aid distribution",
            targetAmount: 500 ether
        });

        string[] memory checklist = new string[](1);
        checklist[0] = "Verified mustahik eligibility";

        // 1. Create proposal
        uint256 propId = dao.createProposal(
            "Emergency Food Relief",
            "Food package distribution for 100 families",
            1000 ether,
            false,
            bytes32(0),
            checklist,
            "ipfs://proposal",
            milestones
        );
        assertEq(propId, 1);

        // 2. KYC approval
        dao.updateKYCStatus(propId, IProposalManager.KYCStatus.Verified, "KYC passed");

        // 3. Grant voting power
        dao.grantVotingNFT(coreTeam, "ipfs://core-voter");
        dao.verifyVoter(coreTeam);

        // 4. Submit and vote
        dao.submitForCommunityVote(propId);
        dao.castVote(propId, 1);
        vm.warp(block.timestamp + 7 days + 1);

        // 5. Finalize vote (auto-creates sharia bundle)
        dao.finalizeCommunityVote(propId);
        uint256 bundleId = 1;

        // 6. Single sharia review (quorum=1)
        dao.reviewProposal(bundleId, propId, true,
            IProposalManager.CampaignType.ZakatCompliant, bytes32(0));
        dao.finalizeShariaBundle(bundleId);

        // 7. Verify + create pool
        IProposalManager.Proposal memory p = pm.getProposal(propId);
        assertEq(uint256(p.status), uint256(IProposalManager.ProposalStatus.ShariaApproved));

        uint256 poolId = dao.createCampaignPool(propId, coreTeam);
        assertEq(poolId, 1);

        vm.stopPrank();
    }

    /**
     * @notice After pool creation, donors can donate normally.
     *         This is the actual "core only" user flow.
     */
    function test_donorDonatesToCoreTeamManagedPool() public {
        // Core team fast-tracks to create pool
        vm.startPrank(coreTeam);

        dao.setShariaQuorum(1);

        // Grant voting power
        dao.grantVotingNFT(coreTeam, "ipfs://core-voter");
        dao.verifyVoter(coreTeam);

        IProposalManager.MilestoneInput[] memory milestones = new IProposalManager.MilestoneInput[](1);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Full aid", targetAmount: 500 ether
        });

        string[] memory checklist = new string[](1);
        checklist[0] = "Verified";

        uint256 propId = dao.createProposal(
            "Zakat Fund", "Desc", 500 ether, false,
            bytes32(0), checklist, "ipfs://prop", milestones
        );
        dao.updateKYCStatus(propId, IProposalManager.KYCStatus.Verified, "OK");
        dao.submitForCommunityVote(propId);
        dao.castVote(propId, 1);
        vm.warp(block.timestamp + 7 days + 1);
        dao.finalizeCommunityVote(propId);
        dao.reviewProposal(1, propId, true,
            IProposalManager.CampaignType.ZakatCompliant, bytes32(0));
        dao.finalizeShariaBundle(1);
        uint256 poolId = dao.createCampaignPool(propId, coreTeam);

        vm.stopPrank();

        // Now a donor donates
        vm.startPrank(donor);
        uint256 amount = 100 ether;
        dao.donate(poolId, amount, "ipfs://donation1");

        // Verify donation receipt NFT was minted
        assertEq(receiptNFT.balanceOf(donor), 1);
        assertEq(idrx.balanceOf(address(escrow)), amount);

        vm.stopPrank();
    }

    /**
     * @notice The core team can transition power by granting individual roles.
     */
    function test_coreTeamGraduallyGrantsRolesToCommunity() public {
        address communityOrganizer = address(0xB0B1);
        address communityCouncil = address(0xC0C1);

        vm.startPrank(coreTeam);

        // Grant ORGANIZER_ROLE to a community member
        dao.grantOrganizerRole(communityOrganizer);
        assertTrue(dao.hasRole(dao.ORGANIZER_ROLE(), communityOrganizer));

        // Grant SHARIA_COUNCIL_ROLE to a community member
        dao.grantShariaCouncilRole(communityCouncil);
        assertTrue(dao.hasRole(dao.SHARIA_COUNCIL_ROLE(), communityCouncil));

        // Core team still has DEFAULT_ADMIN_ROLE (ultimate control)
        assertTrue(dao.hasRole(dao.DEFAULT_ADMIN_ROLE(), coreTeam));

        vm.stopPrank();
    }

    /** Helper: wrap single proposalId in array */
    function _idArray(uint256 id) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = id;
    }
}
