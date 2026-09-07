// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {Test} from "forge-std/Test.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";

contract RegistryHandler is Test {
    Registry public registry;
    address public signer;
    uint256 private constant KEY = 0x9876;
    uint256 public accepted;
    mapping(uint256 => bytes32) public expected;
    constructor() {
        signer = vm.addr(KEY);
        registry = new Registry(address(this));
        registry.enrollInstitution("a", address(this));
        registry.enrollInstitution("b", address(this));
        registry.setSignatory("a", signer, true);
    }
    function authorization(uint256 id, uint256 epoch) internal view returns (Registry.Authorization memory) {
        return Registry.Authorization(keccak256("RECORD_EVIDENCE"), "a", "report", "1", vm.toString(id), "", keccak256(abi.encode(id)), "policy", "DITOLAK", signer, epoch, bytes32(id + 1), type(uint256).max);
    }
    function sign(Registry.Authorization memory a) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, registry.authorizationDigest(a));
        return abi.encodePacked(r, s, v);
    }
    function record() external {
        (, uint256 epoch) = registry.signatories(keccak256("a"), signer);
        Registry.Authorization memory a = authorization(accepted, epoch);
        registry.recordEvidence(a, sign(a));
        expected[accepted++] = a.digest;
    }
    function rotateAndTryOldMandate() external {
        (, uint256 epoch) = registry.signatories(keccak256("a"), signer);
        Registry.Authorization memory a = authorization(accepted, epoch);
        bytes memory signature = sign(a);
        registry.setSignatory("a", signer, false);
        registry.setSignatory("a", signer, true);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.recordEvidence(a, signature);
    }
    function attemptCrossInstitution(uint256 seed) external {
        (, uint256 epoch) = registry.signatories(keccak256("a"), signer);
        Registry.Authorization memory a = authorization(seed % 100, epoch);
        a.institutionId = "b";
        bytes memory signature = sign(a);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.recordEvidence(a, signature);
    }
    function attemptReplayOrOverwrite(uint256 seed) external {
        if (accepted == 0) return;
        uint256 id = seed % accepted;
        (, uint256 epoch) = registry.signatories(keccak256("a"), signer);
        Registry.Authorization memory a = authorization(id, epoch);
        a.packageId = "replay-target";
        bytes memory signature = sign(a);
        vm.expectRevert(Registry.Replayed.selector);
        registry.recordEvidence(a, signature);
        a.packageId = vm.toString(id);
        a.nonce = keccak256("fresh authorization cannot overwrite history");
        a.digest = keccak256("different content");
        signature = sign(a);
        vm.expectRevert(Registry.AlreadyRecorded.selector);
        registry.recordEvidence(a, signature);
    }
}
contract ReportEvidenceRegistryInvariantTest is Test {
    RegistryHandler handler;
    function setUp() public {
        handler = new RegistryHandler();
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = handler.record.selector;
        selectors[1] = handler.rotateAndTryOldMandate.selector;
        selectors[2] = handler.attemptCrossInstitution.selector;
        selectors[3] = handler.attemptReplayOrOverwrite.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }
    function invariant_HistoryIsImmutableIsolatedAndAuthorizationIsUsedOnce() public view {
        Registry registry = handler.registry();
        for (uint256 i; i < handler.accepted(); i++) {
            assertEq(registry.evidenceDigest("a", vm.toString(i)), handler.expected(i));
            assertEq(registry.evidenceDigest("b", vm.toString(i)), bytes32(0));
            assertTrue(registry.usedNonces(keccak256("a"), handler.signer(), bytes32(i + 1)));
        }
        assertEq(registry.evidenceDigest("a", "replay-target"), bytes32(0));
    }
}
