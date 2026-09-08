// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Noncustodial pilot evidence registry. Recording is neither publication nor an audit opinion.
contract ReportEvidenceRegistry is EIP712 {
    bytes32 public constant RECORD_EVIDENCE = keccak256("RECORD_EVIDENCE");
    bytes32 public constant AUTHORIZATION_TYPEHASH = keccak256("Authorization(bytes32 action,string institutionId,string reportId,string version,string packageId,string predecessor,bytes32 digest,string policy,string outcome,address signer,uint256 authorityEpoch,bytes32 nonce,uint256 deadline)");
    address public immutable admissionAuthority;
    mapping(bytes32 => address) public administrators;
    mapping(bytes32 => address) public pendingAdministrators;
    struct Authority { bool active; uint256 epoch; }
    mapping(bytes32 => mapping(address => Authority)) public signatories;
    mapping(bytes32 => mapping(address => mapping(bytes32 => bool))) public usedNonces;
    mapping(bytes32 => mapping(bytes32 => bytes32)) private evidence;

    struct Authorization {
        bytes32 action;
        string institutionId;
        string reportId;
        string version;
        string packageId;
        string predecessor;
        bytes32 digest;
        string policy;
        string outcome;
        address signer;
        uint256 authorityEpoch;
        bytes32 nonce;
        uint256 deadline;
    }
    error Unauthorized();
    error InvalidAuthorization();
    error Expired();
    error Replayed();
    error AlreadyRecorded();
    event InstitutionEnrolled(bytes32 indexed institutionKey, string institutionId, address administrator);
    event AdministratorProposed(bytes32 indexed institutionKey, address administrator, address successor);
    event AdministratorAccepted(bytes32 indexed institutionKey, address previous, address administrator);
    event SignatoryChanged(bytes32 indexed institutionKey, address indexed signer, bool active, uint256 epoch);
    event EvidenceRecorded(bytes32 indexed institutionKey, bytes32 indexed packageKey, bytes32 indexed authorization, bytes32 action, bytes32 digest, address signer);

    constructor(address admission) EIP712("Tawf Report Evidence", "1") {
        if (admission == address(0)) revert Unauthorized();
        admissionAuthority = admission;
    }
    function enrollInstitution(string calldata institutionId, address administrator) external {
        bytes32 key = keccak256(bytes(institutionId));
        if (msg.sender != admissionAuthority) revert Unauthorized();
        if (bytes(institutionId).length == 0 || administrator == address(0) || administrators[key] != address(0)) revert InvalidAuthorization();
        administrators[key] = administrator;
        emit InstitutionEnrolled(key, institutionId, administrator);
    }
    function proposeAdministrator(string calldata institutionId, address successor) external {
        bytes32 key = keccak256(bytes(institutionId));
        if (msg.sender != administrators[key]) revert Unauthorized();
        // Zero cancels an outstanding proposal; admission has no recovery override.
        pendingAdministrators[key] = successor;
        emit AdministratorProposed(key, msg.sender, successor);
    }
    function acceptAdministrator(string calldata institutionId) external {
        bytes32 key = keccak256(bytes(institutionId));
        if (msg.sender != pendingAdministrators[key]) revert Unauthorized();
        address previous = administrators[key];
        administrators[key] = msg.sender;
        delete pendingAdministrators[key];
        emit AdministratorAccepted(key, previous, msg.sender);
    }
    function setSignatory(string calldata institutionId, address signer, bool active) external {
        bytes32 key = keccak256(bytes(institutionId));
        if (msg.sender != administrators[key]) revert Unauthorized();
        if (signer == address(0)) revert InvalidAuthorization();
        Authority storage authority = signatories[key][signer];
        authority.active = active;
        // Every mandate change invalidates outstanding material, including reactivation.
        authority.epoch++;
        emit SignatoryChanged(key, signer, active, authority.epoch);
    }
    function authorizationDigest(Authorization calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(AUTHORIZATION_TYPEHASH, a.action,
            keccak256(bytes(a.institutionId)), keccak256(bytes(a.reportId)), keccak256(bytes(a.version)),
            keccak256(bytes(a.packageId)), keccak256(bytes(a.predecessor)), a.digest,
            keccak256(bytes(a.policy)), keccak256(bytes(a.outcome)), a.signer, a.authorityEpoch, a.nonce, a.deadline)));
    }
    function validateAuthorization(Authorization calldata a, bytes calldata signature) public view {
        if (a.action != RECORD_EVIDENCE || a.digest == bytes32(0) || a.nonce == bytes32(0)
            || bytes(a.reportId).length == 0 || bytes(a.version).length == 0 || bytes(a.packageId).length == 0
            || bytes(a.policy).length == 0
            || (keccak256(bytes(a.outcome)) != keccak256("LOLOS") && keccak256(bytes(a.outcome)) != keccak256("DITOLAK"))) revert InvalidAuthorization();
        bytes32 institutionKey = keccak256(bytes(a.institutionId));
        Authority memory authority = signatories[institutionKey][a.signer];
        if (!authority.active || authority.epoch != a.authorityEpoch) revert Unauthorized();
        if (block.timestamp > a.deadline) revert Expired();
        if (usedNonces[institutionKey][a.signer][a.nonce]) revert Replayed();
        if (evidence[institutionKey][keccak256(bytes(a.packageId))] != bytes32(0)) revert AlreadyRecorded();
        if (!SignatureChecker.isValidSignatureNow(a.signer, authorizationDigest(a), signature)) revert InvalidAuthorization();
    }
    function recordEvidence(Authorization calldata a, bytes calldata signature) external {
        validateAuthorization(a, signature);
        bytes32 institutionKey = keccak256(bytes(a.institutionId));
        bytes32 packageKey = keccak256(bytes(a.packageId));
        usedNonces[institutionKey][a.signer][a.nonce] = true;
        evidence[institutionKey][packageKey] = a.digest;
        emit EvidenceRecorded(institutionKey, packageKey, authorizationDigest(a), a.action, a.digest, a.signer);
    }
    function evidenceDigest(string calldata institutionId, string calldata packageId) external view returns (bytes32) {
        return evidence[keccak256(bytes(institutionId))][keccak256(bytes(packageId))];
    }

    bytes32 public constant PUBLISH_REPORT = keccak256("PUBLISH_REPORT");
    bytes32 public constant VALIDATE_REPORT = keccak256("VALIDATE_REPORT");
    mapping(address => Authority) public validators;
    struct Publication { Authorization institution; Authorization validator; bytes institutionSignature; bytes validatorSignature; }
    mapping(bytes32 => mapping(bytes32 => mapping(bytes32 => Publication))) private publications;
    mapping(bytes32 => mapping(bytes32 => string)) private latestPackages;
    event ValidatorChanged(address indexed validator, bool active, uint256 epoch);
    event ReportPublished(bytes32 indexed institutionKey, bytes32 indexed packageKey, bytes32 indexed authorization,
        bytes32 action, bytes32 digest, address signer, bytes32 validatorAuthorization, address validator);

    function setValidator(address validator, bool active) external {
        if (msg.sender != admissionAuthority) revert Unauthorized();
        if (validator == address(0)) revert InvalidAuthorization();
        Authority storage authority = validators[validator];
        authority.active = active;
        authority.epoch++;
        emit ValidatorChanged(validator, active, authority.epoch);
    }
    function publicationPayload(Authorization calldata a) private pure returns (bytes32) {
        return keccak256(abi.encode(a.institutionId, a.reportId, a.version, a.packageId, a.predecessor,
            a.digest, a.policy, a.outcome, a.deadline));
    }
    function checkPublicationSignature(Authorization calldata a, bytes calldata signature, Authority memory role) private view {
        if (!role.active || role.epoch != a.authorityEpoch) revert Unauthorized();
        if (block.timestamp > a.deadline) revert Expired();
        if (a.nonce == bytes32(0)) revert InvalidAuthorization();
        if (usedNonces[keccak256(bytes(a.institutionId))][a.signer][a.nonce]) revert Replayed();
        if (!SignatureChecker.isValidSignatureNow(a.signer, authorizationDigest(a), signature)) revert InvalidAuthorization();
    }
    function validatePublication(Authorization calldata a, bytes calldata signature, Authorization calldata v, bytes calldata validatorSignature) public view {
        if (a.action != PUBLISH_REPORT || v.action != VALIDATE_REPORT || a.signer == v.signer
            || a.digest == bytes32(0) || bytes(a.reportId).length == 0 || bytes(a.version).length == 0
            || bytes(a.packageId).length == 0 || bytes(a.policy).length == 0
            || keccak256(bytes(a.outcome)) != keccak256("LOLOS") || publicationPayload(a) != publicationPayload(v)) revert InvalidAuthorization();
        bytes32 institutionKey = keccak256(bytes(a.institutionId));
        bytes32 reportKey = keccak256(bytes(a.reportId));
        // First publication only. A future correction must explicitly check the predecessor and append.
        if (bytes(a.predecessor).length != 0 || bytes(latestPackages[institutionKey][reportKey]).length != 0) revert AlreadyRecorded();
        bytes32 recorded = evidence[institutionKey][keccak256(bytes(a.packageId))];
        if (recorded != bytes32(0) && recorded != a.digest) revert InvalidAuthorization();
        checkPublicationSignature(a, signature, signatories[institutionKey][a.signer]);
        checkPublicationSignature(v, validatorSignature, validators[v.signer]);
    }
    function publishReport(Authorization calldata a, bytes calldata signature, Authorization calldata v, bytes calldata validatorSignature) external {
        validatePublication(a, signature, v, validatorSignature);
        bytes32 institutionKey = keccak256(bytes(a.institutionId));
        usedNonces[institutionKey][a.signer][a.nonce] = true;
        usedNonces[institutionKey][v.signer][v.nonce] = true;
        publications[institutionKey][keccak256(bytes(a.reportId))][keccak256(bytes(a.version))] = Publication(a, v, signature, validatorSignature);
        latestPackages[institutionKey][keccak256(bytes(a.reportId))] = a.packageId;
        evidence[institutionKey][keccak256(bytes(a.packageId))] = a.digest;
        emit ReportPublished(institutionKey, keccak256(bytes(a.packageId)), authorizationDigest(a), a.action,
            a.digest, a.signer, authorizationDigest(v), v.signer);
    }
    function publishedVersion(string calldata institutionId, string calldata reportId, string calldata version) external view returns (Publication memory) {
        return publications[keccak256(bytes(institutionId))][keccak256(bytes(reportId))][keccak256(bytes(version))];
    }
    function latestPublishedPackage(string calldata institutionId, string calldata reportId) external view returns (string memory) {
        return latestPackages[keccak256(bytes(institutionId))][keccak256(bytes(reportId))];
    }
}
