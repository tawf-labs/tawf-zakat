// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {CampaignEvidenceRegistry as Registry} from "../src/CampaignEvidenceRegistry.sol";

contract CampaignEvidenceRegistryTest is Test {
    Registry registry;
    address recorder = address(0x100);
    bytes32 eventId = keccak256("event-1");
    bytes32 campaignId = keccak256("campaign-1");
    bytes32 kind = keccak256("PAYMENT_SETTLED");
    bytes32 payload = keccak256("opaque payload commitment");

    event EvidenceRecorded(
        bytes32 indexed eventId, bytes32 indexed campaignId, bytes32 indexed kind, bytes32 payloadHash
    );
    event RecorderRotated(address indexed previousRecorder, address indexed newRecorder);

    function setUp() public {
        registry = new Registry(address(this), recorder);
    }

    function record() internal {
        vm.prank(recorder);
        registry.record(eventId, campaignId, kind, payload);
    }

    function test_RecordIsReadableAndEmitsEvidence() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit EvidenceRecorded(eventId, campaignId, kind, payload);
        record();
        (bytes32 c, bytes32 k, bytes32 p) = registry.evidence(eventId);
        assertEq(c, campaignId);
        assertEq(k, kind);
        assertEq(p, payload);
    }

    function test_ExactReplayDoesNotEmitOrMutate() public {
        record();
        vm.recordLogs();
        record();
        assertEq(vm.getRecordedLogs().length, 0);
        (,, bytes32 p) = registry.evidence(eventId);
        assertEq(p, payload);
    }

    function test_ConflictingPayloadKindOrCampaignRejects() public {
        record();
        vm.startPrank(recorder);
        vm.expectRevert(Registry.EvidenceConflict.selector);
        registry.record(eventId, campaignId, kind, keccak256("different"));
        vm.expectRevert(Registry.EvidenceConflict.selector);
        registry.record(eventId, campaignId, keccak256("different"), payload);
        vm.expectRevert(Registry.EvidenceConflict.selector);
        registry.record(eventId, keccak256("different"), kind, payload);
        vm.stopPrank();
    }

    function test_AdminAndStrangersCannotWriteEvenReplay() public {
        record();
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.record(eventId, campaignId, kind, payload);
        vm.prank(address(0x666));
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.record(eventId, campaignId, kind, payload);
    }

    function test_RotationIsAdminOnlyAndPreservesEvidence() public {
        record();
        address next = address(0x200);
        vm.prank(recorder);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.rotateRecorder(next);
        vm.expectEmit(true, true, false, true, address(registry));
        emit RecorderRotated(recorder, next);
        registry.rotateRecorder(next);
        vm.prank(recorder);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.record(eventId, campaignId, kind, payload);
        vm.prank(next);
        registry.record(eventId, campaignId, kind, payload);
        vm.prank(next);
        registry.record(keccak256("next"), campaignId, kind, payload);
        (,, bytes32 p) = registry.evidence(eventId);
        assertEq(p, payload);
    }

    function test_ZeroAndOverlappingAuthoritiesReject() public {
        vm.expectRevert(Registry.InvalidAddress.selector);
        new Registry(address(0), recorder);
        vm.expectRevert(Registry.InvalidAddress.selector);
        new Registry(address(this), address(0));
        vm.expectRevert(Registry.InvalidAddress.selector);
        new Registry(recorder, recorder);
        vm.expectRevert(Registry.InvalidAddress.selector);
        registry.rotateRecorder(address(0));
        vm.expectRevert(Registry.InvalidAddress.selector);
        registry.rotateRecorder(address(this));
    }

    function test_AllZeroCommitmentsReject() public {
        vm.startPrank(recorder);
        vm.expectRevert(Registry.InvalidCommitment.selector);
        registry.record(0, campaignId, kind, payload);
        vm.expectRevert(Registry.InvalidCommitment.selector);
        registry.record(eventId, 0, kind, payload);
        vm.expectRevert(Registry.InvalidCommitment.selector);
        registry.record(eventId, campaignId, 0, payload);
        vm.expectRevert(Registry.InvalidCommitment.selector);
        registry.record(eventId, campaignId, kind, 0);
        vm.stopPrank();
    }

    function test_MultipleKindsAndCampaignsStayIndependent() public {
        bytes32[3] memory kinds =
            [keccak256("CAMPAIGN_PUBLISHED"), keccak256("PAYMENT_SETTLED"), keccak256("DISBURSEMENT_RECORDED")];
        vm.startPrank(recorder);
        for (uint256 c = 1; c <= 2; c++) {
            for (uint256 k = 0; k < kinds.length; k++) {
                bytes32 id = keccak256(abi.encode(c, k));
                registry.record(id, bytes32(c), kinds[k], payload);
                (bytes32 storedCampaign, bytes32 storedKind, bytes32 storedPayload) = registry.evidence(id);
                assertEq(storedCampaign, bytes32(c));
                assertEq(storedKind, kinds[k]);
                assertEq(storedPayload, payload);
            }
        }
        vm.stopPrank();
    }

    function testFuzz_ExactReplay(bytes32 id, bytes32 campaign, bytes32 eventKind, bytes32 hash) public {
        vm.assume(id != 0 && campaign != 0 && eventKind != 0 && hash != 0);
        vm.startPrank(recorder);
        registry.record(id, campaign, eventKind, hash);
        registry.record(id, campaign, eventKind, hash);
        (bytes32 c, bytes32 k, bytes32 p) = registry.evidence(id);
        assertEq(c, campaign);
        assertEq(k, eventKind);
        assertEq(p, hash);
        vm.stopPrank();
    }
}
