// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {Test} from "forge-std/Test.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";

/// @notice Corrections may extend the official line by one; they may never fork, overwrite or erase it.
contract CorrectionHandler is Test {
    Registry public registry;
    uint256 constant KEY = 0x1234;
    uint256 constant VALIDATOR = 0x5678;
    uint256 public attempts;
    string[] public acceptedVersions;
    string[] public acceptedPackages;
    bytes32[] public acceptedDigests;
    constructor() {
        registry = new Registry(address(this));
        registry.enrollInstitution("a", address(this));
        registry.setSignatory("a", vm.addr(KEY), true);
        registry.setValidator(vm.addr(VALIDATOR), true);
    }
    function accepted() external view returns (uint256) { return acceptedVersions.length; }
    function signature(Registry.Authorization memory a, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.authorizationDigest(a));
        return abi.encodePacked(r, s, v);
    }
    /// @param stale succeed a version that is no longer official, as a losing correction does.
    /// @param reuseVersion reuse a version identity that was already published.
    function attempt(bool stale, bool reuseVersion) external {
        attempts++;
        uint256 count = acceptedVersions.length;
        string memory predecessor = count == 0 ? "" : (stale ? acceptedPackages[0] : acceptedPackages[count - 1]);
        string memory version = reuseVersion && count > 0 ? acceptedVersions[0] : vm.toString(attempts);
        string memory packageId = string.concat("package-", vm.toString(attempts));
        (, uint256 epoch) = registry.signatories(keccak256("a"), vm.addr(KEY));
        (, uint256 validatorEpoch) = registry.validators(vm.addr(VALIDATOR));
        Registry.Authorization memory a = Registry.Authorization(keccak256("PUBLISH_REPORT"), "a", "report", version,
            packageId, predecessor, keccak256(abi.encode(attempts)), "policy", "LOLOS", vm.addr(KEY), epoch,
            bytes32(attempts), type(uint256).max);
        Registry.Authorization memory v = Registry.Authorization(keccak256("VALIDATE_REPORT"), "a", "report", version,
            packageId, predecessor, a.digest, "policy", "LOLOS", vm.addr(VALIDATOR), validatorEpoch,
            keccak256(abi.encode(attempts)), type(uint256).max);
        try registry.publishReport(a, signature(a, KEY), v, signature(v, VALIDATOR)) {
            // Only a fresh version succeeding the current official package may be accepted.
            assertFalse(reuseVersion && count > 0);
            assertFalse(stale && count > 1);
            acceptedVersions.push(version); acceptedPackages.push(packageId); acceptedDigests.push(a.digest);
        } catch {}
    }
    function rotate(bool active) external { registry.setValidator(vm.addr(VALIDATOR), active); }
    function check() external view {
        uint256 count = acceptedVersions.length;
        if (count == 0) {
            assertEq(registry.latestPublishedVersion("a", "report"), "");
            return;
        }
        assertEq(registry.latestPublishedVersion("a", "report"), acceptedVersions[count - 1]);
        assertEq(registry.latestPublishedPackage("a", "report"), acceptedPackages[count - 1]);
        for (uint256 i = 0; i < count; i++) {
            Registry.Publication memory published = registry.publishedVersion("a", "report", acceptedVersions[i]);
            // Every accepted version keeps the exact authorization it was accepted with.
            assertEq(published.institution.digest, acceptedDigests[i]);
            assertEq(published.institution.packageId, acceptedPackages[i]);
            assertEq(published.institution.predecessor, i == 0 ? "" : acceptedPackages[i - 1]);
            assertEq(published.validator.signer, vm.addr(VALIDATOR));
            assertEq(registry.publishedPackageVersion("a", acceptedPackages[i]), acceptedVersions[i]);
        }
    }
}
contract ReportCorrectionInvariantTest is Test {
    CorrectionHandler handler;
    function setUp() public {
        handler = new CorrectionHandler(); targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = handler.attempt.selector; selectors[1] = handler.rotate.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }
    function invariant_OneOfficialLineWithImmutableSupersededVersions() public view { handler.check(); }
}
