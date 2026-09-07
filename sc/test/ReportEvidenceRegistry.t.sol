// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {Test} from "forge-std/Test.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";

contract ReportEvidenceRegistryTest is Test {
    Registry registry;
    uint256 constant KEY = 0x1234;
    address signer;
    function setUp() public {
        signer = vm.addr(KEY);
        registry = new Registry(address(this));
        registry.enrollInstitution("institution-a", address(this));
        registry.setSignatory("institution-a", signer, true);
    }
    function authorization() internal view returns (Registry.Authorization memory) {
        return Registry.Authorization({action: keccak256("RECORD_EVIDENCE"), institutionId: "institution-a", reportId: "annual-2026", version: "1", packageId: "frozen-package", predecessor: "", digest: keccak256("rejected draft with findings"), policy: "reconciliation-snapshot-v1", outcome: "DITOLAK", signer: signer, authorityEpoch: 1, nonce: bytes32(uint256(1)), deadline: block.timestamp + 300});
    }
    function sign(Registry.Authorization memory a) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, registry.authorizationDigest(a));
        return abi.encodePacked(r, s, v);
    }
    function test_AlternativeRelayerRecordsRejectedEvidenceOnlyOnce() public {
        Registry.Authorization memory a = authorization();
        bytes memory signature = sign(a);
        vm.prank(address(0xBEEF));
        registry.recordEvidence(a, signature);
        assertEq(registry.evidenceDigest("institution-a", "frozen-package"), a.digest);
        vm.expectRevert(Registry.Replayed.selector);
        registry.recordEvidence(a, signature);
    }

    function test_ExpiredRevokedAndReactivatedMandatesStayInvalid() public {
        Registry.Authorization memory a = authorization();
        bytes memory signature = sign(a);
        registry.setSignatory("institution-a", signer, false);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.recordEvidence(a, signature);
        registry.setSignatory("institution-a", signer, true);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.recordEvidence(a, signature);
        a.authorityEpoch = 3;
        signature = sign(a);
        vm.warp(a.deadline + 1);
        vm.expectRevert(Registry.Expired.selector);
        registry.recordEvidence(a, signature);
    }
    function test_WrongDomainAndChainAreRejectedAtABI() public {
        Registry.Authorization memory a = authorization();
        bytes memory signature = sign(a);
        Registry other = new Registry(address(this));
        other.enrollInstitution("institution-a", address(this));
        other.setSignatory("institution-a", signer, true);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        other.recordEvidence(a, signature);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.recordEvidence(a, signature);
    }
    function testFuzz_EveryBoundFieldRejectsSubstitution(uint8 field) public {
        Registry.Authorization memory a = authorization();
        bytes memory signature = sign(a);
        field = uint8(bound(field, 0, 12));
        if (field == 0) a.action = keccak256("PUBLISH_REPORT");
        if (field == 1) a.institutionId = "institution-b";
        if (field == 2) a.reportId = "different-report";
        if (field == 3) a.version = "2";
        if (field == 4) a.packageId = "different-package";
        if (field == 5) a.predecessor = "substituted-parent";
        if (field == 6) a.digest = keccak256("changed package");
        if (field == 7) a.policy = "different-policy";
        if (field == 8) a.outcome = "LOLOS";
        if (field == 9) a.signer = address(0xBAD);
        if (field == 10) a.authorityEpoch++;
        if (field == 11) a.nonce = bytes32(uint256(22));
        if (field == 12) a.deadline++;
        vm.expectRevert();
        registry.recordEvidence(a, signature);
        assertEq(registry.evidenceDigest("institution-a", "frozen-package"), bytes32(0));
    }
    function test_ContractWalletMagicRevertAndOwnerRotation() public {
        RegistryWallet wallet = new RegistryWallet(signer);
        registry.setSignatory("institution-a", address(wallet), true);
        Registry.Authorization memory a = authorization();
        a.signer = address(wallet);
        bytes memory signature = sign(a);
        wallet.setMode(1);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.recordEvidence(a, signature);
        wallet.setMode(2);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.recordEvidence(a, signature);
        wallet.setMode(0);
        wallet.setOwner(address(0xBAD));
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.recordEvidence(a, signature);
        wallet.setOwner(signer);
        registry.recordEvidence(a, signature);
        wallet.setOwner(address(0xBAD));
        assertEq(registry.evidenceDigest("institution-a", a.packageId), a.digest);
    }
    function test_AdmissionCannotReplaceAnInstitutionAdministratorOrGrantItselfSigning() public {
        address successor = address(0xBEEF);
        registry.proposeAdministrator("institution-a", successor);
        vm.prank(address(0xBAD));
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.acceptAdministrator("institution-a");
        vm.prank(successor);
        registry.acceptAdministrator("institution-a");
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.setSignatory("institution-a", address(this), true);
        vm.expectRevert(Registry.InvalidAuthorization.selector);
        registry.enrollInstitution("institution-a", address(this));
        vm.prank(signer);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.enrollInstitution("institution-b", signer);
    }
    function testFuzz_RecordIsImmutableAndNonceIsSingleUse(bytes32 changedDigest, bytes32 nonce) public {
        vm.assume(changedDigest != bytes32(0) && nonce != bytes32(0));
        Registry.Authorization memory a = authorization();
        registry.recordEvidence(a, sign(a));
        bytes32 original = a.digest;
        a.digest = changedDigest;
        a.nonce = nonce;
        bytes memory signature = sign(a);
        vm.expectRevert();
        registry.recordEvidence(a, signature);
        assertEq(registry.evidenceDigest("institution-a", a.packageId), original);
        a.packageId = "second-package";
        a.nonce = bytes32(uint256(1));
        signature = sign(a);
        vm.expectRevert(Registry.Replayed.selector);
        registry.recordEvidence(a, signature);
    }
}

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
/// Test-only institutional wallet, including the two ERC-1271 failure modes.
contract RegistryWallet {
    address public owner;
    uint8 public mode;
    constructor(address initialOwner) { owner = initialOwner; }
    function setOwner(address next) external { owner = next; }
    function setMode(uint8 next) external { mode = next; }
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        if (mode == 1) revert("wallet refused");
        if (mode == 2) return 0xffffffff;
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(signature.length == 0 ? bytes32(0) : digest, signature);
        return error == ECDSA.RecoverError.NoError && recovered == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
