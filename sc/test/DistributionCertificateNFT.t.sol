// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {Test} from "forge-std/Test.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";
import {DistributionCertificateNFT as Certificate} from "../src/DistributionCertificateNFT.sol";
import {RegistryWallet} from "./ReportEvidenceRegistry.t.sol";
import {ERC5192} from "@tawf-gov/identity/ERC5192.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract CertificateReceiver is IERC721Receiver {
    Certificate immutable cert;
    Certificate.Certification private second;
    bytes private signature;
    bool immutable reject;
    uint256 public callbacks;
    bool public coherentState;
    bool public duplicateMinted;
    bytes public duplicateError;

    error Rejected();

    constructor(Certificate certificate, Certificate.Certification memory c, bytes memory sig, bool rejectMint) {
        cert = certificate;
        second = c;
        signature = sig;
        reject = rejectMint;
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(cert));
        callbacks++;
        if (callbacks == 1) {
            (string memory activityId, string memory certificateId, string memory version) = cert.certificateOf(tokenId);
            coherentState = cert.ownerOf(tokenId) == address(this) && cert.locked(tokenId)
                && cert.issuerOf(tokenId) == second.signer && cert.contentDigestOf(tokenId) == second.digest
                && keccak256(bytes(activityId)) == keccak256(bytes(second.activityId))
                && keccak256(bytes(certificateId)) == keccak256(bytes(second.certificateId))
                && keccak256(bytes(version)) == keccak256(bytes(second.version))
                && cert.certificateVersionToken(second.institutionId, second.certificateId, second.version) == tokenId
                && keccak256(bytes(cert.latestCertificateVersion(second.institutionId, second.certificateId)))
                    == keccak256(bytes(second.version));
            try cert.issueCertificate(second, signature) returns (uint256) {
                duplicateMinted = true;
            } catch (bytes memory reason) {
                duplicateError = reason;
            }
        }
        if (reject) revert Rejected();
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract DistributionCertificateNFTTest is Test {
    Registry registry;
    Certificate cert;
    uint256 constant KEY = 0x1234;
    address signer;
    address admin = address(0xADA1);
    address custodian = address(0xC0DA);

    function setUp() public {
        signer = vm.addr(KEY);
        registry = new Registry(address(this));
        registry.enrollInstitution("institution-a", admin);
        vm.prank(admin);
        registry.setSignatory("institution-a", signer, true);
        cert = new Certificate(address(registry));
    }

    function certification() internal view returns (Certificate.Certification memory) {
        return Certificate.Certification({
            action: keccak256("ISSUE_CERTIFICATE"),
            institutionId: "institution-a",
            activityId: "activity-1",
            certificateId: "stage-1",
            version: "1",
            predecessor: "",
            digest: keccak256("frozen realization scope v1"),
            signer: signer,
            authorityEpoch: 1,
            nonce: bytes32(uint256(1)),
            deadline: block.timestamp + 300
        });
    }

    function sign(Certificate.Certification memory c) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, cert.certificationDigest(c));
        return abi.encodePacked(r, s, v);
    }

    function test_ValidEndorsementMintsOneCertificateToResolvedCustodian() public {
        Certificate.Certification memory c = certification();
        bytes memory signature = sign(c);
        vm.prank(address(0xBEEF));
        uint256 tokenId = cert.issueCertificate(c, signature);
        assertEq(tokenId, 1);
        assertEq(cert.ownerOf(tokenId), admin); // falls back to registry administrator
        assertEq(cert.issuerOf(tokenId), signer);
        assertEq(cert.contentDigestOf(tokenId), c.digest);
        assertEq(cert.certificateVersionToken("institution-a", "stage-1", "1"), tokenId);
        assertEq(cert.latestCertificateVersion("institution-a", "stage-1"), "1");
        assertTrue(cert.locked(tokenId));
    }

    function test_DesignatedCustodianOverridesAdministratorFallback() public {
        vm.expectRevert(Certificate.Unauthorized.selector);
        vm.prank(address(0xBAD));
        cert.setCustodian("institution-a", custodian);

        vm.prank(admin);
        cert.setCustodian("institution-a", custodian);
        Certificate.Certification memory c = certification();
        uint256 tokenId = cert.issueCertificate(c, sign(c));
        assertEq(cert.ownerOf(tokenId), custodian);
    }

    function test_RevokedAndReactivatedMandateStaysUnauthorized() public {
        Certificate.Certification memory c = certification();
        bytes memory signature = sign(c);
        vm.prank(admin);
        registry.setSignatory("institution-a", signer, false);
        vm.expectRevert(Certificate.Unauthorized.selector);
        cert.issueCertificate(c, signature);
        vm.prank(admin);
        registry.setSignatory("institution-a", signer, true);
        // Reactivation bumps the epoch too; the stale-epoch signature stays invalid.
        vm.expectRevert(Certificate.Unauthorized.selector);
        cert.issueCertificate(c, signature);
        c.authorityEpoch = 3;
        cert.issueCertificate(c, sign(c));
    }

    function test_AlteredContentInvalidatesSignature() public {
        Certificate.Certification memory c = certification();
        bytes memory signature = sign(c);
        c.digest = keccak256("tampered scope");
        vm.expectRevert(Certificate.InvalidAuthorization.selector);
        cert.issueCertificate(c, signature);
    }

    function test_FakeIssuerWithoutMandateIsRejected() public {
        Certificate.Certification memory c = certification();
        c.signer = address(0xFACE);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xFEED, cert.certificationDigest(c));
        vm.expectRevert(Certificate.Unauthorized.selector);
        cert.issueCertificate(c, abi.encodePacked(r, s, v));
    }

    function test_TransferAndApprovalAreLockedByDesign() public {
        Certificate.Certification memory c = certification();
        uint256 tokenId = cert.issueCertificate(c, sign(c));
        vm.prank(admin);
        vm.expectRevert(ERC5192.ErrLocked.selector);
        cert.approve(address(0xBEEF), tokenId);
        vm.prank(admin);
        vm.expectRevert(ERC5192.ErrLocked.selector);
        cert.transferFrom(admin, address(0xBEEF), tokenId);
    }

    function test_DuplicateVersionCannotBeIssuedTwice() public {
        Certificate.Certification memory c = certification();
        cert.issueCertificate(c, sign(c));
        Certificate.Certification memory again = certification();
        again.nonce = bytes32(uint256(2));
        bytes memory signature = sign(again);
        vm.expectRevert(Certificate.AlreadyIssued.selector);
        cert.issueCertificate(again, signature);
    }

    function receiverFor(Certificate.Certification memory second, bool rejectMint)
        internal
        returns (CertificateReceiver receiver)
    {
        second.nonce = bytes32(uint256(2));
        bytes memory signature = sign(second);
        // Both endorsements are independently valid before the first mint begins.
        cert.validateCertification(second, signature);
        receiver = new CertificateReceiver(cert, second, signature, rejectMint);
        vm.prank(admin);
        cert.setCustodian("institution-a", address(receiver));
    }

    function test_ReceiverCannotReenterWithAnotherAuthorizedNonceForSameVersion() public {
        CertificateReceiver receiver = receiverFor(certification(), false);
        Certificate.Certification memory c = certification();
        uint256 tokenId = cert.issueCertificate(c, sign(c));

        assertFalse(receiver.duplicateMinted(), "receiver minted duplicate certificate/version");
        assertEq(receiver.duplicateError(), abi.encodeWithSelector(Certificate.AlreadyIssued.selector));
        assertEq(receiver.callbacks(), 1);
        assertEq(cert.balanceOf(address(receiver)), 1);
        assertEq(cert.certificateVersionToken(c.institutionId, c.certificateId, c.version), tokenId);
        assertTrue(cert.usedNonces(keccak256(bytes(c.institutionId)), signer, c.nonce));
        assertFalse(cert.usedNonces(keccak256(bytes(c.institutionId)), signer, bytes32(uint256(2))));
    }

    function test_ReceiverReadsCoherentCertificateStateDuringMint() public {
        CertificateReceiver receiver = receiverFor(certification(), false);
        Certificate.Certification memory c = certification();
        bytes memory signature = sign(c);
        vm.expectEmit(true, true, true, true, address(cert));
        emit Certificate.CertificateIssued(
            keccak256(bytes(c.institutionId)), keccak256(bytes(c.certificateId)), 1,
            c.version, c.digest, signer, address(receiver)
        );
        cert.issueCertificate(c, signature);
        assertTrue(receiver.coherentState(), "callback observed incomplete certificate state");
    }

    function test_ReceiverRejectionRollsBackIssuanceAndAllowsRetry() public {
        CertificateReceiver receiver = receiverFor(certification(), true);
        Certificate.Certification memory c = certification();
        bytes memory signature = sign(c);
        vm.expectRevert(CertificateReceiver.Rejected.selector);
        cert.issueCertificate(c, signature);

        assertEq(cert.balanceOf(address(receiver)), 0);
        assertEq(cert.certificateVersionToken(c.institutionId, c.certificateId, c.version), 0);
        assertEq(cert.latestCertificateVersion(c.institutionId, c.certificateId), "");
        assertFalse(cert.usedNonces(keccak256(bytes(c.institutionId)), signer, c.nonce));
        assertFalse(cert.usedNonces(keccak256(bytes(c.institutionId)), signer, bytes32(uint256(2))));
        vm.expectRevert(ERC5192.ErrNotFound.selector);
        cert.contentDigestOf(1);

        vm.prank(admin);
        cert.setCustodian(c.institutionId, custodian);
        assertEq(cert.issueCertificate(c, signature), 1); // counter and endorsement rolled back too
        assertEq(cert.ownerOf(1), custodian);
        assertEq(cert.contentDigestOf(1), c.digest);
    }

    function test_ExpiredSignatureIsRejected() public {
        Certificate.Certification memory c = certification();
        bytes memory signature = sign(c);
        vm.warp(c.deadline + 1);
        vm.expectRevert(Certificate.Expired.selector);
        cert.issueCertificate(c, signature);
    }

    function successor(string memory version, string memory predecessor, uint256 nonce)
        internal
        view
        returns (Certificate.Certification memory c)
    {
        c = certification();
        c.version = version;
        c.predecessor = predecessor;
        c.digest = keccak256(abi.encodePacked("frozen realization scope v", version));
        c.nonce = bytes32(nonce);
    }

    function test_CorrectionMintsLinkedSuccessorAndKeepsPredecessorReadable() public {
        Certificate.Certification memory first = certification();
        uint256 oldToken = cert.issueCertificate(first, sign(first));
        assertTrue(cert.isLatestVersion(oldToken));

        Certificate.Certification memory next = successor("2", "1", 2);
        uint256 newToken = cert.issueCertificate(next, sign(next));

        assertEq(cert.successorOf(oldToken), newToken);
        assertEq(cert.predecessorOf(newToken), oldToken);
        assertFalse(cert.isLatestVersion(oldToken));
        assertTrue(cert.isLatestVersion(newToken));
        assertEq(cert.latestCertificateVersion("institution-a", "stage-1"), "2");
        // The historical token is untouched: same content commitment, issuer, owner and lock.
        assertEq(cert.contentDigestOf(oldToken), first.digest);
        assertEq(cert.issuerOf(oldToken), signer);
        assertEq(cert.ownerOf(oldToken), admin);
        assertTrue(cert.locked(oldToken));
        assertEq(cert.certificateVersionToken("institution-a", "stage-1", "1"), oldToken);
        assertEq(cert.contentDigestOf(newToken), next.digest);
    }

    function test_CompetingCorrectionsCannotBothWinTheSameLine() public {
        Certificate.Certification memory first = certification();
        cert.issueCertificate(first, sign(first));
        Certificate.Certification memory a = successor("2", "1", 2);
        Certificate.Certification memory b = successor("2b", "1", 3);
        bytes memory signatureA = sign(a);
        bytes memory signatureB = sign(b);
        // Both are individually valid until one of them mints.
        cert.validateCertification(a, signatureA);
        cert.validateCertification(b, signatureB);
        cert.issueCertificate(a, signatureA);
        vm.expectRevert(Certificate.WrongPredecessor.selector);
        cert.issueCertificate(b, signatureB);
        assertEq(cert.certificateVersionToken("institution-a", "stage-1", "2b"), 0);
        assertEq(cert.latestCertificateVersion("institution-a", "stage-1"), "2");
    }

    function test_SupersededVersionCannotBeCorrectedAgainAndVersionsCannotRepeat() public {
        Certificate.Certification memory first = certification();
        cert.issueCertificate(first, sign(first));
        Certificate.Certification memory second = successor("2", "1", 2);
        cert.issueCertificate(second, sign(second));

        Certificate.Certification memory stale = successor("3", "1", 3);
        bytes memory staleSignature = sign(stale);
        vm.expectRevert(Certificate.WrongPredecessor.selector);
        cert.issueCertificate(stale, staleSignature);

        Certificate.Certification memory repeat = successor("2", "2", 4);
        bytes memory repeatSignature = sign(repeat);
        vm.expectRevert(Certificate.AlreadyIssued.selector);
        cert.issueCertificate(repeat, repeatSignature);

        Certificate.Certification memory third = successor("3", "2", 5);
        cert.issueCertificate(third, sign(third));
        assertEq(cert.predecessorOf(3), 2);
    }

    function test_CorrectionNeedsAnExistingLineTheSameActivityAndACurrentMandate() public {
        Certificate.Certification memory orphan = successor("2", "1", 2);
        bytes memory orphanSignature = sign(orphan);
        vm.expectRevert(Certificate.WrongPredecessor.selector);
        cert.issueCertificate(orphan, orphanSignature);

        Certificate.Certification memory first = certification();
        cert.issueCertificate(first, sign(first));

        Certificate.Certification memory moved = successor("2", "1", 3);
        moved.activityId = "activity-other";
        bytes memory movedSignature = sign(moved);
        vm.expectRevert(Certificate.OutOfScope.selector);
        cert.issueCertificate(moved, movedSignature);

        Certificate.Certification memory forged = successor("2", "1", 4);
        forged.signer = address(0xFACE);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xFEED, cert.certificationDigest(forged));
        bytes memory forgedSignature = abi.encodePacked(r, s, v);
        vm.expectRevert(Certificate.Unauthorized.selector);
        cert.issueCertificate(forged, forgedSignature);

        Certificate.Certification memory revoked = successor("2", "1", 5);
        bytes memory revokedSignature = sign(revoked);
        vm.prank(admin);
        registry.setSignatory("institution-a", signer, false);
        vm.expectRevert(Certificate.Unauthorized.selector);
        cert.issueCertificate(revoked, revokedSignature);
    }

    function test_CorrectionSignatureBindsPredecessorAndIsNotAFreshIssuance() public {
        Certificate.Certification memory first = certification();
        cert.issueCertificate(first, sign(first));
        Certificate.Certification memory next = successor("2", "1", 2);
        bytes memory signature = sign(next);
        next.digest = keccak256("swapped correction content");
        vm.expectRevert(Certificate.InvalidAuthorization.selector);
        cert.issueCertificate(next, signature);
        next = successor("2", "1", 2);
        next.predecessor = "";
        vm.expectRevert(Certificate.AlreadyIssued.selector);
        cert.issueCertificate(next, signature);
        // A no-predecessor endorsement can never restart a line that already exists.
        Certificate.Certification memory restart = successor("9", "", 6);
        bytes memory restartSignature = sign(restart);
        vm.expectRevert(Certificate.AlreadyIssued.selector);
        cert.issueCertificate(restart, restartSignature);
    }

    function test_ReportRegistrySignatureCannotBeReplayedAsCertificateIssuance() public {
        Registry.Authorization memory a = Registry.Authorization({
            action: keccak256("RECORD_EVIDENCE"),
            institutionId: "institution-a",
            reportId: "annual-2026",
            version: "1",
            packageId: "frozen-package",
            predecessor: "",
            digest: keccak256("frozen realization scope v1"),
            policy: "reconciliation-snapshot-v1",
            outcome: "DITOLAK",
            signer: signer,
            authorityEpoch: 1,
            nonce: bytes32(uint256(1)),
            deadline: block.timestamp + 300
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, registry.authorizationDigest(a));
        bytes memory registrySignature = abi.encodePacked(r, s, v);

        Certificate.Certification memory c = certification();
        vm.expectRevert(Certificate.InvalidAuthorization.selector);
        cert.issueCertificate(c, registrySignature);
    }

    function test_ContractWalletSignatureFailureModesAreRejected() public {
        RegistryWallet wallet = new RegistryWallet(signer);
        vm.prank(admin);
        registry.setSignatory("institution-a", address(wallet), true);
        Certificate.Certification memory c = certification();
        c.signer = address(wallet);
        bytes memory signature = sign(c);
        wallet.setMode(1);
        vm.expectRevert(Certificate.InvalidAuthorization.selector);
        cert.issueCertificate(c, signature);
        wallet.setMode(0);
        uint256 tokenId = cert.issueCertificate(c, signature);
        assertEq(cert.issuerOf(tokenId), address(wallet));
    }
}
