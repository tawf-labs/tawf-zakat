// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {ReportPublicationTest} from "./ReportPublication.t.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";
contract ReportAuthorityTest is ReportPublicationTest {
    event AuthorityChanged(bytes32 indexed scope, bytes32 indexed role, address indexed account,
        address actor, bool active, uint256 epoch, uint256 actorEpoch, string mandate);
    function test_HandoffAttributesAcceptanceToTheSuccessorEpochIncludingReturn() public {
        address successor = address(0x999);
        registry.proposeAdministrator("institution-a", successor);
        vm.expectEmit(true, true, true, true, address(registry));
        emit AuthorityChanged(keccak256("institution-a"), keccak256("ADMINISTRATOR"), address(this), successor, false, 1, 2, "SUCCESSOR_ACCEPTANCE");
        vm.prank(successor); registry.acceptAdministrator("institution-a");
        vm.prank(successor); registry.proposeAdministrator("institution-a", address(this));
        vm.expectEmit(true, true, true, true, address(registry));
        emit AuthorityChanged(keccak256("institution-a"), keccak256("ADMINISTRATOR"), successor, address(this), false, 2, 3, "SUCCESSOR_ACCEPTANCE");
        registry.acceptAdministrator("institution-a");
        assertEq(registry.administratorEpochs(keccak256("institution-a")), 3);
    }
    function test_ValidatorOperatorMustAcceptAndAdmissionCannotOverride() public {
        address successor = address(0x999);
        vm.prank(successor); vm.expectRevert(); registry.acceptValidatorOperator();
        registry.proposeValidatorOperator(successor);
        vm.prank(successor); vm.expectRevert(); registry.setValidator(successor, true);
        vm.prank(successor); registry.acceptValidatorOperator();
        vm.expectRevert(); registry.setValidator(successor, true);
        vm.prank(successor); registry.setValidator(successor, true);
        assertEq(registry.validatorOperator(), successor);
    }
    function test_PublicationSurvivesRotationButPendingSignaturesDoNot() public {
        (Registry.Authorization memory a, Registry.Authorization memory v) = publication();
        registry.publishReport(a, sign(a), v, validatorSign(v));
        bytes32 accepted = a.digest;
        a.reportId = "second-report"; a.packageId = "second-package"; a.nonce = keccak256("second");
        v.reportId = a.reportId; v.packageId = a.packageId; v.nonce = keccak256("validator-second");
        bytes memory sa = sign(a); bytes memory sv = validatorSign(v);
        registry.setValidator(v.signer, false); registry.setValidator(v.signer, true);
        vm.expectRevert(Registry.Unauthorized.selector); registry.publishReport(a, sa, v, sv);
        Registry.Authorization memory original = authorization();
        assertEq(registry.publishedVersion(original.institutionId, original.reportId, original.version).institution.digest, accepted);
    }
}
