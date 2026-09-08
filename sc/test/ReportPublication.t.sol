// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {ReportEvidenceRegistryTest, RegistryWallet} from "./ReportEvidenceRegistry.t.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";
contract ReportPublicationTest is ReportEvidenceRegistryTest {
    uint256 constant VALIDATOR_KEY = 0x5678;
    function publication() internal returns (Registry.Authorization memory a, Registry.Authorization memory v) {
        registry.setValidator(vm.addr(VALIDATOR_KEY), true);
        a = authorization(); a.action = keccak256("PUBLISH_REPORT"); a.outcome = "LOLOS";
        v = authorization(); v.action = keccak256("VALIDATE_REPORT"); v.outcome = "LOLOS"; v.signer = vm.addr(VALIDATOR_KEY);
    }
    function validatorSign(Registry.Authorization memory v) internal view returns(bytes memory) {
        (uint8 rec, bytes32 r, bytes32 s) = vm.sign(VALIDATOR_KEY, registry.authorizationDigest(v));
        return abi.encodePacked(r,s,rec);
    }
    function test_PublicationRequiresBothRolesAndPreservesOfficialVersion() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = publication();
        registry.publishReport(a, sign(a), v, validatorSign(v));
        Registry.Publication memory p = registry.publishedVersion(a.institutionId, a.reportId, a.version);
        assertEq(p.institution.digest, a.digest);
        assertEq(p.validator.signer, v.signer);
        assertEq(registry.latestPublishedPackage(a.institutionId, a.reportId), a.packageId);
        bytes memory sa = sign(a); bytes memory sv = validatorSign(v);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
    }

    function test_MissingSignaturesWrongRolesAndSameSignerCannotPublish() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = publication();
        bytes memory sa = sign(a); bytes memory sv = validatorSign(v);
        vm.expectRevert(); registry.publishReport(a, "", v, sv);
        vm.expectRevert(); registry.publishReport(a, sa, v, "");
        vm.expectRevert(); registry.publishReport(a, sv, v, sa);
        registry.setValidator(signer, true);
        v.signer = signer; sv = sign(v);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        assertEq(registry.latestPublishedPackage(a.institutionId, a.reportId), "");
    }
    function test_RevokedValidatorAndReactivatedEpochAndExpiryAreRejected() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = publication();
        bytes memory sa = sign(a); bytes memory sv = validatorSign(v);
        registry.setValidator(v.signer, false);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        registry.setValidator(v.signer, true);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        v.authorityEpoch = 3; sv = validatorSign(v);
        vm.warp(a.deadline + 1);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
    }
    function test_RecordingAndOtherDomainsCannotAuthorizePublication() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = publication();
        a.action = keccak256("RECORD_EVIDENCE");
        bytes memory sa = sign(a); bytes memory sv = validatorSign(v);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        a.action = keccak256("PUBLISH_REPORT");
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        sa = sign(a);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        vm.chainId(block.chainid - 1);
        Registry other = new Registry(address(this));
        other.enrollInstitution(a.institutionId, address(this));
        other.setSignatory(a.institutionId, signer, true); other.setValidator(v.signer, true);
        vm.expectRevert(); other.publishReport(a, sa, v, sv);
    }
    function testFuzz_MismatchedEndorsementAndImmutableFirstVersion(uint8 field) public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = publication();
        bytes memory sa = sign(a);
        field = uint8(bound(field, 0, 9));
        if (field == 0) v.institutionId = "other";
        if (field == 1) v.reportId = "other";
        if (field == 2) v.version = "2";
        if (field == 3) v.packageId = "other";
        if (field == 4) v.predecessor = "other";
        if (field == 5) v.digest = keccak256("other");
        if (field == 6) v.policy = "other";
        if (field == 7) v.outcome = "DITOLAK";
        if (field == 8) v.deadline++;
        if (field == 9) v.action = keccak256("RECORD_EVIDENCE");
        bytes memory sv = validatorSign(v);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        assertEq(registry.latestPublishedPackage(a.institutionId, a.reportId), "");
    }
    function test_NoOverwriteOrSecondRootAndAcceptedHistorySurvivesRotation() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = publication();
        registry.publishReport(a, sign(a), v, validatorSign(v));
        bytes32 digest = a.digest;
        a.nonce = keccak256("new"); v.nonce = keccak256("new-validator");
        a.digest = keccak256("changed"); v.digest = a.digest;
        bytes memory sa = sign(a); bytes memory sv = validatorSign(v);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        a.version = "2"; v.version = "2"; a.packageId = "second"; v.packageId = "second";
        sa = sign(a); sv = validatorSign(v);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        registry.setValidator(v.signer, false); registry.setSignatory(a.institutionId, signer, false);
        assertEq(registry.publishedVersion(a.institutionId, a.reportId, "1").institution.digest, digest);
    }

    function test_ContractAccountPublicationAndValidatorNonceCannotBeReused() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = publication();
        RegistryWallet wallet = new RegistryWallet(signer);
        registry.setSignatory(a.institutionId, address(wallet), true);
        a.signer = address(wallet);
        bytes memory sa = sign(a); bytes memory sv = validatorSign(v);
        wallet.setMode(2);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        wallet.setMode(1);
        vm.expectRevert(); registry.publishReport(a, sa, v, sv);
        wallet.setMode(0);
        registry.publishReport(a, sa, v, sv);
        a.reportId = "other-report"; v.reportId = "other-report";
        a.packageId = "other-package"; v.packageId = "other-package"; a.nonce = keccak256("fresh institution nonce");
        sa = sign(a); sv = validatorSign(v);
        vm.expectRevert(Registry.Replayed.selector); registry.publishReport(a, sa, v, sv);
        assertEq(registry.latestPublishedPackage(a.institutionId, a.reportId), "");
    }
}
