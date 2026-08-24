// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ZakatProtocolL1.sol";
import "./mocks/MockUSDC.sol";

contract ZakatProtocolL1Test is Test {
    ZakatProtocolL1 public protocol;
    MockUSDC public usdc;

    address public admin = address(0x1111);
    address public relayer = address(0x2222);
    address public dps = address(0x3333);
    address public auditor = address(0x4444);
    address public donor = address(0x5555);

    event FiatBatchSettled(uint256 indexed batchId, bytes32 merkleRoot, uint256 totalAmountIDR);
    event USDCDeposited(address indexed donor, uint256 amountUSDC, bool isAnonymous, bytes32 commitmentHash);

    function setUp() public {
        usdc = new MockUSDC();
        protocol = new ZakatProtocolL1(
            address(usdc),
            admin,
            relayer,
            dps,
            auditor
        );

        usdc.mint(donor, 10_000 * 1e6); // 10,000 USDC
        vm.prank(donor);
        usdc.approve(address(protocol), type(uint256).max);
    }

    function test_InitialRoles() public view {
        assertTrue(protocol.hasRole(protocol.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(protocol.hasRole(protocol.RELAYER_ROLE(), relayer));
        assertTrue(protocol.hasRole(protocol.SHARIA_SUPERVISOR_ROLE(), dps));
        assertTrue(protocol.hasRole(protocol.AUDITOR_ROLE(), auditor));
    }

    function test_DepositUSDC_Public() public {
        uint256 depositAmount = 1000 * 1e6; // 1,000 USDC

        vm.expectEmit(true, false, false, true);
        emit USDCDeposited(donor, depositAmount, false, bytes32(0));

        vm.prank(donor);
        protocol.depositUSDC(depositAmount, false, bytes32(0));

        // MAX_AMIL_BPS = 1250 (12.5%)
        uint256 expectedAmil = (depositAmount * 1250) / 10000; // 125 USDC
        uint256 expectedMustahik = depositAmount - expectedAmil; // 875 USDC

        assertEq(protocol.totalCollectedUSDC(), depositAmount);
        assertEq(protocol.amilTreasuryUSDC(), expectedAmil);
        assertEq(protocol.mustahikVaultUSDC(), expectedMustahik);
        assertEq(usdc.balanceOf(address(protocol)), depositAmount);
    }

    function test_DepositUSDC_Anonymous() public {
        uint256 depositAmount = 500 * 1e6;
        bytes32 commitment = keccak256(abi.encodePacked("secret-donor-commitment"));

        vm.expectEmit(true, false, false, true);
        emit USDCDeposited(address(0), depositAmount, true, commitment);

        vm.prank(donor);
        protocol.depositUSDC(depositAmount, true, commitment);

        assertEq(protocol.totalCollectedUSDC(), depositAmount);
    }

    function test_RecordFiatBatchSettlement_Success() public {
        uint256 batchId = 1;
        bytes32 merkleRoot = keccak256(abi.encodePacked("batch-1-root"));
        uint256 batchAmountIDR = 100_000_000; // 100 juta IDR

        vm.expectEmit(true, false, false, true);
        emit FiatBatchSettled(batchId, merkleRoot, batchAmountIDR);

        vm.prank(relayer);
        protocol.recordFiatBatchSettlement(batchId, merkleRoot, batchAmountIDR);

        uint256 expectedAmil = (batchAmountIDR * 1250) / 10000; // 12.5 juta IDR
        uint256 expectedMustahik = batchAmountIDR - expectedAmil; // 87.5 juta IDR

        assertEq(protocol.totalCollectedIDR(), batchAmountIDR);
        assertEq(protocol.amilTreasuryIDR(), expectedAmil);
        assertEq(protocol.mustahikVaultIDR(), expectedMustahik);
        assertEq(protocol.fiatBatchRoots(batchId), merkleRoot);
    }

    function test_RecordFiatBatchSettlement_RevertNonRelayer() public {
        uint256 batchId = 1;
        bytes32 merkleRoot = keccak256(abi.encodePacked("batch-1-root"));

        vm.prank(donor);
        vm.expectRevert();
        protocol.recordFiatBatchSettlement(batchId, merkleRoot, 10_000_000);
    }

    function test_RecordFiatBatchSettlement_RevertAlreadySettled() public {
        uint256 batchId = 1;
        bytes32 merkleRoot = keccak256(abi.encodePacked("batch-1-root"));

        vm.prank(relayer);
        protocol.recordFiatBatchSettlement(batchId, merkleRoot, 10_000_000);

        vm.prank(relayer);
        vm.expectRevert("Batch already settled");
        protocol.recordFiatBatchSettlement(batchId, merkleRoot, 10_000_000);
    }

    function test_DepositUSDC_RevertZeroAmount() public {
        vm.prank(donor);
        vm.expectRevert("Amount must be > 0");
        protocol.depositUSDC(0, false, bytes32(0));
    }

    function test_RecordFiatBatchSettlement_RevertZeroAmount() public {
        vm.prank(relayer);
        vm.expectRevert("Batch amount must be > 0");
        protocol.recordFiatBatchSettlement(99, keccak256("root"), 0);
    }

    function testFuzz_InvariantSplitUSDC(uint256 amount) public {
        vm.assume(amount > 100 && amount <= 1_000_000 * 1e6);
        usdc.mint(donor, amount);

        vm.prank(donor);
        protocol.depositUSDC(amount, false, bytes32(0));

        uint256 expectedAmil = (amount * 1250) / 10000;
        uint256 expectedMustahik = amount - expectedAmil;

        assertEq(protocol.amilTreasuryUSDC(), expectedAmil);
        assertEq(protocol.mustahikVaultUSDC(), expectedMustahik);
        assertEq(protocol.amilTreasuryUSDC() + protocol.mustahikVaultUSDC(), amount);
    }
}
