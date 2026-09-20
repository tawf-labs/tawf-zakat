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

    // institutionKey => batchId => BatchRecord
    mapping(bytes32 => mapping(uint256 => BatchRecord)) public batches;

    struct VerifiedReceipt {
        bool isVerified;
        uint256 batchId;
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

        BatchRecord storage record = batches[key][batchId];
        if (record.exists) revert BatchAlreadyExists();

        record.root = batchRoot;
        record.version = version;
        record.endorsedBy = msg.sender;
        record.endorsedAt = block.timestamp;
        record.exists = true;

        emit BatchRootEndorsed(key, institutionId, batchId, version, batchRoot, msg.sender);
    }

    /**
     * @notice Verify a real ZK-SNARK Groth16 proof of contribution membership and record it.
     * @dev Checks statement bindings, institutional root authority, and proof validity.
     *      Idempotent: if already verified for (institutionId, contributionId, version), records once.
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
        BatchRecord storage batch = batches[instKey][batchId];
        if (!batch.exists) revert BatchNotFound();

        // 1. Verify Statement Bindings against publicSignals
        // publicSignals[0] = batchRoot (field representation)
        // publicSignals[1] = receiptCommitment (field representation)
        // publicSignals[2] = institutionKey (field)
        // publicSignals[3] = domain-separated receipt + batch + batch version + receipt version context (field)
        // publicSignals[4] = fundType (field)

        if (toField(instKey) != publicSignals[2]) {
            revert InvalidStatementBinding();
        }
        if (version == 0 || toField(keccak256(abi.encode(
            "ZKT_CONTRIBUTION_MEMBERSHIP_V1", contributionId, batchId, batch.version, version
        ))) != publicSignals[3]) {
            revert InvalidStatementBinding();
        }
        if (fundType != publicSignals[4]) {
            revert InvalidStatementBinding();
        }

        // 2. Verify Institutional Batch Root Authority (AC03, AC17)
        if (toField(batch.root) != publicSignals[0]) {
            revert UnauthorizedBatchRoot();
        }

        // 4. Verify Cryptographic Proof via Groth16Verifier
        bool proofValid = verifier.verifyProof(a, b, c, publicSignals);
        if (!proofValid) {
            revert InvalidProof();
        }

        // 3. Idempotency Check (AC04, AC18)
        bytes32 receiptKey = keccak256(abi.encode(institutionId, contributionId, version));
        if (verifiedReceipts[receiptKey].isVerified) {
            if (verifiedReceipts[receiptKey].batchId != batchId || verifiedReceipts[receiptKey].receiptCommitment != bytes32(publicSignals[1])) revert InvalidStatementBinding();
            return true; // Already verified, no duplicate transaction or state mutation
        }

        // 5. Store Verified Receipt Record Persistently
        verifiedReceipts[receiptKey] = VerifiedReceipt({
            isVerified: true,
            batchId: batchId,
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
}
