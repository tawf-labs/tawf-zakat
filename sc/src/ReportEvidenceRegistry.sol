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
    mapping(bytes32 => mapping(bytes32 => string)) private latestVersions;
    mapping(bytes32 => mapping(bytes32 => string)) private packageVersions;
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
        // A first version has no predecessor; a correction succeeds the current official version of this same report.
        string memory latest = latestPackages[institutionKey][reportKey];
        bool succeeds = bytes(a.predecessor).length != 0
            && keccak256(bytes(latest)) == keccak256(bytes(a.predecessor))
            && keccak256(bytes(a.packageId)) != keccak256(bytes(a.predecessor));
        if (!succeeds && (bytes(a.predecessor).length != 0 || bytes(latest).length != 0)) revert AlreadyRecorded();
        // Version and package identity are each written once; display numbering never authorizes.
        if (bytes(publications[institutionKey][reportKey][keccak256(bytes(a.version))].institution.version).length != 0
            || bytes(packageVersions[institutionKey][keccak256(bytes(a.packageId))]).length != 0) revert AlreadyRecorded();
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
        bytes32 reportKey = keccak256(bytes(a.reportId));
        publications[institutionKey][reportKey][keccak256(bytes(a.version))] = Publication(a, v, signature, validatorSignature);
        latestPackages[institutionKey][reportKey] = a.packageId;
        latestVersions[institutionKey][reportKey] = a.version;
        packageVersions[institutionKey][keccak256(bytes(a.packageId))] = a.version;
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
    /// @notice The version identity a reader must use; superseded versions stay readable through their own identity.
    function latestPublishedVersion(string calldata institutionId, string calldata reportId) external view returns (string memory) {
        return latestVersions[keccak256(bytes(institutionId))][keccak256(bytes(reportId))];
    }
    /// @notice Empty for a package that was never published, which is how a losing correction reads back.
    function publishedPackageVersion(string calldata institutionId, string calldata packageId) external view returns (string memory) {
        return packageVersions[keccak256(bytes(institutionId))][keccak256(bytes(packageId))];
    }

    bytes32 public constant ATTEST_REPORT = keccak256("ATTEST_REPORT");
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256("Attestation(bytes32 action,string institutionId,string reportId,string version,string packageId,bytes32 packageDigest,string scope,string conclusion,bytes32 evidenceCommitment,bytes32 predecessor,address auditor,uint256 authorityEpoch,bytes32 nonce,uint256 deadline)");
    /// @notice An engagement scope recorded by the institution being examined. It is not evidence of independence.
    mapping(bytes32 => mapping(address => Authority)) public auditors;
    mapping(bytes32 => mapping(address => string)) private auditorMandates;

    struct Attestation {
        bytes32 action;
        string institutionId;
        string reportId;
        string version;
        string packageId;
        bytes32 packageDigest;
        string scope;
        string conclusion;
        bytes32 evidenceCommitment;
        bytes32 predecessor;
        address auditor;
        uint256 authorityEpoch;
        bytes32 nonce;
        uint256 deadline;
    }
    struct AttestationRecord { Attestation statement; bytes signature; string mandate; }
    mapping(bytes32 => AttestationRecord) private attestationRecords;
    mapping(bytes32 => mapping(bytes32 => mapping(bytes32 => bytes32[]))) private versionAttestations;

    event AuditorChanged(bytes32 indexed institutionKey, address indexed auditor, bool active, uint256 epoch, string mandate);
    event ReportAttested(bytes32 indexed institutionKey, bytes32 indexed packageKey, bytes32 indexed attestation,
        bytes32 action, bytes32 packageDigest, address auditor, bytes32 evidenceCommitment, bytes32 predecessor);

    /// @notice Reader membership grants nothing here; only an explicit institution-scoped mandate does.
    function setAuditor(string calldata institutionId, address auditor, bool active, string calldata mandate) external {
        bytes32 key = keccak256(bytes(institutionId));
        if (msg.sender != administrators[key]) revert Unauthorized();
        if (auditor == address(0) || (active && bytes(mandate).length == 0)) revert InvalidAuthorization();
        Authority storage authority = auditors[key][auditor];
        authority.active = active;
        // Every mandate change invalidates outstanding material, including reactivation.
        authority.epoch++;
        auditorMandates[key][auditor] = mandate;
        emit AuditorChanged(key, auditor, active, authority.epoch, mandate);
    }
    function auditorMandate(string calldata institutionId, address auditor) external view returns (string memory) {
        return auditorMandates[keccak256(bytes(institutionId))][auditor];
    }
    function attestationDigest(Attestation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ATTESTATION_TYPEHASH, a.action,
            keccak256(bytes(a.institutionId)), keccak256(bytes(a.reportId)), keccak256(bytes(a.version)),
            keccak256(bytes(a.packageId)), a.packageDigest, keccak256(bytes(a.scope)), keccak256(bytes(a.conclusion)),
            a.evidenceCommitment, a.predecessor, a.auditor, a.authorityEpoch, a.nonce, a.deadline)));
    }
    function validateAttestation(Attestation calldata a, bytes calldata signature) public view {
        if (a.action != ATTEST_REPORT || a.packageDigest == bytes32(0) || a.evidenceCommitment == bytes32(0)
            || a.nonce == bytes32(0) || bytes(a.scope).length == 0 || bytes(a.conclusion).length == 0
            || bytes(a.reportId).length == 0 || bytes(a.version).length == 0 || bytes(a.packageId).length == 0) revert InvalidAuthorization();
        bytes32 scope = keccak256(bytes(a.scope));
        bytes32 conclusion = keccak256(bytes(a.conclusion));
        if (scope != keccak256("REKONSILIASI_PERIODE") && scope != keccak256("SUMBER_DAN_KOMITMEN")
            && scope != keccak256("TINDAK_LANJUT_TEMUAN")) revert InvalidAuthorization();
        if (conclusion != keccak256("WAJAR_TANPA_PENGECUALIAN") && conclusion != keccak256("WAJAR_DENGAN_PENGECUALIAN")
            && conclusion != keccak256("TIDAK_WAJAR") && conclusion != keccak256("TIDAK_MENYATAKAN_PENDAPAT")) revert InvalidAuthorization();
        bytes32 institutionKey = keccak256(bytes(a.institutionId));
        // An attestation names the version it examined, so that version must exist and match the package it claims.
        Authorization storage accepted = publications[institutionKey][keccak256(bytes(a.reportId))][keccak256(bytes(a.version))].institution;
        if (keccak256(bytes(accepted.packageId)) != keccak256(bytes(a.packageId)) || accepted.digest != a.packageDigest) revert InvalidAuthorization();
        if (a.predecessor != bytes32(0)) {
            // A follow-up extends one auditor's own record on this same version; it never replaces anyone's.
            Attestation storage previous = attestationRecords[a.predecessor].statement;
            if (previous.auditor != a.auditor || keccak256(bytes(previous.institutionId)) != institutionKey
                || keccak256(bytes(previous.reportId)) != keccak256(bytes(a.reportId))
                || keccak256(bytes(previous.version)) != keccak256(bytes(a.version))
                || keccak256(bytes(previous.packageId)) != keccak256(bytes(a.packageId))) revert InvalidAuthorization();
        }
        Authority memory authority = auditors[institutionKey][a.auditor];
        if (!authority.active || authority.epoch != a.authorityEpoch) revert Unauthorized();
        if (block.timestamp > a.deadline) revert Expired();
        if (usedNonces[institutionKey][a.auditor][a.nonce]) revert Replayed();
        if (attestationRecords[attestationDigest(a)].statement.auditor != address(0)) revert AlreadyRecorded();
        if (!SignatureChecker.isValidSignatureNow(a.auditor, attestationDigest(a), signature)) revert InvalidAuthorization();
    }
    /// @notice Appends an examination note to one version. It changes no figure and no institutional endorsement.
    function attestReport(Attestation calldata a, bytes calldata signature) external {
        validateAttestation(a, signature);
        bytes32 institutionKey = keccak256(bytes(a.institutionId));
        bytes32 id = attestationDigest(a);
        usedNonces[institutionKey][a.auditor][a.nonce] = true;
        // Preserve the accepted engagement even after renewal or revocation.
        attestationRecords[id] = AttestationRecord(a, signature, auditorMandates[institutionKey][a.auditor]);
        versionAttestations[institutionKey][keccak256(bytes(a.reportId))][keccak256(bytes(a.version))].push(id);
        emit ReportAttested(institutionKey, keccak256(bytes(a.packageId)), id, a.action, a.packageDigest, a.auditor, a.evidenceCommitment, a.predecessor);
    }
    /// @notice Attestations are held per version identity; a report id alone never addresses them.
    function attestationCount(string calldata institutionId, string calldata reportId, string calldata version) external view returns (uint256) {
        return versionAttestations[keccak256(bytes(institutionId))][keccak256(bytes(reportId))][keccak256(bytes(version))].length;
    }
    function attestationIdAt(string calldata institutionId, string calldata reportId, string calldata version, uint256 index) external view returns (bytes32) {
        return versionAttestations[keccak256(bytes(institutionId))][keccak256(bytes(reportId))][keccak256(bytes(version))][index];
    }
    function attestationById(bytes32 id) external view returns (AttestationRecord memory) {
        return attestationRecords[id];
    }
}
