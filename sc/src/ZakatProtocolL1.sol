// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ZakatProtocolL1
 * @notice Zakat Transparency & Anti-Corruption Protocol on EVM L1.
 * @dev Enforces multi-unit ledger (Fiat IDR accounting & USDC real custody)
 *      with 12.5% max Amil invariant lock and on-chain 2-of-3 Multi-Sig governance.
 */
contract ZakatProtocolL1 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- CUSTOM ERRORS ---
    error InvalidAddress();
    error InvalidCurrencyType();
    error ZeroAmount();
    error BatchAlreadySettled();
    error InvalidMerkleRoot();
    error InsufficientVaultBalance();
    error InsufficientAmilTreasury();
    error DoubleClaimDetected();
    error ProposalNotFound();
    error ProposalNotPending();
    error AlreadyApproved();
    error QuorumNotMet();
    error AlreadyExecuted();
    error Unauthorized();

    // --- ROLES ---
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");
    bytes32 public constant SHARIA_SUPERVISOR_ROLE = keccak256("SHARIA_SUPERVISOR_ROLE");

    uint256 public constant MAX_AMIL_BPS = 1250; // 12.5% (Basis Points / 10000)
    uint256 public constant REQUIRED_APPROVALS = 2; // 2-of-3 Multi-Sig Quorum

    IERC20 public immutable usdcToken;

    // --- FIAT LEDGER (Accounting Invariant in IDR) ---
    uint256 public totalCollectedIDR;
    uint256 public mustahikVaultIDR;
    uint256 public amilTreasuryIDR;
    uint256 public totalDisbursedIDR;

    // --- USDC VAULT (Real Custody Tokens) ---
    uint256 public totalCollectedUSDC;
    uint256 public mustahikVaultUSDC;
    uint256 public amilTreasuryUSDC;
    uint256 public totalDisbursedUSDC;

    // Batch Settlement: batchId => merkleRoot
    mapping(uint256 => bytes32) public fiatBatchRoots;

    // Anti-Double Claim: beneficiaryHash => (periodId => isClaimed)
    mapping(bytes32 => mapping(uint256 => bool)) public hasReceivedZakat;

    // Proposal Struct
    enum ProposalStatus { Pending, Approved, Executed, Cancelled }

    struct DisbursementProposal {
        uint256 proposalId;
        uint8 currencyType; // 0 = IDR, 1 = USDC
        uint256 amount;
        uint8 asnafCategory;
        bytes32 beneficiaryHash;
        string ipfsProofCID;
        uint256 periodId;
        address usdcRecipient;
        uint256 approvalCount;
        ProposalStatus status;
    }

    uint256 public proposalCounter;
    mapping(uint256 => DisbursementProposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasApprovedProposal;

    // Events
    event FiatBatchSettled(uint256 indexed batchId, bytes32 merkleRoot, uint256 totalAmountIDR);
    event USDCDeposited(address indexed donor, uint256 amountUSDC, bool isAnonymous, bytes32 commitmentHash);
    event DisbursementProposed(uint256 indexed proposalId, uint8 currencyType, uint256 amount, bytes32 beneficiaryHash, string ipfsProofCID);
    event DisbursementApproved(uint256 indexed proposalId, address indexed approver, uint256 currentApprovals);
    event DisbursementExecuted(uint256 indexed proposalId, uint8 currencyType, uint256 amount, bytes32 beneficiaryHash, string ipfsProofCID);
    event DisbursementCancelled(uint256 indexed proposalId, address indexed canceller, string reason);
    event AmilShareWithdrawn(address indexed to, uint256 amount);

    constructor(
        address _usdcAddress,
        address _admin,
        address _relayer,
        address _dps,
        address _auditor
    ) {
        if (_usdcAddress == address(0) || _admin == address(0) || _relayer == address(0) || _dps == address(0) || _auditor == address(0)) {
            revert InvalidAddress();
        }

        usdcToken = IERC20(_usdcAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _relayer);
        _grantRole(SHARIA_SUPERVISOR_ROLE, _dps);
        _grantRole(AUDITOR_ROLE, _auditor);
    }

    // --- INFLOW: FIAT BATCH SETTLEMENT ---
    function recordFiatBatchSettlement(
        uint256 _batchId,
        bytes32 _merkleRoot,
        uint256 _totalBatchAmountIDR
    ) external onlyRole(RELAYER_ROLE) {
        if (fiatBatchRoots[_batchId] != bytes32(0)) revert BatchAlreadySettled();
        if (_merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (_totalBatchAmountIDR == 0) revert ZeroAmount();

        uint256 amilShare = (_totalBatchAmountIDR * MAX_AMIL_BPS) / 10000;
        uint256 mustahikShare = _totalBatchAmountIDR - amilShare;

        fiatBatchRoots[_batchId] = _merkleRoot;
        totalCollectedIDR += _totalBatchAmountIDR;
        amilTreasuryIDR += amilShare;
        mustahikVaultIDR += mustahikShare;

        emit FiatBatchSettled(_batchId, _merkleRoot, _totalBatchAmountIDR);
    }

    // --- INFLOW: DIRECT USDC DEPOSIT ---
    function depositUSDC(
        uint256 _amountUSDC,
        bool _isAnonymous,
        bytes32 _anonymousCommitment
    ) external {
        if (_amountUSDC == 0) revert ZeroAmount();

        usdcToken.safeTransferFrom(msg.sender, address(this), _amountUSDC);

        uint256 amilShare = (_amountUSDC * MAX_AMIL_BPS) / 10000;
        uint256 mustahikShare = _amountUSDC - amilShare;

        totalCollectedUSDC += _amountUSDC;
        amilTreasuryUSDC += amilShare;
        mustahikVaultUSDC += mustahikShare;

        emit USDCDeposited(
            _isAnonymous ? address(0) : msg.sender,
            _amountUSDC,
            _isAnonymous,
            _anonymousCommitment
        );
    }

    // --- OUTFLOW: 2-OF-3 MULTISIG PROPOSAL & EXECUTION ---
    function proposeDisbursement(
        uint8 _currencyType,
        uint256 _amount,
        uint8 _asnafCategory,
        bytes32 _beneficiaryHash,
        string calldata _ipfsProofCID,
        uint256 _periodId,
        address _usdcRecipient
    ) external returns (uint256 proposalId) {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(RELAYER_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        if (hasReceivedZakat[_beneficiaryHash][_periodId]) revert DoubleClaimDetected();
        if (_amount == 0) revert ZeroAmount();

        if (_currencyType == 0) {
            if (_amount > mustahikVaultIDR) revert InsufficientVaultBalance();
        } else if (_currencyType == 1) {
            if (_amount > mustahikVaultUSDC) revert InsufficientVaultBalance();
            if (_usdcRecipient == address(0)) revert InvalidAddress();
        } else {
            revert InvalidCurrencyType();
        }

        proposalId = ++proposalCounter;
        proposals[proposalId] = DisbursementProposal({
            proposalId: proposalId,
            currencyType: _currencyType,
            amount: _amount,
            asnafCategory: _asnafCategory,
            beneficiaryHash: _beneficiaryHash,
            ipfsProofCID: _ipfsProofCID,
            periodId: _periodId,
            usdcRecipient: _usdcRecipient,
            approvalCount: 1,
            status: ProposalStatus.Pending
        });

        hasApprovedProposal[proposalId][msg.sender] = true;

        emit DisbursementProposed(proposalId, _currencyType, _amount, _beneficiaryHash, _ipfsProofCID);
        emit DisbursementApproved(proposalId, msg.sender, 1);
    }

    function approveDisbursement(uint256 _proposalId) external {
        if (
            !hasRole(DEFAULT_ADMIN_ROLE, msg.sender) &&
            !hasRole(SHARIA_SUPERVISOR_ROLE, msg.sender) &&
            !hasRole(AUDITOR_ROLE, msg.sender)
        ) {
            revert Unauthorized();
        }

        DisbursementProposal storage proposal = proposals[_proposalId];
        if (proposal.proposalId == 0) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.Pending) revert ProposalNotPending();
        if (hasApprovedProposal[_proposalId][msg.sender]) revert AlreadyApproved();

        hasApprovedProposal[_proposalId][msg.sender] = true;
        proposal.approvalCount++;

        emit DisbursementApproved(_proposalId, msg.sender, proposal.approvalCount);

        if (proposal.approvalCount >= REQUIRED_APPROVALS) {
            proposal.status = ProposalStatus.Approved;
        }
    }

    function cancelProposal(uint256 _proposalId, string calldata _reason) external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(SHARIA_SUPERVISOR_ROLE, msg.sender)) {
            revert Unauthorized();
        }

        DisbursementProposal storage proposal = proposals[_proposalId];
        if (proposal.proposalId == 0) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.Pending) revert ProposalNotPending();

        proposal.status = ProposalStatus.Cancelled;

        emit DisbursementCancelled(_proposalId, msg.sender, _reason);
    }

    function executeDisbursement(uint256 _proposalId) external nonReentrant {
        DisbursementProposal storage proposal = proposals[_proposalId];
        if (proposal.proposalId == 0) revert ProposalNotFound();
        if (proposal.status != ProposalStatus.Approved && proposal.approvalCount < REQUIRED_APPROVALS) {
            revert QuorumNotMet();
        }
        if (proposal.status == ProposalStatus.Executed) revert AlreadyExecuted();
        if (hasReceivedZakat[proposal.beneficiaryHash][proposal.periodId]) revert DoubleClaimDetected();

        if (proposal.currencyType == 0) {
            if (proposal.amount > mustahikVaultIDR) revert InsufficientVaultBalance();
            mustahikVaultIDR -= proposal.amount;
            totalDisbursedIDR += proposal.amount;
        } else if (proposal.currencyType == 1) {
            if (proposal.amount > mustahikVaultUSDC) revert InsufficientVaultBalance();
            mustahikVaultUSDC -= proposal.amount;
            totalDisbursedUSDC += proposal.amount;
            usdcToken.safeTransfer(proposal.usdcRecipient, proposal.amount);
        }

        hasReceivedZakat[proposal.beneficiaryHash][proposal.periodId] = true;
        proposal.status = ProposalStatus.Executed;

        emit DisbursementExecuted(
            _proposalId,
            proposal.currencyType,
            proposal.amount,
            proposal.beneficiaryHash,
            proposal.ipfsProofCID
        );
    }

    // --- AMIL OPERATIONAL TREASURY WITHDRAWAL ---
    function withdrawAmilShareUSDC(address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (_to == address(0)) revert InvalidAddress();
        if (_amount == 0) revert ZeroAmount();
        if (_amount > amilTreasuryUSDC) revert InsufficientAmilTreasury();

        amilTreasuryUSDC -= _amount;
        usdcToken.safeTransfer(_to, _amount);

        emit AmilShareWithdrawn(_to, _amount);
    }
}
