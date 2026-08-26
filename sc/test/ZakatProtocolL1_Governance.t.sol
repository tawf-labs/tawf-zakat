// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ZakatProtocolL1.sol";
import "./mocks/MockUSDC.sol";

contract ZakatProtocolL1GovernanceTest is Test {
    ZakatProtocolL1 public protocol;
    MockUSDC public usdc;

    address public admin = address(0x1111);
    address public relayer = address(0x2222);
    address public dps = address(0x3333);
    address public auditor = address(0x4444);
    address public donor = address(0x5555);
    address public mustahik = address(0x6666);

    bytes32 public constant SAMPLE_BENEFICIARY = keccak256(abi.encodePacked("3201012345670001", "Fulan", "secret_salt_123"));
    string public constant SAMPLE_IPFS_CID = "QmZtmD2qt8fJpq3CLDHVSS5DV7hgqseifznGRubWN15w53";

    event DisbursementProposed(uint256 indexed proposalId, uint8 currencyType, uint256 amount, bytes32 beneficiaryHash, string ipfsProofCID);
    event DisbursementApproved(uint256 indexed proposalId, address indexed approver, uint256 currentApprovals);
    event DisbursementExecuted(uint256 indexed proposalId, uint8 currencyType, uint256 amount, bytes32 beneficiaryHash, string ipfsProofCID);
    event DisbursementCancelled(uint256 indexed proposalId, address indexed canceller, string reason);

    function setUp() public {
        usdc = new MockUSDC();
        protocol = new ZakatProtocolL1(
            address(usdc),
            admin,
            relayer,
            dps,
            auditor
        );

        // Fund protocol with USDC deposit
        usdc.mint(donor, 10_000 * 1e6);
        vm.prank(donor);
        usdc.approve(address(protocol), type(uint256).max);
        vm.prank(donor);
        protocol.depositUSDC(10_000 * 1e6, false, bytes32(0)); // Mustahik vault: 8,750 USDC

        // Fund protocol with Fiat batch
        vm.prank(relayer);
        protocol.recordFiatBatchSettlement(1, keccak256("root1"), 100_000_000); // Mustahik vault: 87.5M IDR
    }

    function test_ProposeDisbursement_USDC_Success() public {
        uint256 amountUSDC = 500 * 1e6; // 500 USDC

        vm.prank(admin);
        uint256 proposalId = protocol.proposeDisbursement(
            1, // USDC
            amountUSDC,
            0, // Fakir
            SAMPLE_BENEFICIARY,
            SAMPLE_IPFS_CID,
            202608, // Period ID: Aug 2026
            mustahik
        );

        assertEq(proposalId, 1);
        (
            uint256 id,
            uint8 currencyType,
            uint256 amount,
            uint8 asnaf,
            bytes32 benHash,
            string memory cid,
            uint256 period,
            address recipient,
            uint256 approvals,
            ZakatProtocolL1.ProposalStatus status
        ) = protocol.proposals(proposalId);

        assertEq(id, 1);
        assertEq(currencyType, 1);
        assertEq(amount, amountUSDC);
        assertEq(asnaf, 0);
        assertEq(benHash, SAMPLE_BENEFICIARY);
        assertEq(cid, SAMPLE_IPFS_CID);
        assertEq(period, 202608);
        assertEq(recipient, mustahik);
        assertEq(approvals, 1);
        assertTrue(status == ZakatProtocolL1.ProposalStatus.Pending);
    }

    function test_MultiSig_2of3_USDC_Execution_Success() public {
        uint256 amountUSDC = 500 * 1e6;

        // 1. Propose by Admin (Approval count = 1)
        vm.prank(admin);
        uint256 proposalId = protocol.proposeDisbursement(
            1,
            amountUSDC,
            0,
            SAMPLE_BENEFICIARY,
            SAMPLE_IPFS_CID,
            202608,
            mustahik
        );

        // 2. Approve by Sharia Supervisor / DPS (Approval count = 2 -> Approved status)
        vm.prank(dps);
        protocol.approveDisbursement(proposalId);

        (,,,,,,,, uint256 approvals, ZakatProtocolL1.ProposalStatus status) = protocol.proposals(proposalId);
        assertEq(approvals, 2);
        assertTrue(status == ZakatProtocolL1.ProposalStatus.Approved);

        // 3. Execute by Relayer / Anyone once quorum is met
        uint256 mustahikInitialUSDC = usdc.balanceOf(mustahik);
        uint256 vaultInitialUSDC = protocol.mustahikVaultUSDC();

        protocol.executeDisbursement(proposalId);

        // Verify balances & anti-double claim
        assertEq(usdc.balanceOf(mustahik), mustahikInitialUSDC + amountUSDC);
        assertEq(protocol.mustahikVaultUSDC(), vaultInitialUSDC - amountUSDC);
        assertEq(protocol.totalDisbursedUSDC(), amountUSDC);
        assertTrue(protocol.hasReceivedZakat(SAMPLE_BENEFICIARY, 202608));
    }

    function test_MultiSig_2of3_Fiat_Execution_Success() public {
        uint256 amountIDR = 5_000_000; // 5 Juta IDR

        // 1. Propose by Relayer (Approval count = 1)
        vm.prank(relayer);
        uint256 proposalId = protocol.proposeDisbursement(
            0, // Fiat IDR
            amountIDR,
            1, // Miskin
            SAMPLE_BENEFICIARY,
            SAMPLE_IPFS_CID,
            202608,
            address(0)
        );

        // 2. Approve by Auditor (Approval count = 2)
        vm.prank(auditor);
        protocol.approveDisbursement(proposalId);

        // 3. Execute
        uint256 vaultInitialIDR = protocol.mustahikVaultIDR();
        protocol.executeDisbursement(proposalId);

        assertEq(protocol.mustahikVaultIDR(), vaultInitialIDR - amountIDR);
        assertEq(protocol.totalDisbursedIDR(), amountIDR);
        assertTrue(protocol.hasReceivedZakat(SAMPLE_BENEFICIARY, 202608));
    }

    function test_Revert_Execution_WithoutQuorum() public {
        uint256 amountUSDC = 500 * 1e6;

        // Propose only (1 approval)
        vm.prank(admin);
        uint256 proposalId = protocol.proposeDisbursement(
            1,
            amountUSDC,
            0,
            SAMPLE_BENEFICIARY,
            SAMPLE_IPFS_CID,
            202608,
            mustahik
        );

        // Try to execute without 2nd approval
        vm.expectRevert(ZakatProtocolL1.QuorumNotMet.selector);
        protocol.executeDisbursement(proposalId);
    }

    function test_Revert_DuplicateApproval_SameAddress() public {
        vm.prank(admin);
        uint256 proposalId = protocol.proposeDisbursement(
            1,
            500 * 1e6,
            0,
            SAMPLE_BENEFICIARY,
            SAMPLE_IPFS_CID,
            202608,
            mustahik
        );

        // Admin tries to approve again
        vm.prank(admin);
        vm.expectRevert(ZakatProtocolL1.AlreadyApproved.selector);
        protocol.approveDisbursement(proposalId);
    }

    function test_Revert_DoubleClaim_SamePeriod() public {
        uint256 amountUSDC = 500 * 1e6;

        // First disbursement for SAMPLE_BENEFICIARY in 202608
        vm.prank(admin);
        uint256 p1 = protocol.proposeDisbursement(1, amountUSDC, 0, SAMPLE_BENEFICIARY, SAMPLE_IPFS_CID, 202608, mustahik);
        vm.prank(dps);
        protocol.approveDisbursement(p1);
        protocol.executeDisbursement(p1);

        // Attempting second proposal for same beneficiary in same period reverts
        vm.prank(admin);
        vm.expectRevert(ZakatProtocolL1.DoubleClaimDetected.selector);
        protocol.proposeDisbursement(1, amountUSDC, 0, SAMPLE_BENEFICIARY, SAMPLE_IPFS_CID, 202608, mustahik);
    }

    function test_CancelProposal_Success_ByDPS() public {
        vm.prank(admin);
        uint256 p1 = protocol.proposeDisbursement(1, 500 * 1e6, 0, SAMPLE_BENEFICIARY, SAMPLE_IPFS_CID, 202608, mustahik);

        vm.expectEmit(true, false, false, true);
        emit DisbursementCancelled(p1, dps, "Berkas mustahik tidak memenuhi kriteria asnaf");

        vm.prank(dps);
        protocol.cancelProposal(p1, "Berkas mustahik tidak memenuhi kriteria asnaf");

        (,,,,,,,,, ZakatProtocolL1.ProposalStatus status) = protocol.proposals(p1);
        assertTrue(status == ZakatProtocolL1.ProposalStatus.Cancelled);

        // Cancelled proposal cannot be approved
        vm.prank(auditor);
        vm.expectRevert(ZakatProtocolL1.ProposalNotPending.selector);
        protocol.approveDisbursement(p1);

        // Cancelled proposal cannot be executed
        vm.expectRevert(ZakatProtocolL1.QuorumNotMet.selector);
        protocol.executeDisbursement(p1);
    }

    function test_CancelProposal_Success_ByAdmin() public {
        vm.prank(admin);
        uint256 p1 = protocol.proposeDisbursement(1, 500 * 1e6, 0, SAMPLE_BENEFICIARY, SAMPLE_IPFS_CID, 202608, mustahik);

        vm.prank(admin);
        protocol.cancelProposal(p1, "Salah input nominal");

        (,,,,,,,,, ZakatProtocolL1.ProposalStatus status) = protocol.proposals(p1);
        assertTrue(status == ZakatProtocolL1.ProposalStatus.Cancelled);
    }

    function test_CancelProposal_Revert_Unauthorized() public {
        vm.prank(admin);
        uint256 p1 = protocol.proposeDisbursement(1, 500 * 1e6, 0, SAMPLE_BENEFICIARY, SAMPLE_IPFS_CID, 202608, mustahik);

        vm.prank(donor);
        vm.expectRevert(ZakatProtocolL1.Unauthorized.selector);
        protocol.cancelProposal(p1, "Unauthorized");
    }

    function test_Allow_DifferentPeriod_SameBeneficiary() public {
        uint256 amountUSDC = 500 * 1e6;

        // Period 202608
        vm.prank(admin);
        uint256 p1 = protocol.proposeDisbursement(1, amountUSDC, 0, SAMPLE_BENEFICIARY, SAMPLE_IPFS_CID, 202608, mustahik);
        vm.prank(dps);
        protocol.approveDisbursement(p1);
        protocol.executeDisbursement(p1);

        // Next month: Period 202609 (Should be allowed)
        vm.prank(admin);
        uint256 p2 = protocol.proposeDisbursement(1, amountUSDC, 0, SAMPLE_BENEFICIARY, SAMPLE_IPFS_CID, 202609, mustahik);
        assertEq(p2, 2);
    }
}
