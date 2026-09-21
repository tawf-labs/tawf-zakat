// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ERC5192} from "@tawf-gov/identity/ERC5192.sol";

/// @notice Mandate truth stays in ReportEvidenceRegistry; this contract never writes to it.
/// Matches the auto-generated getters of its public `signatories`/`administrators` mappings.
interface IMandateSource {
    function signatories(bytes32 institutionKey, address signer) external view returns (bool active, uint256 epoch);
    function administrators(bytes32 institutionKey) external view returns (address);
    function administratorEpochs(bytes32 institutionKey) external view returns (uint256);
}

/// @notice One official, non-transferable certificate per distribution-stage version, minted to an
/// institution's resolved custodian only after an institutional signatory endorses a frozen scope.
/// A correction (#112) is a new version whose signed `predecessor` must be the line's current
/// official version: two competing successors of the same predecessor cannot both mint. The
/// predecessor token keeps its content and stays readable; it is only marked superseded.
///
/// Custody recovery (#113) is replacement issuance, never a transfer: tokens stay locked, so no
/// key (including the administrator's) can move one. When the institution's resolved custodian
/// changes (administrator designation or registry administrator rotation), an active signatory
/// endorses a `CustodyRecovery` and a NEW locked token with the same content commitment, activity,
/// certificate and version, and the ORIGINAL issuer, is minted to the resolved custodian. The old
/// token stays readable, held by the old custodian, and is marked replaced.
contract DistributionCertificateNFT is EIP712, ERC5192 {
    bytes32 public constant ISSUE_CERTIFICATE = keccak256("ISSUE_CERTIFICATE");
    bytes32 public constant RECOVER_CUSTODY = keccak256("RECOVER_CUSTODY");
    bytes32 public constant RECOVERY_TYPEHASH = keccak256(
        "CustodyRecovery(bytes32 action,string institutionId,string certificateId,string version,address newCustodian,uint256 previousTokenId,uint256 custodyEpoch,uint256 administratorEpoch,bytes32 basisDigest,address signer,uint256 authorityEpoch,bytes32 nonce,uint256 deadline)"
    );
    bytes32 public constant CERTIFICATION_TYPEHASH = keccak256(
        "Certification(bytes32 action,string institutionId,string activityId,string certificateId,string version,string predecessor,bytes32 digest,address signer,uint256 authorityEpoch,bytes32 nonce,uint256 deadline)"
    );

    IMandateSource public immutable registry;
    uint256 private tokenIdCounter;

    struct Certification {
        bytes32 action;
        string institutionId;
        string activityId;
        string certificateId;
        string version;
        string predecessor;
        bytes32 digest;
        address signer;
        uint256 authorityEpoch;
        bytes32 nonce;
        uint256 deadline;
    }

    struct CustodyRecovery {
        bytes32 action;
        string institutionId;
        string certificateId;
        string version;
        address newCustodian;
        uint256 previousTokenId;
        uint256 custodyEpoch;
        uint256 administratorEpoch;
        bytes32 basisDigest;
        address signer;
        uint256 authorityEpoch;
        bytes32 nonce;
        uint256 deadline;
    }

    mapping(uint256 tokenId => uint256 replacementTokenId) public custodyReplacedBy;
    mapping(uint256 tokenId => uint256 originalTokenId) public custodyReplacementOf;
    mapping(uint256 tokenId => address signer) public recoverySignerOf;
    mapping(uint256 tokenId => bytes32 basisDigest) public recoveryBasisOf;

    mapping(bytes32 institutionKey => mapping(address signer => mapping(bytes32 nonce => bool used))) public usedNonces;
    mapping(bytes32 institutionKey => mapping(bytes32 certificateKey => mapping(bytes32 versionKey => uint256 tokenId))) private certificateVersions;
    mapping(bytes32 institutionKey => mapping(bytes32 certificateKey => string version)) private latestVersions;
    mapping(uint256 tokenId => bytes32 digest) private tokenDigests;
    mapping(uint256 tokenId => address signer) private tokenIssuers;
    mapping(uint256 tokenId => string activityId) private tokenActivities;
    mapping(uint256 tokenId => string certificateId) private tokenCertificateIds;
    mapping(uint256 tokenId => string version) private tokenVersions;
    mapping(uint256 tokenId => uint256 successorTokenId) public successorOf;
    mapping(uint256 tokenId => uint256 predecessorTokenId) public predecessorOf;
    mapping(bytes32 institutionKey => address custodian) public custodianOf;
    mapping(bytes32 institutionKey => uint256 epoch) public custodyEpochs;

    error Unauthorized();
    error InvalidAuthorization();
    error Expired();
    error Replayed();
    error AlreadyIssued();
    error OutOfScope();
    error NoCustodian();
    error WrongPredecessor();
    error NotRecoverable();

    event CertificateIssued(
        bytes32 indexed institutionKey,
        bytes32 indexed certificateKey,
        uint256 indexed tokenId,
        string version,
        bytes32 digest,
        address signer,
        address custodian
    );
    event CertificateSuperseded(
        bytes32 indexed institutionKey,
        bytes32 indexed certificateKey,
        uint256 indexed predecessorTokenId,
        uint256 successorTokenId
    );
    event CustodyRecovered(
        bytes32 indexed institutionKey,
        bytes32 indexed certificateKey,
        uint256 indexed replacedTokenId,
        uint256 newTokenId,
        address newCustodian,
        address signer,
        bytes32 basisDigest
    );
    event CustodianUpdated(bytes32 indexed institutionKey, address previous, address next);

    constructor(address mandateSource)
        EIP712("Tawf Distribution Certificate", "1")
        ERC5192("Tawf Distribution Certificate", "TDC", true)
    {
        if (mandateSource == address(0)) revert Unauthorized();
        registry = IMandateSource(mandateSource);
    }

    /// @notice Only the institution's registry administrator may point future mints at a new
    /// custodian address. This is the seam #113's account-recovery flow extends; it is deliberately
    /// a single admin-settable pointer here, not a recovery protocol.
    function setCustodian(string calldata institutionId, address custodian) external {
        bytes32 key = keccak256(bytes(institutionId));
        if (msg.sender != registry.administrators(key)) revert Unauthorized();
        if (custodian == address(0)) revert InvalidAuthorization();
        address previous = custodianOf[key];
        custodianOf[key] = custodian;
        custodyEpochs[key]++;
        emit CustodianUpdated(key, previous, custodian);
    }

    function certificationDigest(Certification calldata c) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CERTIFICATION_TYPEHASH,
                    c.action,
                    keccak256(bytes(c.institutionId)),
                    keccak256(bytes(c.activityId)),
                    keccak256(bytes(c.certificateId)),
                    keccak256(bytes(c.version)),
                    keccak256(bytes(c.predecessor)),
                    c.digest,
                    c.signer,
                    c.authorityEpoch,
                    c.nonce,
                    c.deadline
                )
            )
        );
    }

    function validateCertification(Certification calldata c, bytes calldata signature) public view {
        if (
            c.action != ISSUE_CERTIFICATE || c.digest == bytes32(0) || c.nonce == bytes32(0)
                || bytes(c.activityId).length == 0 || bytes(c.certificateId).length == 0
                || bytes(c.version).length == 0
        ) revert InvalidAuthorization();
        bytes32 institutionKey = keccak256(bytes(c.institutionId));
        (bool active, uint256 epoch) = registry.signatories(institutionKey, c.signer);
        if (!active || epoch != c.authorityEpoch) revert Unauthorized();
        if (block.timestamp > c.deadline) revert Expired();
        if (usedNonces[institutionKey][c.signer][c.nonce]) revert Replayed();
        bytes32 certificateKey = keccak256(bytes(c.certificateId));
        bytes32 latestKey = keccak256(bytes(latestVersions[institutionKey][certificateKey]));
        if (bytes(c.predecessor).length == 0) {
            if (bytes(latestVersions[institutionKey][certificateKey]).length != 0) revert AlreadyIssued();
        } else {
            // Only the official head can be corrected, and a line never moves to another activity.
            if (keccak256(bytes(c.predecessor)) != latestKey) revert WrongPredecessor();
            uint256 previous = certificateVersions[institutionKey][certificateKey][latestKey];
            if (keccak256(bytes(tokenActivities[previous])) != keccak256(bytes(c.activityId))) revert OutOfScope();
        }
        if (certificateVersions[institutionKey][certificateKey][keccak256(bytes(c.version))] != 0) revert AlreadyIssued();
        if (!SignatureChecker.isValidSignatureNow(c.signer, certificationDigest(c), signature)) revert InvalidAuthorization();
    }

    /// @notice Mints one official certificate NFT to the institution's resolved custodian. Reverts
    /// rather than falling back to an arbitrary address when no custodian has been designated.
    function issueCertificate(Certification calldata c, bytes calldata signature) external returns (uint256 tokenId) {
        validateCertification(c, signature);
        bytes32 institutionKey = keccak256(bytes(c.institutionId));
        address custodian = resolvedCustodian(institutionKey);
        if (custodian == address(0)) revert NoCustodian();

        usedNonces[institutionKey][c.signer][c.nonce] = true;
        bytes32 certificateKey = keccak256(bytes(c.certificateId));
        uint256 previousToken = bytes(c.predecessor).length == 0
            ? 0
            : certificateVersions[institutionKey][certificateKey][keccak256(bytes(c.predecessor))];

        tokenId = ++tokenIdCounter;
        tokenDigests[tokenId] = c.digest;
        tokenIssuers[tokenId] = c.signer;
        tokenActivities[tokenId] = c.activityId;
        tokenCertificateIds[tokenId] = c.certificateId;
        tokenVersions[tokenId] = c.version;
        certificateVersions[institutionKey][certificateKey][keccak256(bytes(c.version))] = tokenId;
        latestVersions[institutionKey][certificateKey] = c.version;
        if (previousToken != 0) {
            successorOf[previousToken] = tokenId;
            predecessorOf[tokenId] = previousToken;
            emit CertificateSuperseded(institutionKey, certificateKey, previousToken, tokenId);
        }

        // Reserve the certificate and initialize its content before the receiver callback.
        _safeMint(custodian, tokenId);

        emit CertificateIssued(institutionKey, certificateKey, tokenId, c.version, c.digest, c.signer, custodian);
    }

    /// @notice The address new tokens are minted to: the designated custodian, else the registry
    /// administrator. Recovery only ever targets this address.
    function resolvedCustodian(bytes32 institutionKey) public view returns (address custodian) {
        custodian = custodianOf[institutionKey];
        if (custodian == address(0)) custodian = registry.administrators(institutionKey);
    }

    /// @notice Both authority histories are bound even when a designated custodian overrides the administrator.
    function recoveryEpochs(bytes32 institutionKey) public view returns (uint256 custodyEpoch, uint256 administratorEpoch) {
        return (custodyEpochs[institutionKey], registry.administratorEpochs(institutionKey));
    }

    function recoveryDigest(CustodyRecovery calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECOVERY_TYPEHASH,
                    r.action,
                    keccak256(bytes(r.institutionId)),
                    keccak256(bytes(r.certificateId)),
                    keccak256(bytes(r.version)),
                    r.newCustodian,
                    r.previousTokenId,
                    r.custodyEpoch,
                    r.administratorEpoch,
                    r.basisDigest,
                    r.signer,
                    r.authorityEpoch,
                    r.nonce,
                    r.deadline
                )
            )
        );
    }

    /// @dev Reverts unless recovery of the line's official head to the resolved custodian is valid now.
    function validateRecovery(CustodyRecovery calldata r, bytes calldata signature) public view {
        if (
            r.action != RECOVER_CUSTODY || r.basisDigest == bytes32(0) || r.nonce == bytes32(0)
                || bytes(r.certificateId).length == 0 || bytes(r.version).length == 0 || r.newCustodian == address(0)
        ) revert InvalidAuthorization();
        bytes32 institutionKey = keccak256(bytes(r.institutionId));
        (bool active, uint256 epoch) = registry.signatories(institutionKey, r.signer);
        if (!active || epoch != r.authorityEpoch) revert Unauthorized();
        if (block.timestamp > r.deadline) revert Expired();
        if (usedNonces[institutionKey][r.signer][r.nonce]) revert Replayed();
        // Bind the authority history, not just its current address: a round trip cannot revive a signature.
        (uint256 custodyEpoch, uint256 administratorEpoch) = recoveryEpochs(institutionKey);
        if (r.custodyEpoch != custodyEpoch || r.administratorEpoch != administratorEpoch) revert Unauthorized();
        // The target must be what the institution's own administrator has designated (or is).
        if (r.newCustodian != resolvedCustodian(institutionKey)) revert Unauthorized();
        bytes32 certificateKey = keccak256(bytes(r.certificateId));
        // Only the line's official head moves; superseded versions stay as history with their holder.
        if (keccak256(bytes(latestVersions[institutionKey][certificateKey])) != keccak256(bytes(r.version))) revert NotRecoverable();
        uint256 token = certificateVersions[institutionKey][certificateKey][keccak256(bytes(r.version))];
        if (token == 0 || token != r.previousTokenId || ownerOf(token) == r.newCustodian) revert NotRecoverable();
        if (!SignatureChecker.isValidSignatureNow(r.signer, recoveryDigest(r), signature)) revert InvalidAuthorization();
    }

    /// @notice Mints the replacement token to the resolved custodian. Not a transfer: the replaced
    /// token stays locked with its old holder, and issuer, content commitment and version are copied.
    function recoverCustody(CustodyRecovery calldata r, bytes calldata signature) external returns (uint256 newTokenId) {
        validateRecovery(r, signature);
        bytes32 institutionKey = keccak256(bytes(r.institutionId));
        bytes32 certificateKey = keccak256(bytes(r.certificateId));
        bytes32 versionKey = keccak256(bytes(r.version));
        uint256 oldTokenId = certificateVersions[institutionKey][certificateKey][versionKey];

        usedNonces[institutionKey][r.signer][r.nonce] = true;
        newTokenId = ++tokenIdCounter;
        tokenDigests[newTokenId] = tokenDigests[oldTokenId];
        tokenIssuers[newTokenId] = tokenIssuers[oldTokenId];
        tokenActivities[newTokenId] = tokenActivities[oldTokenId];
        tokenCertificateIds[newTokenId] = tokenCertificateIds[oldTokenId];
        tokenVersions[newTokenId] = tokenVersions[oldTokenId];
        predecessorOf[newTokenId] = predecessorOf[oldTokenId];
        recoverySignerOf[newTokenId] = r.signer;
        recoveryBasisOf[newTokenId] = r.basisDigest;
        custodyReplacedBy[oldTokenId] = newTokenId;
        custodyReplacementOf[newTokenId] = oldTokenId;
        certificateVersions[institutionKey][certificateKey][versionKey] = newTokenId;

        _safeMint(r.newCustodian, newTokenId);
        emit CustodyRecovered(institutionKey, certificateKey, oldTokenId, newTokenId, r.newCustodian, r.signer, r.basisDigest);
    }

    /// @notice The first token ever minted for this version, following replacements backwards.
    function originalTokenOf(uint256 tokenId) public view returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert ErrNotFound();
        while (custodyReplacementOf[tokenId] != 0) tokenId = custodyReplacementOf[tokenId];
        return tokenId;
    }

    /// @notice The token that currently represents this version, following replacements forward.
    function activeTokenOf(uint256 tokenId) public view returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert ErrNotFound();
        while (custodyReplacedBy[tokenId] != 0) tokenId = custodyReplacedBy[tokenId];
        return tokenId;
    }

    function issuerOf(uint256 tokenId) external view returns (address) {
        if (_ownerOf(tokenId) == address(0)) revert ErrNotFound();
        return tokenIssuers[tokenId];
    }

    function contentDigestOf(uint256 tokenId) external view returns (bytes32) {
        if (_ownerOf(tokenId) == address(0)) revert ErrNotFound();
        return tokenDigests[tokenId];
    }

    function certificateOf(uint256 tokenId)
        external
        view
        returns (string memory activityId, string memory certificateId, string memory version)
    {
        if (_ownerOf(tokenId) == address(0)) revert ErrNotFound();
        return (tokenActivities[tokenId], tokenCertificateIds[tokenId], tokenVersions[tokenId]);
    }

    /// @notice Chain-only status of a token: true while no successor has been minted for it.
    /// This says nothing about whether the offchain source has since been disputed or changed.
    function isLatestVersion(uint256 tokenId) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) revert ErrNotFound();
        return successorOf[activeTokenOf(tokenId)] == 0;
    }

    function certificateVersionToken(string calldata institutionId, string calldata certificateId, string calldata version)
        external
        view
        returns (uint256)
    {
        return certificateVersions[keccak256(bytes(institutionId))][keccak256(bytes(certificateId))][keccak256(bytes(version))];
    }

    function latestCertificateVersion(string calldata institutionId, string calldata certificateId)
        external
        view
        returns (string memory)
    {
        return latestVersions[keccak256(bytes(institutionId))][keccak256(bytes(certificateId))];
    }
}
