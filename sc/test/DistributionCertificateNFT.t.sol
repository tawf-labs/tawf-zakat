// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {Test} from "forge-std/Test.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";
import {DistributionCertificateNFT as Certificate} from "../src/DistributionCertificateNFT.sol";
import {RegistryWallet} from "./ReportEvidenceRegistry.t.sol";
import {ERC5192} from "@tawf-gov/identity/ERC5192.sol";

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

    function test_ExpiredSignatureIsRejected() public {
        Certificate.Certification memory c = certification();
        bytes memory signature = sign(c);
        vm.warp(c.deadline + 1);
        vm.expectRevert(Certificate.Expired.selector);
        cert.issueCertificate(c, signature);
    }

    function test_PredecessorVersioningIsOutOfScopeForThisContract() public {
        Certificate.Certification memory c = certification();
        c.predecessor = "stage-1";
        bytes memory signature = sign(c);
        vm.expectRevert(Certificate.OutOfScope.selector);
        cert.issueCertificate(c, signature);
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
