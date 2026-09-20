// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Groth16Verifier.sol";
import "../src/ContributionProofRegistry.sol";

import "./ContributionProofFixture.sol";

contract ContributionProofRegistryTest is Test, ContributionProofFixture {
    Groth16Verifier public verifier;
    ContributionProofRegistry public registry;

    address public admin = address(0xAA11);
    address public officer = address(0xBB22);
    address public attacker = address(0xCC33);
    address public donor = address(0xDD44);

    string constant INSTITUTION_ID = "lpz-sinar-amanah";
    string constant CONTRIBUTION_ID = "contrib-sinar-001";
    uint256 constant BATCH_ID = 1;
    uint256 constant VERSION = 1;
    uint256 constant FUND_TYPE = 0; // ZAKAT

    function setUp() public {
        verifier = new Groth16Verifier();
        registry = new ContributionProofRegistry(address(verifier), admin);

        vm.startPrank(admin);
        registry.enrollInstitution(INSTITUTION_ID, admin);
        registry.setSigner(INSTITUTION_ID, officer, true);
        vm.stopPrank();

        loadFixture();
    }

    function test_ValidProofWithAuthorizedRoot_Success() public {
        // 1. Officer endorses the batch root
        vm.prank(officer);
        registry.endorseBatchRoot(INSTITUTION_ID, BATCH_ID, VERSION, BATCH_ROOT);

        // 2. Submit valid proof
        vm.prank(officer);
        bool success = registry.verifyAndRecordReceiptProof(
            INSTITUTION_ID,
            BATCH_ID,
            VERSION,
            CONTRIBUTION_ID,
            FUND_TYPE,
            a,
            b,
            c,
            pubSignals
        );
        assertTrue(success, "Verification must succeed");

        // 3. Inspect persistent recorded receipt state
        (
            bool isVerified,
            uint256 recBatchId,
            bytes32 recRoot,
            bytes32 recCommitment,
            uint256 verifiedAt,
            uint256 blockNumber
        ) = registry.getReceiptVerification(INSTITUTION_ID, CONTRIBUTION_ID, VERSION);

        assertTrue(isVerified, "Receipt must be recorded as verified");
        assertEq(recBatchId, BATCH_ID);
        assertEq(recRoot, BATCH_ROOT);
        assertEq(recCommitment, RECEIPT_COMMITMENT);
        assertGt(verifiedAt, 0);
        assertEq(blockNumber, block.number);
    }

    function test_IdempotentVerification_DoesNotDuplicate() public {
        vm.prank(officer);
        registry.endorseBatchRoot(INSTITUTION_ID, BATCH_ID, VERSION, BATCH_ROOT);

        vm.prank(officer);
        registry.verifyAndRecordReceiptProof(
            INSTITUTION_ID,
            BATCH_ID,
            VERSION,
            CONTRIBUTION_ID,
            FUND_TYPE,
            a,
            b,
            c,
            pubSignals
        );

        (,,,,, uint256 blockFirst) = registry.getReceiptVerification(INSTITUTION_ID, CONTRIBUTION_ID, VERSION);
        assertTrue(blockFirst > 0, "First verification must record block");

        // Roll block forward
        vm.roll(block.number + 5);

        vm.prank(officer);
        bool secondCall = registry.verifyAndRecordReceiptProof(
            INSTITUTION_ID,
            BATCH_ID,
            VERSION,
            CONTRIBUTION_ID,
            FUND_TYPE,
            a,
            b,
            c,
            pubSignals
        );
        assertTrue(secondCall, "Second call must return true");

        (,,,,, uint256 blockSecond) = registry.getReceiptVerification(INSTITUTION_ID, CONTRIBUTION_ID, VERSION);
        assertEq(blockSecond, blockFirst, "Original block must not be overwritten");
        assertTrue(blockSecond < block.number, "Record block must be older than current block");
    }

    function test_UnauthorizedBatchRoot_Reverts() public {
        // Do NOT endorse the batch root
        vm.prank(officer);
        vm.expectRevert(ContributionProofRegistry.BatchNotFound.selector);
        registry.verifyAndRecordReceiptProof(
            INSTITUTION_ID,
            BATCH_ID,
            VERSION,
            CONTRIBUTION_ID,
            FUND_TYPE,
            a,
            b,
            c,
            pubSignals
        );

        // Now endorse a DIFFERENT root (attacker root)
        bytes32 differentRoot = bytes32(uint256(12345));
        vm.prank(officer);
        registry.endorseBatchRoot(INSTITUTION_ID, BATCH_ID, VERSION, differentRoot);

        // Submitting proof for BATCH_ROOT must revert with UnauthorizedBatchRoot
        vm.prank(officer);
        vm.expectRevert(ContributionProofRegistry.UnauthorizedBatchRoot.selector);
        registry.verifyAndRecordReceiptProof(
            INSTITUTION_ID,
            BATCH_ID,
            VERSION,
            CONTRIBUTION_ID,
            FUND_TYPE,
            a,
            b,
            c,
            pubSignals
        );
    }

    function test_AttackerCannotEndorseRoot() public {
        vm.prank(attacker);
        vm.expectRevert(ContributionProofRegistry.Unauthorized.selector);
        registry.endorseBatchRoot(INSTITUTION_ID, BATCH_ID, VERSION, BATCH_ROOT);
    }

    function test_StatementManipulation_WrongInstitution_Reverts() public {
        vm.prank(officer);
        registry.endorseBatchRoot(INSTITUTION_ID, BATCH_ID, VERSION, BATCH_ROOT);

        // Try verifying with a different institution ID
        vm.prank(officer);
        vm.expectRevert(ContributionProofRegistry.BatchNotFound.selector);
        registry.verifyAndRecordReceiptProof(
            "lpz-baitul-maal",
            BATCH_ID,
            VERSION,
            CONTRIBUTION_ID,
            FUND_TYPE,
            a,
            b,
            c,
            pubSignals
        );
    }

    function test_StatementManipulation_WrongContributionId_Reverts() public {
        vm.prank(officer);
        registry.endorseBatchRoot(INSTITUTION_ID, BATCH_ID, VERSION, BATCH_ROOT);

        // Try verifying with a different contribution ID
        vm.prank(officer);
        vm.expectRevert(ContributionProofRegistry.InvalidStatementBinding.selector);
        registry.verifyAndRecordReceiptProof(
            INSTITUTION_ID,
            BATCH_ID,
            VERSION,
            "contrib-fake-999",
            FUND_TYPE,
            a,
            b,
            c,
            pubSignals
        );
    }

    function test_TamperedProofBytes_Reverts() public {
        vm.prank(officer);
        registry.endorseBatchRoot(INSTITUTION_ID, BATCH_ID, VERSION, BATCH_ROOT);

        // Corrupt proof point a
        uint256[2] memory corruptedA = [a[0] + 1, a[1]];

        vm.prank(officer);
        vm.expectRevert(ContributionProofRegistry.InvalidProof.selector);
        registry.verifyAndRecordReceiptProof(
            INSTITUTION_ID,
            BATCH_ID,
            VERSION,
            CONTRIBUTION_ID,
            FUND_TYPE,
            corruptedA,
            b,
            c,
            pubSignals
        );
    }

    function test_ReceiptVersionReplay_Reverts() public {
        vm.prank(officer);
        registry.endorseBatchRoot(INSTITUTION_ID, BATCH_ID, VERSION, BATCH_ROOT);
        vm.expectRevert(ContributionProofRegistry.InvalidStatementBinding.selector);
        registry.verifyAndRecordReceiptProof(INSTITUTION_ID, BATCH_ID, 999, CONTRIBUTION_ID, FUND_TYPE, a, b, c, pubSignals);
    }

    function test_BatchReplay_RevertsEvenWhenRootIsCopied() public {
        vm.startPrank(officer);
        registry.endorseBatchRoot(INSTITUTION_ID, 2, VERSION, BATCH_ROOT);
        vm.expectRevert(ContributionProofRegistry.InvalidStatementBinding.selector);
        registry.verifyAndRecordReceiptProof(INSTITUTION_ID, 2, VERSION, CONTRIBUTION_ID, FUND_TYPE, a, b, c, pubSignals);
        vm.stopPrank();
    }

    function test_GasMeasurement_VerifyAndRecordReceiptProof() public {
        vm.prank(officer);
        registry.endorseBatchRoot(INSTITUTION_ID, BATCH_ID, VERSION, BATCH_ROOT);

        uint256 gasBefore = gasleft();
        vm.prank(officer);
        registry.verifyAndRecordReceiptProof(
            INSTITUTION_ID,
            BATCH_ID,
            VERSION,
            CONTRIBUTION_ID,
            FUND_TYPE,
            a,
            b,
            c,
            pubSignals
        );
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for verifyAndRecordReceiptProof", gasUsed);

        // Groth16 verification + persistent storage is ~433k gas
        assertLt(gasUsed, 500000, "Gas used must be economical (< 500,000 gas)");
    }
}
