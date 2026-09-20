// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata input
    ) external view returns (bool r);
}

/**
 * @title ContributionProofRegistry
 * @notice Persistent registry for institution-endorsed contribution batch roots
 *         and real ZK-SNARK receipt proof verifications (Spec #100, Issue #108).
 *
 * @dev Enforces:
 * - Separation of mathematical validity from institutional authority (AC03, AC17):
 *   A mathematically valid proof against an unauthorized root is rejected.
 * - Identity and amount privacy (AC15):
 *   Public inputs do NOT contain donor identity, amount, or Merkle path.
 * - Idempotent, persistent single confirmation per receipt version (AC04, AC18).
 * - Repeatable zero-cost donor checks via view calls (AC05, AC18).
 */
contract ContributionProofRegistry {
    // BN254 / alt_bn128 scalar field order
    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IGroth16Verifier public immutable verifier;
    address public immutable admissionAuthority;

    // Institution administration: institutionKey => administrator address
    mapping(bytes32 => address) public administrators;
    // Authorized batch signers: institutionKey => signer address => isAuthorized
    mapping(bytes32 => mapping(address => bool)) public authorizedSigners;

    struct BatchRecord {
        bytes32 root;
        uint256 version;
        address endorsedBy;
        uint256 endorsedAt;
        bool exists;
    }

    // institutionKey => batchId => BatchRecord (latest)
    mapping(bytes32 => mapping(uint256 => BatchRecord)) public batches;
    // institutionKey => batchId => version => BatchRecord
    mapping(bytes32 => mapping(uint256 => mapping(uint256 => BatchRecord))) public batchVersions;
    // institutionKey => batchRoot => BatchRecord
    mapping(bytes32 => mapping(bytes32 => BatchRecord)) public batchesByRoot;

    // The chain cannot observe an offchain correction until publication succeeds.
    // There is deliberately no CURRENT value: readers must check the live source.
    enum BusinessValidity { UNKNOWN, SUPERSEDED }

    struct VerifiedReceipt {
        bool isVerified;
        uint256 batchId;
        uint256 batchVersion;
        uint256 version;
        bytes32 batchRoot;
        bytes32 receiptCommitment;
        uint256 verifiedAt;
        uint256 blockNumber;
        address submitter;
    }

    // receiptKey = keccak256(abi.encode(institutionId, contributionId, version)) => VerifiedReceipt
    mapping(bytes32 => VerifiedReceipt) public verifiedReceipts;

    // --- CUSTOM ERRORS ---
    error Unauthorized();
    error InvalidAddress();
    error BatchAlreadyExists();
    error BatchNotFound();
    error InvalidBatchVersion();
    error UnauthorizedBatchRoot();
    error InvalidStatementBinding();
    error InvalidProof();

    // --- EVENTS ---
    event InstitutionEnrolled(bytes32 indexed institutionKey, string institutionId, address administrator);
    event SignerAuthorized(bytes32 indexed institutionKey, address indexed signer, bool authorized);
    event BatchRootEndorsed(
        bytes32 indexed institutionKey,
        string institutionId,
        uint256 indexed batchId,
        uint256 indexed version,
        bytes32 batchRoot,
        address endorsedBy
    );
    event ReceiptProofVerified(
        bytes32 indexed receiptKey,
        string institutionId,
        string contributionId,
        uint256 batchId,
        uint256 version,
        bytes32 batchRoot,
        bytes32 receiptCommitment,
        address submitter
    );

    constructor(address _verifier, address _admissionAuthority) {
        if (_verifier.code.length == 0 || _admissionAuthority == address(0)) {
            revert InvalidAddress();
        }
        verifier = IGroth16Verifier(_verifier);
        admissionAuthority = _admissionAuthority;
    }

    function toField(bytes32 value) public pure returns (uint256) {
        return uint256(value) % SNARK_SCALAR_FIELD;
    }

    function enrollInstitution(string calldata institutionId, address admin) external {
        bytes32 key = keccak256(bytes(institutionId));
        if (msg.sender != admissionAuthority) revert Unauthorized();
        if (admin == address(0) || administrators[key] != address(0)) revert Unauthorized();

        administrators[key] = admin;
        authorizedSigners[key][admin] = true;
        emit InstitutionEnrolled(key, institutionId, admin);
    }

    function setSigner(string calldata institutionId, address signer, bool authorized) external {
        bytes32 key = keccak256(bytes(institutionId));
        if (msg.sender != administrators[key] && msg.sender != admissionAuthority) revert Unauthorized();
        if (signer == address(0)) revert InvalidAddress();

        authorizedSigners[key][signer] = authorized;
        emit SignerAuthorized(key, signer, authorized);
    }

    /**
     * @notice Endorse an authorized contribution batch root for an institution.
     *         Supports initial version 1 and strictly monotonic successor versions (v2, v3, ...).
     *         Prevents competing successor roots from branching (Spec #100, Issue #110).
     */
    function endorseBatchRoot(
        string calldata institutionId,
        uint256 batchId,
        uint256 version,
        bytes32 batchRoot
    ) external {
        bytes32 key = keccak256(bytes(institutionId));
        if (!authorizedSigners[key][msg.sender] && msg.sender != admissionAuthority) {
            revert Unauthorized();
        }
        if (administrators[key] == address(0) || version == 0 || uint256(batchRoot) >= SNARK_SCALAR_FIELD || batchRoot == bytes32(0)) revert UnauthorizedBatchRoot();

        BatchRecord storage current = batches[key][batchId];
        if (version == 1) {
            if (current.exists) revert BatchAlreadyExists();
        } else {
            if (!current.exists || current.version + 1 != version) {
                revert InvalidBatchVersion();
            }
        }

        BatchRecord memory newRecord = BatchRecord({
            root: batchRoot,
            version: version,
            endorsedBy: msg.sender,
            endorsedAt: block.timestamp,
            exists: true
        });

        batches[key][batchId] = newRecord;
        batchVersions[key][batchId][version] = newRecord;
        batchesByRoot[key][batchRoot] = newRecord;

        emit BatchRootEndorsed(key, institutionId, batchId, version, batchRoot, msg.sender);
    }

    /**
     * @notice Verify a real ZK-SNARK Groth16 proof of contribution membership and record it.
     * @dev Checks statement bindings, institutional root authority, and proof validity.
     *      Idempotent for the same version and supports reproof on successor batch versions.
     */
    function verifyAndRecordReceiptProof(
        string calldata institutionId,
        uint256 batchId,
        uint256 version,
        string calldata contributionId,
        uint256 fundType,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata publicSignals
    ) external returns (bool) {
        bytes32 instKey = keccak256(bytes(institutionId));
        if (!batches[instKey][batchId].exists) revert BatchNotFound();

        // 1. Verify Statement Bindings against publicSignals (AC07)
        if (toField(instKey) != publicSignals[2]) {
            revert InvalidStatementBinding();
        }
        if (fundType != publicSignals[4]) {
            revert InvalidStatementBinding();
        }

        // 2. Verify Institutional Batch Root Authority (AC03, AC17, Issue #110)
        bytes32 rootBytes = bytes32(publicSignals[0]);
        BatchRecord memory batch = batchesByRoot[instKey][rootBytes];
        if (!batch.exists) {
            if (batches[instKey][batchId].exists && toField(batches[instKey][batchId].root) == publicSignals[0]) {
                batch = batches[instKey][batchId];
            } else {
                revert UnauthorizedBatchRoot();
            }
        }
        if (batch.version == 0 || batchId == 0) revert InvalidStatementBinding();

        if (version == 0 || toField(keccak256(abi.encode(
            "ZKT_CONTRIBUTION_MEMBERSHIP_V1", contributionId, batchId, batch.version, version
        ))) != publicSignals[3]) {
            revert InvalidStatementBinding();
        }

        // 2. Verify Cryptographic Proof via Groth16Verifier
        bool proofValid = verifier.verifyProof(a, b, c, publicSignals);
        if (!proofValid) {
            revert InvalidProof();
        }

        // 3. Idempotency & Reproof Check (AC04, AC18, Issue #110)
        bytes32 receiptKey = keccak256(abi.encode(institutionId, contributionId, version));
        VerifiedReceipt storage existing = verifiedReceipts[receiptKey];
        if (existing.isVerified) {
            if (existing.batchId == batchId && existing.batchVersion == batch.version && existing.receiptCommitment == bytes32(publicSignals[1])) {
                return true; // Idempotent duplicate
            }
            if (existing.batchId == batchId && batch.version > existing.batchVersion) {
                // Valid reproof on successor batch root
            } else {
                revert InvalidStatementBinding();
            }
        }

        // 4. Store Verified Receipt Record Persistently
        verifiedReceipts[receiptKey] = VerifiedReceipt({
            isVerified: true,
            batchId: batchId,
            batchVersion: batch.version,
            version: version,
            batchRoot: batch.root,
            receiptCommitment: bytes32(publicSignals[1]),
            verifiedAt: block.timestamp,
            blockNumber: block.number,
            submitter: msg.sender
        });

        emit ReceiptProofVerified(
            receiptKey,
            institutionId,
            contributionId,
            batchId,
            version,
            batch.root,
            bytes32(publicSignals[1]),
            msg.sender
        );

        return true;
    }

    /**
     * @notice Read receipt verification status without gas or transactions (AC05, AC18).
     */
    function getReceiptVerification(
        string calldata institutionId,
        string calldata contributionId,
        uint256 version
    )
        external
        view
        returns (
            bool isVerified,
            uint256 batchId,
            bytes32 batchRoot,
            bytes32 receiptCommitment,
            uint256 verifiedAt,
            uint256 blockNumber
        )
    {
        bytes32 receiptKey = keccak256(abi.encode(institutionId, contributionId, version));
        VerifiedReceipt storage record = verifiedReceipts[receiptKey];
        return (
            record.isVerified,
            record.batchId,
            record.batchRoot,
            record.receiptCommitment,
            record.verifiedAt,
            record.blockNumber
        );
    }

    /**
     * @notice Read cryptographic history separately from business validity.
     * @dev UNKNOWN includes a latest root whose successor is pending or failed.
     *      No consumer may infer CURRENT from isLatestRegisteredRoot alone.
     */
    function getReceiptVerificationWithBatch(
        string calldata institutionId,
        string calldata contributionId,
        uint256 version
    )
        external
        view
        returns (
            bool isVerified,
            uint256 batchId,
            uint256 batchVersion,
            bytes32 batchRoot,
            bytes32 receiptCommitment,
            uint256 verifiedAt,
            uint256 blockNumber,
            bool isLatestRegisteredRoot,
            BusinessValidity businessValidity
        )
    {
        bytes32 receiptKey = keccak256(abi.encode(institutionId, contributionId, version));
        VerifiedReceipt storage record = verifiedReceipts[receiptKey];
        bytes32 key = keccak256(bytes(institutionId));
        bool latest = record.isVerified && batches[key][record.batchId].exists && batches[key][record.batchId].root == record.batchRoot;
        return (
            record.isVerified,
            record.batchId,
            record.batchVersion,
            record.batchRoot,
            record.receiptCommitment,
            record.verifiedAt,
            record.blockNumber,
            latest,
            record.isVerified && !latest ? BusinessValidity.SUPERSEDED : BusinessValidity.UNKNOWN
        );
    }

    /**
     * @notice Check only whether a root is the latest registered root, NOT whether it is business-current.
     * @dev Pending offchain corrections are unknowable here; check the institution source as well.
     */
    function isLatestRegisteredBatchRoot(
        string calldata institutionId,
        uint256 batchId,
        bytes32 batchRoot
    ) external view returns (bool) {
        bytes32 key = keccak256(bytes(institutionId));
        return batches[key][batchId].exists && batches[key][batchId].root == batchRoot;
    }

    /**
     * @notice Read a specific historical or current batch version record.
     */
    function getBatchVersion(
        string calldata institutionId,
        uint256 batchId,
        uint256 version
    ) external view returns (
        bytes32 root,
        uint256 ver,
        address endorsedBy,
        uint256 endorsedAt,
        bool exists
    ) {
        bytes32 key = keccak256(bytes(institutionId));
        BatchRecord storage record = batchVersions[key][batchId][version];
        return (record.root, record.version, record.endorsedBy, record.endorsedAt, record.exists);
    }
}
