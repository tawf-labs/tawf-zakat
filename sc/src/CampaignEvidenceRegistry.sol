// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @notice Append-only commitments, not payment verification, tokens, or custody.
/// @dev IDs must be opaque identifiers; never submit personal data or its unsalted hash.
contract CampaignEvidenceRegistry {
    error Unauthorized();
    error InvalidAddress();
    error InvalidCommitment();
    error EvidenceConflict();

    address public immutable administrator;
    address public recorder;

    struct Evidence {
        bytes32 campaignId;
        bytes32 kind;
        bytes32 payloadHash;
    }

    mapping(bytes32 eventId => Evidence) public evidence;

    event RecorderRotated(address indexed previousRecorder, address indexed newRecorder);
    event EvidenceRecorded(
        bytes32 indexed eventId, bytes32 indexed campaignId, bytes32 indexed kind, bytes32 payloadHash
    );

    constructor(address administrator_, address recorder_) {
        if (administrator_ == address(0) || recorder_ == address(0) || administrator_ == recorder_) {
            revert InvalidAddress();
        }
        administrator = administrator_;
        recorder = recorder_;
        emit RecorderRotated(address(0), recorder_);
    }

    /// @notice The administrator cannot write evidence, and the recorder cannot rotate itself.
    function rotateRecorder(address nextRecorder) external {
        if (msg.sender != administrator) revert Unauthorized();
        if (nextRecorder == address(0) || nextRecorder == administrator) revert InvalidAddress();
        address previous = recorder;
        recorder = nextRecorder;
        emit RecorderRotated(previous, nextRecorder);
    }

    /// @notice Exact retries succeed without emitting duplicate evidence; conflicting IDs always revert.
    function record(bytes32 eventId, bytes32 campaignId, bytes32 kind, bytes32 payloadHash) external {
        if (msg.sender != recorder) revert Unauthorized();
        if (eventId == bytes32(0) || campaignId == bytes32(0) || kind == bytes32(0) || payloadHash == bytes32(0)) {
            revert InvalidCommitment();
        }
        Evidence storage previous = evidence[eventId];
        if (previous.payloadHash != bytes32(0)) {
            if (previous.campaignId != campaignId || previous.kind != kind || previous.payloadHash != payloadHash) {
                revert EvidenceConflict();
            }
            return;
        }
        evidence[eventId] = Evidence(campaignId, kind, payloadHash);
        emit EvidenceRecorded(eventId, campaignId, kind, payloadHash);
    }
}
