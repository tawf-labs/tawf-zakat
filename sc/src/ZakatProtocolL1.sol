// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ZakatProtocolL1
 * @notice Zakat Transparency & Anti-Corruption Protocol on EVM L1.
 * @dev Enforces multi-unit ledger (Fiat IDR accounting & USDC real custody)
 *      with 12.5% max Amil invariant lock and on-chain 2-of-3 Multi-Sig governance.
 */
contract ZakatProtocolL1 is AccessControl {
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

    constructor(
        address _usdcAddress,
        address _admin,
        address _relayer,
        address _dps,
        address _auditor
    ) {
        require(_usdcAddress != address(0), "Invalid USDC address");
        require(_admin != address(0), "Invalid admin address");
        require(_relayer != address(0), "Invalid relayer address");
        require(_dps != address(0), "Invalid DPS address");
        require(_auditor != address(0), "Invalid auditor address");

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
        require(fiatBatchRoots[_batchId] == bytes32(0), "Batch already settled");
        require(_merkleRoot != bytes32(0), "Invalid Merkle root");
        require(_totalBatchAmountIDR > 0, "Batch amount must be > 0");

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
        require(_amountUSDC > 0, "Amount must be > 0");
        require(usdcToken.transferFrom(msg.sender, address(this), _amountUSDC), "USDC Transfer failed");

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
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(RELAYER_ROLE, msg.sender), "Not authorized to propose");
        require(!hasReceivedZakat[_beneficiaryHash][_periodId], "Double claim detected for beneficiary");
        require(_amount > 0, "Amount must be > 0");

        if (_currencyType == 0) {
            require(_amount <= mustahikVaultIDR, "Insufficient IDR vault balance");
        } else if (_currencyType == 1) {
            require(_amount <= mustahikVaultUSDC, "Insufficient USDC vault balance");
            require(_usdcRecipient != address(0), "Invalid recipient address");
        } else {
            revert("Invalid currency type");
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
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender) ||
            hasRole(SHARIA_SUPERVISOR_ROLE, msg.sender) ||
            hasRole(AUDITOR_ROLE, msg.sender),
            "Not an authorized signatory"
        );

        DisbursementProposal storage proposal = proposals[_proposalId];
        require(proposal.proposalId != 0, "Proposal does not exist");
        require(proposal.status == ProposalStatus.Pending, "Proposal is not pending");
        require(!hasApprovedProposal[_proposalId][msg.sender], "Already approved by this address");

        hasApprovedProposal[_proposalId][msg.sender] = true;
        proposal.approvalCount++;

        emit DisbursementApproved(_proposalId, msg.sender, proposal.approvalCount);

        if (proposal.approvalCount >= REQUIRED_APPROVALS) {
            proposal.status = ProposalStatus.Approved;
        }
    }

    function executeDisbursement(uint256 _proposalId) external {
        DisbursementProposal storage proposal = proposals[_proposalId];
        require(proposal.proposalId != 0, "Proposal does not exist");
        require(proposal.status == ProposalStatus.Approved || proposal.approvalCount >= REQUIRED_APPROVALS, "Quorum not met");
        require(proposal.status != ProposalStatus.Executed, "Already executed");
        require(!hasReceivedZakat[proposal.beneficiaryHash][proposal.periodId], "Double claim detected");

        if (proposal.currencyType == 0) {
            require(proposal.amount <= mustahikVaultIDR, "Insufficient IDR vault");
            mustahikVaultIDR -= proposal.amount;
            totalDisbursedIDR += proposal.amount;
        } else if (proposal.currencyType == 1) {
            require(proposal.amount <= mustahikVaultUSDC, "Insufficient USDC vault");
            mustahikVaultUSDC -= proposal.amount;
            totalDisbursedUSDC += proposal.amount;
            require(usdcToken.transfer(proposal.usdcRecipient, proposal.amount), "USDC transfer failed");
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
}
