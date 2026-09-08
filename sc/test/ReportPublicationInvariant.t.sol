// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {Test} from "forge-std/Test.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";
contract PublicationHandler is Test {
    Registry public registry;
    uint256 constant KEY = 0x1234;
    uint256 constant VALIDATOR = 0x5678;
    uint256 public attempts;
    bytes32 public acceptedDigest;
    bytes32 public institutionNonce;
    bytes32 public validatorNonce;
    constructor() {
        registry = new Registry(address(this));
        registry.enrollInstitution("a", address(this));
        registry.enrollInstitution("b", address(this));
        registry.setSignatory("a", vm.addr(KEY), true);
        registry.setValidator(vm.addr(VALIDATOR), true);
    }
    function signature(Registry.Authorization memory a, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.authorizationDigest(a));
        return abi.encodePacked(r, s, v);
    }
    function attempt(bool crossInstitution, bool wrongDigest) external {
        attempts++;
        (, uint256 epoch) = registry.signatories(keccak256("a"), vm.addr(KEY));
        (, uint256 validatorEpoch) = registry.validators(vm.addr(VALIDATOR));
        Registry.Authorization memory a = Registry.Authorization(keccak256("PUBLISH_REPORT"), crossInstitution ? "b" : "a", "report", "1", "package", "", keccak256(abi.encode(attempts)), "policy", "LOLOS", vm.addr(KEY), epoch, bytes32(attempts), type(uint256).max);
        Registry.Authorization memory v = Registry.Authorization(keccak256("VALIDATE_REPORT"), a.institutionId, a.reportId, a.version, a.packageId, "", wrongDigest ? keccak256("wrong") : a.digest, "policy", "LOLOS", vm.addr(VALIDATOR), validatorEpoch, bytes32(attempts), type(uint256).max);
        try registry.publishReport(a, signature(a, KEY), v, signature(v, VALIDATOR)) {
            assertEq(acceptedDigest, bytes32(0));
            assertFalse(crossInstitution || wrongDigest);
            acceptedDigest = a.digest; institutionNonce = a.nonce; validatorNonce = v.nonce;
        } catch {}
    }
    function rotate(bool active) external { registry.setValidator(vm.addr(VALIDATOR), active); }
    function check() external view {
        assertEq(registry.publishedVersion("a", "report", "1").institution.digest, acceptedDigest);
        assertEq(registry.latestPublishedPackage("b", "report"), "");
        if (acceptedDigest != bytes32(0)) {
            assertEq(registry.latestPublishedPackage("a", "report"), "package");
            assertTrue(registry.usedNonces(keccak256("a"), vm.addr(KEY), institutionNonce));
            assertTrue(registry.usedNonces(keccak256("a"), vm.addr(VALIDATOR), validatorNonce));
        }
    }
}
contract ReportPublicationInvariantTest is Test {
    PublicationHandler handler;
    function setUp() public {
        handler = new PublicationHandler(); targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = handler.attempt.selector; selectors[1] = handler.rotate.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }
    function invariant_OnlyOneImmutableVersionWithTwoConsumedAuthorizations() public view { handler.check(); }
}
