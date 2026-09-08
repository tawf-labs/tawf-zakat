// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {ReportPublicationTest} from "./ReportPublication.t.sol";
import {RegistryWallet} from "./ReportEvidenceRegistry.t.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";

/// @notice An attestation is an examination note appended to one version; it endorses nothing and changes no figure.
contract ReportAttestationTest is ReportPublicationTest {
    uint256 constant AUDITOR_KEY = 0x9abc;
    uint256 constant OTHER_AUDITOR_KEY = 0xdef0;
    address auditor;

    function publishedVersionOne() internal returns (Registry.Authorization memory a) {
        Registry.Authorization memory v;
        (a, v) = publication();
        registry.publishReport(a, sign(a), v, validatorSign(v));
        auditor = vm.addr(AUDITOR_KEY);
        registry.setAuditor(a.institutionId, auditor, true, "Surat penugasan 2026/01");
    }
    function statement(Registry.Authorization memory a) internal view returns (Registry.Attestation memory) {
        return Registry.Attestation({action: keccak256("ATTEST_REPORT"), institutionId: a.institutionId, reportId: a.reportId,
            version: a.version, packageId: a.packageId, packageDigest: a.digest, scope: "REKONSILIASI_PERIODE",
            conclusion: "WAJAR_DENGAN_PENGECUALIAN", evidenceCommitment: keccak256("kertas kerja"), predecessor: bytes32(0),
            auditor: auditor, authorityEpoch: 1, nonce: keccak256("nonce-1"), deadline: block.timestamp + 300});
    }
    function copyOf(Registry.Attestation memory a) internal pure returns (Registry.Attestation memory) {
        return Registry.Attestation({action: a.action, institutionId: a.institutionId, reportId: a.reportId, version: a.version,
            packageId: a.packageId, packageDigest: a.packageDigest, scope: a.scope, conclusion: a.conclusion,
            evidenceCommitment: a.evidenceCommitment, predecessor: a.predecessor, auditor: a.auditor,
            authorityEpoch: a.authorityEpoch, nonce: a.nonce, deadline: a.deadline});
    }
    function attest(Registry.Attestation memory a, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.attestationDigest(a));
        return abi.encodePacked(r, s, v);
    }

    function test_AuthorizedAuditorAppendsAConclusionToOneVersionWithoutTouchingEndorsement() public {
        Registry.Authorization memory a = publishedVersionOne();
        Registry.Attestation memory note = statement(a);
        vm.prank(address(0xBEEF));
        registry.attestReport(note, attest(note, AUDITOR_KEY));
        assertEq(registry.attestationCount(a.institutionId, a.reportId, a.version), 1);
        bytes32 id = registry.attestationIdAt(a.institutionId, a.reportId, a.version, 0);
        Registry.AttestationRecord memory saved = registry.attestationById(id);
        assertEq(saved.statement.conclusion, "WAJAR_DENGAN_PENGECUALIAN");
        assertEq(saved.statement.auditor, auditor);
        assertEq(saved.statement.evidenceCommitment, keccak256("kertas kerja"));
        assertEq(registry.auditorMandate(a.institutionId, auditor), "Surat penugasan 2026/01");
        // The institution's own publication is untouched by anything an auditor says.
        assertEq(registry.publishedVersion(a.institutionId, a.reportId, a.version).institution.digest, a.digest);
        assertEq(registry.latestPublishedPackage(a.institutionId, a.reportId), a.packageId);
        // A relayer cannot replay the same note, and cannot author a different one.
        bytes memory signature = attest(note, AUDITOR_KEY);
        vm.expectRevert(Registry.Replayed.selector);
        registry.attestReport(note, signature);
    }

    function test_AcceptedMandateSurvivesRevocationAndRenewal() public {
        Registry.Authorization memory a = publishedVersionOne();
        Registry.Attestation memory first = statement(a);
        registry.attestReport(first, attest(first, AUDITOR_KEY));
        bytes32 firstId = registry.attestationIdAt(a.institutionId, a.reportId, a.version, 0);
        registry.setAuditor(a.institutionId, auditor, false, "");
        assertEq(registry.attestationById(firstId).mandate, "Surat penugasan 2026/01");
        registry.setAuditor(a.institutionId, auditor, true, "Surat penugasan 2026/02");
        Registry.Attestation memory next = copyOf(first);
        next.authorityEpoch = 3;
        next.nonce = keccak256("renewed-mandate");
        next.predecessor = firstId;
        registry.attestReport(next, attest(next, AUDITOR_KEY));
        bytes32 nextId = registry.attestationIdAt(a.institutionId, a.reportId, a.version, 1);
        assertEq(registry.attestationById(firstId).mandate, "Surat penugasan 2026/01");
        assertEq(registry.attestationById(nextId).mandate, "Surat penugasan 2026/02");
    }

    function test_DirectAttestationRejectsInventedScopeAndConclusion() public {
        Registry.Authorization memory a = publishedVersionOne();
        Registry.Attestation memory note = statement(a);
        note.scope = "COMPREHENSIVE_COMPLIANCE";
        bytes memory signature = attest(note, AUDITOR_KEY);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(note, signature);
        note.scope = "REKONSILIASI_PERIODE";
        note.conclusion = "CERTIFIED_INDEPENDENT";
        signature = attest(note, AUDITOR_KEY);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(note, signature);
        assertEq(registry.attestationCount(a.institutionId, a.reportId, a.version), 0);
    }

    function test_ReaderMembershipAndUnmandatedAccountsCannotAttest() public {
        Registry.Authorization memory a = publishedVersionOne();
        // An account with no institution-scoped mandate is refused however well formed its note is.
        Registry.Attestation memory unmandated = copyOf(statement(a));
        unmandated.auditor = vm.addr(OTHER_AUDITOR_KEY);
        bytes memory signature = attest(unmandated, OTHER_AUDITOR_KEY);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.attestReport(unmandated, signature);
        // The institution's own report signatory is not an auditor either.
        Registry.Attestation memory bySignatory = copyOf(statement(a));
        bySignatory.auditor = signer;
        bytes memory signed = attest(bySignatory, KEY);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.attestReport(bySignatory, signed);
        assertEq(registry.attestationCount(a.institutionId, a.reportId, a.version), 0);
        // Only the institution's administrator grants the scope.
        vm.prank(address(0xBEEF));
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.setAuditor(a.institutionId, vm.addr(OTHER_AUDITOR_KEY), true, "tanpa dasar");
        // An activation without a recorded mandate is refused.
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.setAuditor(a.institutionId, vm.addr(OTHER_AUDITOR_KEY), true, "");
    }
    function test_FollowUpKeepsTheEarlierNoteAndRefusesForeignOrCrossVersionReferences() public {
        Registry.Authorization memory a = publishedVersionOne();
        Registry.Attestation memory first = statement(a);
        registry.attestReport(first, attest(first, AUDITOR_KEY));
        bytes32 id = registry.attestationIdAt(a.institutionId, a.reportId, a.version, 0);

        Registry.Attestation memory followUp = copyOf(first);
        followUp.predecessor = id;
        followUp.conclusion = "WAJAR_TANPA_PENGECUALIAN";
        followUp.nonce = keccak256("nonce-2");
        followUp.evidenceCommitment = keccak256("kertas kerja lanjutan");
        registry.attestReport(followUp, attest(followUp, AUDITOR_KEY));
        assertEq(registry.attestationCount(a.institutionId, a.reportId, a.version), 2);
        // The earlier conclusion is still readable exactly as it was signed.
        assertEq(registry.attestationById(id).statement.conclusion, "WAJAR_DENGAN_PENGECUALIAN");
        assertEq(registry.attestationById(registry.attestationIdAt(a.institutionId, a.reportId, a.version, 1)).statement.predecessor, id);

        // Another auditor cannot follow up on this auditor's record.
        address other = vm.addr(OTHER_AUDITOR_KEY);
        registry.setAuditor(a.institutionId, other, true, "Surat penugasan lain");
        Registry.Attestation memory hijack = copyOf(followUp);
        hijack.auditor = other; hijack.authorityEpoch = 1; hijack.nonce = keccak256("nonce-3");
        bytes memory hijackSignature = attest(hijack, OTHER_AUDITOR_KEY);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(hijack, hijackSignature);
        // A reference to a record that does not exist is refused the same way.
        Registry.Attestation memory dangling = copyOf(first);
        dangling.predecessor = keccak256("tidak ada"); dangling.nonce = keccak256("nonce-4");
        bytes memory danglingSignature = attest(dangling, AUDITOR_KEY);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(dangling, danglingSignature);
        assertEq(registry.attestationCount(a.institutionId, a.reportId, a.version), 2);
    }

    function test_EachVersionCarriesItsOwnAttestationsAndUnpublishedVersionsCarryNone() public {
        Registry.Authorization memory a = publishedVersionOne();
        Registry.Attestation memory first = statement(a);
        registry.attestReport(first, attest(first, AUDITOR_KEY));

        // A second published version of the same report starts with an empty list.
        Registry.Authorization memory b = authorization();
        b.action = keccak256("PUBLISH_REPORT"); b.outcome = "LOLOS";
        b.version = "2"; b.packageId = "corrected"; b.predecessor = a.packageId;
        b.digest = keccak256("corrected package"); b.nonce = keccak256("institution-2");
        Registry.Authorization memory bv = authorization();
        bv.action = keccak256("VALIDATE_REPORT"); bv.outcome = "LOLOS"; bv.signer = vm.addr(0x5678);
        bv.version = "2"; bv.packageId = "corrected"; bv.predecessor = a.packageId;
        bv.digest = b.digest; bv.nonce = keccak256("validator-2");
        registry.publishReport(b, sign(b), bv, validatorSign(bv));
        assertEq(registry.attestationCount(a.institutionId, a.reportId, "2"), 0);
        assertEq(registry.attestationCount(a.institutionId, a.reportId, "1"), 1);

        // A version that was never published cannot be attested at all.
        Registry.Attestation memory unpublished = copyOf(first);
        unpublished.version = "3"; unpublished.nonce = keccak256("nonce-unpublished");
        bytes memory unpublishedSignature = attest(unpublished, AUDITOR_KEY);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(unpublished, unpublishedSignature);
        // Nor can a note claim version 1 while naming the corrected package or a substituted digest.
        Registry.Attestation memory swapped = copyOf(first);
        swapped.packageId = "corrected"; swapped.nonce = keccak256("nonce-swap");
        bytes memory swappedSignature = attest(swapped, AUDITOR_KEY);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(swapped, swappedSignature);
        Registry.Attestation memory retagged = copyOf(first);
        retagged.packageDigest = keccak256("substituted"); retagged.nonce = keccak256("nonce-digest");
        bytes memory retaggedSignature = attest(retagged, AUDITOR_KEY);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(retagged, retaggedSignature);
        assertEq(registry.attestationCount(a.institutionId, a.reportId, "1"), 1);
    }

    function test_RevokedMandateExpiryWrongDomainAndBrokenSignatureAreRejected() public {
        Registry.Authorization memory a = publishedVersionOne();
        Registry.Attestation memory note = statement(a);
        bytes memory signature = attest(note, AUDITOR_KEY);
        // A signature over a different conclusion never recovers to the auditor.
        Registry.Attestation memory changed = copyOf(note);
        changed.conclusion = "WAJAR_TANPA_PENGECUALIAN";
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(changed, signature);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(note, hex"1234");
        registry.setAuditor(a.institutionId, auditor, false, "dicabut");
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.attestReport(note, signature);
        // Reactivating raises the epoch, so the outstanding material stays invalid.
        registry.setAuditor(a.institutionId, auditor, true, "Surat penugasan 2026/02");
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.attestReport(note, signature);
        Registry.Attestation memory renewed = copyOf(note);
        renewed.authorityEpoch = 3;
        bytes memory renewedSignature = attest(renewed, AUDITOR_KEY);
        vm.warp(renewed.deadline + 1);
        vm.expectRevert(Registry.Expired.selector);
        registry.attestReport(renewed, renewedSignature);
        vm.warp(renewed.deadline - 1);
        // Another deployment on another chain shares no attestation domain.
        vm.chainId(block.chainid + 1);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(renewed, renewedSignature);
        vm.chainId(block.chainid - 1);
        registry.attestReport(renewed, renewedSignature);
        assertEq(registry.attestationCount(a.institutionId, a.reportId, a.version), 1);
    }

    function test_ContractAuditorAccountIsCheckedAtExecution() public {
        Registry.Authorization memory a = publishedVersionOne();
        RegistryWallet wallet = new RegistryWallet(auditor);
        registry.setAuditor(a.institutionId, address(wallet), true, "Kantor akuntan publik, akun kontrak");
        Registry.Attestation memory note = copyOf(statement(a));
        note.auditor = address(wallet);
        bytes memory signature = attest(note, AUDITOR_KEY);
        // A wallet that reverts, and one that answers with the wrong magic value, are both refused.
        wallet.setMode(2);
        vm.expectRevert();
        registry.attestReport(note, signature);
        wallet.setMode(1);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.attestReport(note, signature);
        wallet.setMode(0);
        registry.attestReport(note, signature);
        assertEq(registry.attestationCount(a.institutionId, a.reportId, a.version), 1);
        assertEq(registry.attestationById(registry.attestationIdAt(a.institutionId, a.reportId, a.version, 0)).statement.auditor, address(wallet));
        // The contract account's own nonce is spent, so the same note cannot be replayed.
        vm.expectRevert(Registry.Replayed.selector);
        registry.attestReport(note, signature);
    }

    function testFuzz_EveryBoundAttestationFieldRejectsSubstitution(uint8 field) public {
        Registry.Authorization memory a = publishedVersionOne();
        Registry.Attestation memory note = statement(a);
        bytes memory signature = attest(note, AUDITOR_KEY);
        Registry.Attestation memory forged = copyOf(note);
        field = uint8(bound(field, 0, 8));
        if (field == 0) forged.institutionId = "institution-b";
        if (field == 1) forged.reportId = "other-report";
        if (field == 2) forged.version = "2";
        if (field == 3) forged.packageId = "other-package";
        if (field == 4) forged.packageDigest = keccak256("other");
        if (field == 5) forged.scope = "LAIN";
        if (field == 6) forged.conclusion = "WAJAR_TANPA_PENGECUALIAN";
        if (field == 7) forged.evidenceCommitment = keccak256("other");
        if (field == 8) forged.action = keccak256("PUBLISH_REPORT");
        vm.expectRevert();
        registry.attestReport(forged, signature);
        assertEq(registry.attestationCount(a.institutionId, a.reportId, a.version), 0);
    }
}
