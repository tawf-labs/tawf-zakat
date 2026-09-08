// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {ReportPublicationTest} from "./ReportPublication.t.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";

/// @notice A correction appends a successor version; it never overwrites or reopens the version it succeeds.
contract ReportCorrectionTest is ReportPublicationTest {
    function published() internal returns (Registry.Authorization memory a, Registry.Authorization memory v) {
        (a, v) = publication();
        registry.publishReport(a, sign(a), v, validatorSign(v));
    }
    /// @dev Memory structs alias, so a successor is built as a fresh copy of every field.
    function copy(Registry.Authorization memory a) internal pure returns (Registry.Authorization memory) {
        return Registry.Authorization({action: a.action, institutionId: a.institutionId, reportId: a.reportId,
            version: a.version, packageId: a.packageId, predecessor: a.predecessor, digest: a.digest, policy: a.policy,
            outcome: a.outcome, signer: a.signer, authorityEpoch: a.authorityEpoch, nonce: a.nonce, deadline: a.deadline});
    }
    function successor(Registry.Authorization memory a, Registry.Authorization memory v, string memory version, string memory packageId)
        internal pure returns (Registry.Authorization memory next, Registry.Authorization memory nextValidator) {
        next = copy(a); nextValidator = copy(v);
        next.predecessor = a.packageId; nextValidator.predecessor = a.packageId;
        next.version = version; nextValidator.version = version;
        next.packageId = packageId; nextValidator.packageId = packageId;
        next.digest = keccak256(bytes(packageId)); nextValidator.digest = next.digest;
        next.nonce = keccak256(abi.encode("institution", version, packageId));
        nextValidator.nonce = keccak256(abi.encode("validator", version, packageId));
    }

    function test_CorrectionAppendsSuccessorAndLeavesTheSupersededVersionReadable() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = published();
        (Registry.Authorization memory b, Registry.Authorization memory bv) = successor(a, v, "2", "corrected-package");
        registry.publishReport(b, sign(b), bv, validatorSign(bv));
        assertEq(registry.latestPublishedPackage(a.institutionId, a.reportId), b.packageId);
        assertEq(registry.latestPublishedVersion(a.institutionId, a.reportId), "2");
        Registry.Publication memory old = registry.publishedVersion(a.institutionId, a.reportId, "1");
        assertEq(old.institution.digest, a.digest);
        assertEq(old.institution.predecessor, "");
        Registry.Publication memory corrected = registry.publishedVersion(a.institutionId, a.reportId, "2");
        assertEq(corrected.institution.predecessor, a.packageId);
        assertEq(corrected.validator.signer, v.signer);
        // Both identities resolve back to their own version; neither is reachable as the other.
        assertEq(registry.publishedPackageVersion(a.institutionId, a.packageId), "1");
        assertEq(registry.publishedPackageVersion(a.institutionId, b.packageId), "2");
    }

    function test_CompetingCorrectionsProduceAtMostOneOfficialSuccessor() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = published();
        (Registry.Authorization memory b, Registry.Authorization memory bv) = successor(a, v, "2", "winning-package");
        (Registry.Authorization memory c, Registry.Authorization memory cv) = successor(a, v, "3", "losing-package");
        bytes memory sc_ = sign(c); bytes memory svc = validatorSign(cv);
        registry.publishReport(b, sign(b), bv, validatorSign(bv));
        // The loser signed against a predecessor that is no longer the official version.
        vm.expectRevert(Registry.AlreadyRecorded.selector);
        registry.publishReport(c, sc_, cv, svc);
        assertEq(registry.latestPublishedPackage(a.institutionId, a.reportId), b.packageId);
        assertEq(registry.publishedPackageVersion(a.institutionId, c.packageId), "");
        assertEq(registry.publishedVersion(a.institutionId, a.reportId, "3").institution.signer, address(0));
        // Retrying the winner does not add a second successor either.
        bytes memory sb = sign(b); bytes memory svb = validatorSign(bv);
        vm.expectRevert();
        registry.publishReport(b, sb, bv, svb);
        assertEq(registry.latestPublishedVersion(a.institutionId, a.reportId), "2");
        // Reprepared against the current official version, the loser succeeds once.
        (c, cv) = successor(b, bv, "3", "losing-package");
        registry.publishReport(c, sign(c), cv, validatorSign(cv));
        assertEq(registry.latestPublishedPackage(a.institutionId, a.reportId), c.packageId);
        assertEq(registry.publishedVersion(a.institutionId, a.reportId, "2").institution.digest, b.digest);
    }

    function testFuzz_WrongPredecessorReportOrInstitutionCannotSucceed(uint8 field) public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = published();
        (Registry.Authorization memory b, Registry.Authorization memory bv) = successor(a, v, "2", "corrected-package");
        field = uint8(bound(field, 0, 5));
        if (field == 0) { b.predecessor = "unknown-package"; bv.predecessor = b.predecessor; }
        if (field == 1) { b.predecessor = ""; bv.predecessor = ""; }
        if (field == 2) { b.reportId = "other-report"; bv.reportId = b.reportId; }
        if (field == 3) { b.institutionId = "institution-b"; bv.institutionId = b.institutionId; }
        if (field == 4) { b.packageId = b.predecessor; bv.packageId = b.packageId; }
        if (field == 5) { b.version = a.version; bv.version = a.version; }
        if (field == 3) {
            registry.enrollInstitution("institution-b", address(this));
            registry.setSignatory("institution-b", signer, true);
            b.authorityEpoch = 1; bv.authorityEpoch = 1;
        }
        bytes memory sb = sign(b); bytes memory svb = validatorSign(bv);
        vm.expectRevert();
        registry.publishReport(b, sb, bv, svb);
        assertEq(registry.latestPublishedPackage(a.institutionId, a.reportId), a.packageId);
        assertEq(registry.latestPublishedVersion(a.institutionId, a.reportId), a.version);
    }

    function test_OldVersionAndRecordingAuthorizationsCannotAuthorizeACorrection() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = published();
        (Registry.Authorization memory b, Registry.Authorization memory bv) = successor(a, v, "2", "corrected-package");
        // Signatures made over the first version bind that version, not its successor.
        bytes memory staleInstitution = sign(a); bytes memory staleValidator = validatorSign(v);
        bytes memory sb = sign(b); bytes memory svb = validatorSign(bv);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.publishReport(b, staleInstitution, bv, svb);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.publishReport(b, sb, bv, staleValidator);
        // Nor can an authorization that only permits recording evidence.
        Registry.Authorization memory recording = copy(b);
        recording.action = keccak256("RECORD_EVIDENCE");
        bytes memory recordingSignature = sign(recording);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.publishReport(recording, recordingSignature, bv, svb);
        registry.recordEvidence(recording, recordingSignature);
        // Recording the same package first leaves publication available for the identical digest only.
        Registry.Authorization memory mismatched = copy(b);
        mismatched.digest = keccak256("substituted");
        Registry.Authorization memory mismatchedValidator = copy(bv);
        mismatchedValidator.digest = mismatched.digest;
        bytes memory sm = sign(mismatched); bytes memory svm = validatorSign(mismatchedValidator);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.publishReport(mismatched, sm, mismatchedValidator, svm);
        b.nonce = keccak256("fresh institution nonce for correction");
        bv.nonce = keccak256("fresh validator nonce for correction");
        registry.publishReport(b, sign(b), bv, validatorSign(bv));
        assertEq(registry.latestPublishedVersion(a.institutionId, a.reportId), "2");
    }

    function test_ExpiryRevokedValidatorAndDoubleRoleAlsoBlockCorrections() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = published();
        (Registry.Authorization memory b, Registry.Authorization memory bv) = successor(a, v, "2", "corrected-package");
        Registry.Authorization memory sameSigner = copy(bv);
        sameSigner.signer = b.signer;
        bytes memory ss = sign(sameSigner); bytes memory sb0 = sign(b);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.publishReport(b, sb0, sameSigner, ss);
        registry.setValidator(bv.signer, false);
        bytes memory sb = sign(b); bytes memory svb = validatorSign(bv);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.publishReport(b, sb, bv, svb);
        registry.setValidator(bv.signer, true);
        bv.authorityEpoch = 3; svb = validatorSign(bv);
        vm.warp(b.deadline + 1);
        vm.expectRevert(Registry.Expired.selector);
        registry.publishReport(b, sb, bv, svb);
        assertEq(registry.latestPublishedPackage(a.institutionId, a.reportId), a.packageId);
    }
}
