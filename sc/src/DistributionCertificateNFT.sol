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
}

/// @notice One official, non-transferable certificate per distribution-stage version, minted to an
/// institution's resolved custodian only after an institutional signatory endorses a frozen scope.
/// Correction/succession across versions is issue #112's contract change, not this one's: a
/// version with a non-empty predecessor is rejected here, not processed.
contract DistributionCertificateNFT is EIP712, ERC5192 {
    bytes32 public constant ISSUE_CERTIFICATE = keccak256("ISSUE_CERTIFICATE");
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

    mapping(bytes32 institutionKey => mapping(address signer => mapping(bytes32 nonce => bool used))) public usedNonces;
    mapping(bytes32 institutionKey => mapping(bytes32 certificateKey => mapping(bytes32 versionKey => uint256 tokenId))) private certificateVersions;
    mapping(bytes32 institutionKey => mapping(bytes32 certificateKey => string version)) private latestVersions;
    mapping(uint256 tokenId => bytes32 digest) private tokenDigests;
    mapping(uint256 tokenId => address signer) private tokenIssuers;
    mapping(uint256 tokenId => string activityId) private tokenActivities;
    mapping(uint256 tokenId => string certificateId) private tokenCertificateIds;
    mapping(uint256 tokenId => string version) private tokenVersions;
    mapping(bytes32 institutionKey => address custodian) public custodianOf;

    error Unauthorized();
    error InvalidAuthorization();
    error Expired();
    error Replayed();
    error AlreadyIssued();
    error OutOfScope();
    error NoCustodian();

    event CertificateIssued(
        bytes32 indexed institutionKey,
        bytes32 indexed certificateKey,
        uint256 indexed tokenId,
        string version,
        bytes32 digest,
        address signer,
        address custodian
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
        // Correction/succession across an existing certificate line is #112's contract change.
        if (bytes(c.predecessor).length != 0) revert OutOfScope();
        bytes32 institutionKey = keccak256(bytes(c.institutionId));
        (bool active, uint256 epoch) = registry.signatories(institutionKey, c.signer);
        if (!active || epoch != c.authorityEpoch) revert Unauthorized();
        if (block.timestamp > c.deadline) revert Expired();
        if (usedNonces[institutionKey][c.signer][c.nonce]) revert Replayed();
        bytes32 certificateKey = keccak256(bytes(c.certificateId));
        if (bytes(latestVersions[institutionKey][certificateKey]).length != 0) revert AlreadyIssued();
        if (certificateVersions[institutionKey][certificateKey][keccak256(bytes(c.version))] != 0) revert AlreadyIssued();
        if (!SignatureChecker.isValidSignatureNow(c.signer, certificationDigest(c), signature)) revert InvalidAuthorization();
    }

    /// @notice Mints one official certificate NFT to the institution's resolved custodian. Reverts
    /// rather than falling back to an arbitrary address when no custodian has been designated.
    function issueCertificate(Certification calldata c, bytes calldata signature) external returns (uint256 tokenId) {
        validateCertification(c, signature);
        bytes32 institutionKey = keccak256(bytes(c.institutionId));
        address custodian = custodianOf[institutionKey];
        if (custodian == address(0)) custodian = registry.administrators(institutionKey);
        if (custodian == address(0)) revert NoCustodian();

        usedNonces[institutionKey][c.signer][c.nonce] = true;
        bytes32 certificateKey = keccak256(bytes(c.certificateId));

        tokenId = ++tokenIdCounter;
        _safeMint(custodian, tokenId);
        tokenDigests[tokenId] = c.digest;
        tokenIssuers[tokenId] = c.signer;
        tokenActivities[tokenId] = c.activityId;
        tokenCertificateIds[tokenId] = c.certificateId;
        tokenVersions[tokenId] = c.version;
        certificateVersions[institutionKey][certificateKey][keccak256(bytes(c.version))] = tokenId;
        latestVersions[institutionKey][certificateKey] = c.version;

        emit CertificateIssued(institutionKey, certificateKey, tokenId, c.version, c.digest, c.signer, custodian);
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
