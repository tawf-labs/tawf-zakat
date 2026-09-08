// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;
import {ReportPublicationTest} from "./ReportPublication.t.sol";
import {ReportEvidenceRegistry as Registry} from "../src/ReportEvidenceRegistry.sol";
contract ReportAuthorityTest is ReportPublicationTest {
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
