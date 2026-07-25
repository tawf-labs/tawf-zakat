// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.31;
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@tawf-gov/governance/ProposalManager.sol";
import "@tawf-gov/governance/VotingManager.sol";
import "./core/ShariaReviewManager.sol";
import "@tawf-gov/protocol/PoolManager.sol";
import "@tawf-gov/protocol/ZakatEscrowManager.sol";
import "./core/PrivateDonationPool.sol";
import "@tawf-gov/governance/MilestoneManager.sol";
import "@tawf-gov/governance/ParticipationTracker.sol";
import "./verifiers/Groth16Verifier.sol";
import "./verifiers/HonkVerifier.sol";
import "./NullifierRegistry.sol";
import "@tawf-gov/tokens/MockIDRX.sol";
import "@tawf-gov/protocol/DonationReceiptNFT.sol";
import "@tawf-gov/tokens/VotingNFT.sol";
// OrganizerNFT removed — use TawfPassport

/**
 * @title ZKTCore
 * @notice Orchestrator contract for the modular ZKT DAO system
 * @dev Deploys and coordinates: ProposalManager, VotingManager, ShariaReviewManager, PoolManager, ZakatEscrowManager, MilestoneManager
 * Uses VotingNFT (non-transferable ERC721) for tiered community voting power
 * Uses OrganizerNFT (non-transferable ERC721) for KYC'd organizer status
 * Routes ZakatCompliant campaigns to ZakatEscrowManager (with 30-day timeout)
 * Routes Normal campaigns to PoolManager (no timeout restrictions)
 * Routes Emergency campaigns to ZakatEscrowManager with expedited flow
 */
contract ZKTCore is AccessControl {
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    bytes32 public constant KYC_ORACLE_ROLE = keccak256("KYC_ORACLE_ROLE");
    bytes32 public constant SHARIA_COUNCIL_ROLE = keccak256("SHARIA_COUNCIL_ROLE");

    ProposalManager public proposalManager;
    VotingManager public votingManager;
    ShariaReviewManager public shariaReviewManager;
    PoolManager public poolManager;
    ZakatEscrowManager public zakatEscrowManager;
    PrivateDonationPool public privateDonationPool;
    MilestoneManager public milestoneManager;
    ParticipationTracker public participationTracker;

    MockIDRX public idrxToken;
    DonationReceiptNFT public receiptNFT;
    VotingNFT public votingNFT;
    // OrganizerNFT removed — use TawfPassport(PassportType.Organization)
    IHonkVerifier public honkVerifier;
    NullifierRegistry public nullifierRegistry;
    
    constructor(
        address _idrxToken,
        address _receiptNFT,
        address _votingNFT,
        address _participationTracker,
        address _proposalManager,
        address _votingManager,
        address _shariaReviewManager,
        address _poolManager,
        address _zakatEscrowManager,
        address _milestoneManager,
        address _honkVerifier,
        address _nullifierRegistry,
        address _privateDonationPool
    ) {
        require(_idrxToken != address(0), "Invalid IDRX token");
        require(_receiptNFT != address(0), "Invalid receipt NFT");
        require(_votingNFT != address(0), "Invalid Voting NFT");
        require(_participationTracker != address(0), "Invalid ParticipationTracker");
        require(_proposalManager != address(0), "Invalid ProposalManager");
        require(_votingManager != address(0), "Invalid VotingManager");
        require(_shariaReviewManager != address(0), "Invalid ShariaReviewManager");
        require(_poolManager != address(0), "Invalid PoolManager");
        require(_zakatEscrowManager != address(0), "Invalid ZakatEscrowManager");
        require(_milestoneManager != address(0), "Invalid MilestoneManager");
        require(_honkVerifier != address(0), "Invalid HonkVerifier");
        require(_nullifierRegistry != address(0), "Invalid NullifierRegistry");
        require(_privateDonationPool != address(0), "Invalid PrivateDonationPool");

        idrxToken = MockIDRX(_idrxToken);
        receiptNFT = DonationReceiptNFT(_receiptNFT);
        votingNFT = VotingNFT(_votingNFT);
        // organizerNFT removed — use TawfPassport
        participationTracker = ParticipationTracker(_participationTracker);

        proposalManager = ProposalManager(_proposalManager);
        votingManager = VotingManager(_votingManager);
        shariaReviewManager = ShariaReviewManager(_shariaReviewManager);
        poolManager = PoolManager(_poolManager);
        zakatEscrowManager = ZakatEscrowManager(_zakatEscrowManager);
        milestoneManager = MilestoneManager(_milestoneManager);
        honkVerifier = IHonkVerifier(_honkVerifier);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);
        privateDonationPool = PrivateDonationPool(_privateDonationPool);

        // Setup deployer as DEFAULT_ADMIN_ROLE to grant initial roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    
    // ============ Role Management Helpers ============

    function grantOrganizerRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(ORGANIZER_ROLE, account);
    }

    function grantVotingNFT(address account, string memory metadataURI) external {
        // Permissionless - anyone can request a voting NFT (in production, add faucet-style rate limits)
        votingNFT.mintVotingNFT(account, metadataURI);
    }

    function verifyVoter(address voter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        votingNFT.verifyVoter(voter);
        participationTracker.setVerification(voter, true);
    }
    
    function grantShariaCouncilRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(SHARIA_COUNCIL_ROLE, account);
    }
    
    function grantKYCOracleRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(KYC_ORACLE_ROLE, account);
    }

    // ============ Organizer Application Flow ============

    /// @notice Organizer application counter
    uint256 public organizerApplicationCount;

    /// @notice Organizer application storage
    mapping(uint256 => IProposalManager.OrganizerApplication) public organizerApplications;

    /// @notice Mapping from applicant to their application ID
    mapping(address => uint256) public applicantToApplicationId;

    event OrganizerApplicationSubmitted(
        uint256 indexed applicationId,
        address indexed applicant,
        string organizationName,
        string description
    );
    event OrganizerApplicationKYCUpdated(
        uint256 indexed applicationId,
        address indexed applicant,
        IProposalManager.KYCStatus status,
        string notes
    );
    event OrganizerApplicationVoteStarted(
        uint256 indexed applicationId,
        uint256 voteStart,
        uint256 voteEnd
    );
    event OrganizerApplicationFinalized(
        uint256 indexed applicationId,
        address indexed applicant,
        bool approved
    );

    /**
     * @notice Submit an application to become an organizer
     * @param organizationName Name of the organization
     * @param description Description of the organization
     * @param metadataURI IPFS URI with full org details, documents
     * @return applicationId The application ID
     */
    function proposeOrganizer(
        string memory organizationName,
        string memory description,
        string memory metadataURI
    )
        external
        returns (uint256)
    {
        require(bytes(organizationName).length > 0, "Organization name required");
        require(applicantToApplicationId[msg.sender] == 0, "Already have an application");

        organizerApplicationCount++;
        uint256 applicationId = organizerApplicationCount;

        organizerApplications[applicationId] = IProposalManager.OrganizerApplication({
            applicationId: applicationId,
            applicant: msg.sender,
            organizationName: organizationName,
            description: description,
            metadataURI: metadataURI,
            status: IProposalManager.OrganizerApplicationStatus.Pending,
            kycStatus: IProposalManager.KYCStatus.Pending,
            appliedAt: block.timestamp,
            voteStart: 0,
            voteEnd: 0,
            votesFor: 0,
            votesAgainst: 0,
            votesAbstain: 0,
            notes: "Application submitted"
        });

        applicantToApplicationId[msg.sender] = applicationId;

        emit OrganizerApplicationSubmitted(applicationId, msg.sender, organizationName, description);

        return applicationId;
    }

    /**
     * @notice Update KYC status for organizer application (KYC Oracle only)
     * @param applicationId Application ID
     * @param newStatus New KYC status
     * @param notes Notes about the status change
     */
    function updateOrganizerKYC(
        uint256 applicationId,
        IProposalManager.KYCStatus newStatus,
        string memory notes
    )
        external
        onlyRole(KYC_ORACLE_ROLE)
    {
        require(applicationId > 0 && applicationId <= organizerApplicationCount, "Invalid application ID");

        IProposalManager.OrganizerApplication storage application = organizerApplications[applicationId];
        application.kycStatus = newStatus;
        application.notes = notes;

        emit OrganizerApplicationKYCUpdated(applicationId, application.applicant, newStatus, notes);
    }

    /**
     * @notice Start community voting for organizer application
     * @param applicationId Application ID
     */
    function submitOrganizerApplicationForVote(uint256 applicationId) external {
        require(applicationId > 0 && applicationId <= organizerApplicationCount, "Invalid application ID");

        IProposalManager.OrganizerApplication storage application = organizerApplications[applicationId];
        require(application.applicant == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not authorized");
        require(application.status == IProposalManager.OrganizerApplicationStatus.Pending, "Invalid status");
        require(application.kycStatus == IProposalManager.KYCStatus.Verified, "KYC must be verified");

        uint256 votingPeriod = proposalManager.votingPeriod();
        application.voteStart = block.timestamp;
        application.voteEnd = block.timestamp + votingPeriod;
        application.status = IProposalManager.OrganizerApplicationStatus.CommunityVote;

        emit OrganizerApplicationVoteStarted(applicationId, application.voteStart, application.voteEnd);
    }

    /**
     * @notice Finalize organizer application (after community vote passes)
     * @param applicationId Application ID
     * @param approved Whether the application was approved
     */
    function finalizeOrganizerApplication(uint256 applicationId, bool approved)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(applicationId > 0 && applicationId <= organizerApplicationCount, "Invalid application ID");

        IProposalManager.OrganizerApplication storage application = organizerApplications[applicationId];
        require(application.status == IProposalManager.OrganizerApplicationStatus.CommunityVote, "Not in voting");
        require(block.timestamp > application.voteEnd, "Voting still active");

        application.status = approved
            ? IProposalManager.OrganizerApplicationStatus.Approved
            : IProposalManager.OrganizerApplicationStatus.Rejected;

        if (approved) {
            // TODO: Mint Organizer passport via TawfPassport + grant role
            _grantRole(ORGANIZER_ROLE, application.applicant);
        }

        emit OrganizerApplicationFinalized(applicationId, application.applicant, approved);
    }

    /**
     * @notice Get organizer application details
     * @param applicationId Application ID
     * @return application The organizer application data
     */
    function getOrganizerApplication(uint256 applicationId)
        external
        view
        returns (IProposalManager.OrganizerApplication memory)
    {
        require(applicationId > 0 && applicationId <= organizerApplicationCount, "Invalid application ID");
        return organizerApplications[applicationId];
    }

    /**
     * @notice Get application ID for an applicant
     * @param applicant Applicant address
     * @return applicationId The application ID or 0 if none
     */
    function getApplicantApplicationId(address applicant) external view returns (uint256) {
        return applicantToApplicationId[applicant];
    }
    
    // ============ Re-export Core Functions for Ease of Use ============
    
    // Proposal functions
    function createProposal(
        string memory title,
        string memory description,
        uint256 fundingGoal,
        bool isEmergency,
        bytes32 mockZKKYCProof,
        string[] memory zakatChecklistItems,
        string memory metadataURI,
        IProposalManager.MilestoneInput[] memory milestoneInputs
    ) external onlyRole(ORGANIZER_ROLE) returns (uint256) {
        return proposalManager.createProposal(
            msg.sender, // Pass actual caller as organizer
            title,
            description,
            fundingGoal,
            isEmergency,
            mockZKKYCProof,
            zakatChecklistItems,
            metadataURI,
            milestoneInputs
        );
    }
    
    function updateKYCStatus(
        uint256 proposalId,
        IProposalManager.KYCStatus newStatus,
        string memory notes
    ) external onlyRole(KYC_ORACLE_ROLE) {
        proposalManager.updateKYCStatus(proposalId, newStatus, notes);
    }
    
    function submitForCommunityVote(uint256 proposalId) external onlyRole(ORGANIZER_ROLE) {
        proposalManager.submitForCommunityVote(proposalId);
    }
    
    function cancelProposal(uint256 proposalId) external onlyRole(ORGANIZER_ROLE) {
        proposalManager.cancelProposal(proposalId);
    }
    
    // Voting functions
    function castVote(uint256 proposalId, uint8 support) external {
        votingManager.castVote(msg.sender, proposalId, support);  // Pass actual voter
    }
    
    function finalizeCommunityVote(uint256 proposalId) external {
        bool passed = votingManager.finalizeCommunityVote(proposalId);
        if (passed) {
            shariaReviewManager.checkAndCreateBundle();
        }
    }
    
    // Sharia review functions
    function checkAndCreateBundle() external {
        shariaReviewManager.checkAndCreateBundle();
    }
    
    function createShariaReviewBundle(uint256[] memory proposalIds) external onlyRole(SHARIA_COUNCIL_ROLE) returns (uint256) {
        return shariaReviewManager.createShariaReviewBundle(proposalIds);
    }
    
    function reviewProposal(
        uint256 bundleId,
        uint256 proposalId,
        bool approved,
        IProposalManager.CampaignType campaignType,
        bytes32 mockZKReviewProof
    ) external onlyRole(SHARIA_COUNCIL_ROLE) {
        shariaReviewManager.reviewProposal(msg.sender, bundleId, proposalId, approved, campaignType, mockZKReviewProof);
    }
    
    function finalizeShariaBundle(uint256 bundleId) external onlyRole(SHARIA_COUNCIL_ROLE) {
        shariaReviewManager.finalizeShariaBundle(bundleId);
    }

    // ============ ZK Proof Functions ============

    /**
     * @notice Submit a ZK proof for Sharia council approval
     * @dev RESTRICTED to SHARIA_COUNCIL_ROLE. This gate is load-bearing: ZKTCore
     *      itself holds SHARIA_COUNCIL_ROLE on ShariaReviewManager (granted in
     *      V10Deploy), so leaving this open would make ZKTCore a bypass around
     *      the manager's own role check.
     * @param bundleId Bundle being reviewed
     * @param proposalId Proposal being reviewed
     * @param approvalCount Number of approve votes
     * @param campaignType Type of campaign
     * @param proof Groth16 proof structure
     * @return success True if proof was verified and accepted
     */
    function submitShariaReviewProof(
        uint256 bundleId,
        uint256 proposalId,
        uint256 approvalCount,
        IProposalManager.CampaignType campaignType,
        Groth16Proof calldata proof
    ) external onlyRole(SHARIA_COUNCIL_ROLE) returns (bool success) {
        return shariaReviewManager.submitShariaReviewProof(
            bundleId,
            proposalId,
            approvalCount,
            campaignType,
            proof
        );
    }

    /**
     * @notice Batch submit ZK proofs for multiple proposals
     * @param bundleId Bundle being reviewed
     * @param proposalIds Array of proposal IDs
     * @param approvalCounts Array of approval counts
     * @param campaignTypes Array of campaign types
     * @param proofs Array of Groth16 proofs
     * @return successCount Number of successfully verified proofs
     * @dev RESTRICTED to SHARIA_COUNCIL_ROLE — see submitShariaReviewProof.
     */
    function batchSubmitShariaReviewProofs(
        uint256 bundleId,
        uint256[] calldata proposalIds,
        uint256[] calldata approvalCounts,
        IProposalManager.CampaignType[] calldata campaignTypes,
        Groth16Proof[] calldata proofs
    ) external onlyRole(SHARIA_COUNCIL_ROLE) returns (uint256 successCount) {
        return shariaReviewManager.batchSubmitShariaReviewProofs(
            bundleId,
            proposalIds,
            approvalCounts,
            campaignTypes,
            proofs
        );
    }

    /**
     * @notice Set the council Merkle root (admin only)
     * @param newRoot New Merkle root of council membership
     */
    function setCouncilMerkleRoot(uint256 newRoot) external onlyRole(DEFAULT_ADMIN_ROLE) {
        shariaReviewManager.setCouncilMerkleRoot(newRoot);
    }

    /**
     * @notice Set the nullifier Merkle root (admin only)
     * @param newRoot New Merkle root of nullifiers
     */
    function setNullifierMerkleRoot(uint256 newRoot) external onlyRole(DEFAULT_ADMIN_ROLE) {
        shariaReviewManager.setNullifierMerkleRoot(newRoot);
    }

    /**
     * @notice Check if a proposal has a verified ZK proof
     * @param bundleId Bundle ID
     * @param proposalId Proposal ID
     * @return verified True if proof has been verified
     */
    function hasVerifiedProof(uint256 bundleId, uint256 proposalId)
        external
        view
        returns (bool verified)
    {
        return shariaReviewManager.hasVerifiedProof(bundleId, proposalId);
    }

    /**
     * @notice Get the approval count from a verified ZK proof
     * @param bundleId Bundle ID
     * @param proposalId Proposal ID
     * @return count Approval count from ZK proof
     */
    function getProofApprovalCount(uint256 bundleId, uint256 proposalId)
        external
        view
        returns (uint256 count)
    {
        return shariaReviewManager.getProofApprovalCount(bundleId, proposalId);
    }

    // Pool functions

    /**
     * @notice Internal function to create campaign pool with routing
     * @dev Routes to ZakatEscrowManager for Zakat campaigns, PoolManager for Normal campaigns
     */
    function _createCampaignPoolInternal(
        uint256 proposalId,
        address fallbackPool
    ) internal returns (uint256) {
        IProposalManager.Proposal memory proposal = proposalManager.getProposal(proposalId);
        require(msg.sender == proposal.organizer, "Only proposal organizer");
        require(proposal.status == IProposalManager.ProposalStatus.ShariaApproved, "Not Sharia approved");

        // Route based on campaign type
        if (proposal.campaignType == IProposalManager.CampaignType.ZakatCompliant) {
            // Zakat campaigns go to ZakatEscrowManager with timeout enforcement
            return zakatEscrowManager.createZakatPool(proposalId, fallbackPool);
        } else {
            // Normal campaigns go to PoolManager without timeout
            return poolManager.createCampaignPool(proposalId);
        }
    }

    /**
     * @notice Create campaign pool with automatic routing based on campaign type
     * @dev ZakatCompliant campaigns route to ZakatEscrowManager (30-day timeout)
     *      Normal campaigns route to PoolManager (no timeout)
     * @param proposalId Approved proposal ID
     * @param fallbackPool Fallback pool for Zakat redistribution (ignored for Normal campaigns)
     * @return poolId Created pool ID
     */
    function createCampaignPool(uint256 proposalId, address fallbackPool) external returns (uint256) {
        return _createCampaignPoolInternal(proposalId, fallbackPool);
    }

    /**
     * @notice Create campaign pool (legacy compatibility - uses default fallback for Zakat)
     */
    function createCampaignPool(uint256 proposalId) external returns (uint256) {
        return _createCampaignPoolInternal(proposalId, address(0));
    }

    /**
     * @notice Donate to a campaign pool
     */
    function donate(uint256 poolId, uint256 amount, string memory ipfsCID) external {
        // Route to appropriate manager based on pool existence
        // Try ZakatEscrowManager first, then fallback to PoolManager
        try zakatEscrowManager.donate(msg.sender, poolId, amount, ipfsCID) {
            return; // Success - was a Zakat pool
        } catch {
            // Fallback to PoolManager
            poolManager.donate(msg.sender, poolId, amount, ipfsCID);
        }
    }

    /**
     * @notice Make a private donation using Pedersen commitment
     */
    function donatePrivate(uint256 poolId, uint256 amount, bytes32 commitment, string memory ipfsCID) external {
        // Route to appropriate manager based on pool existence
        try zakatEscrowManager.donatePrivate(msg.sender, poolId, amount, commitment, ipfsCID) {
            return; // Success - was a Zakat pool
        } catch {
            // Fallback to PoolManager
            poolManager.donatePrivate(msg.sender, poolId, amount, commitment, ipfsCID);
        }
    }

    /**
     * @notice Make a ZK-private donation with UltraHONK proof verification
     * @param poolId Pool receiving the donation
     * @param amount Donation amount in IDRX tokens
     * @param proof UltraHONK proof bytes (msgpack, ~8KB)
     * @param publicInputs Public inputs from circuit (nisab_threshold, current_time,
     *        recipient_address, cycle_id, expected_nullifier, + padding)
     * @param nullifier The nullifier from the proof (checked on-chain)
     * @param ipfsCID IPFS CID for the donation receipt
     */
    function donateZK(
        uint256 poolId,
        uint256 amount,
        bytes calldata proof,
        bytes32[] calldata publicInputs,
        bytes32 nullifier,
        string calldata ipfsCID
    ) external {
        require(honkVerifier.verify(proof, publicInputs), "Invalid ZK proof");

        nullifierRegistry.spend(nullifier);

        try zakatEscrowManager.donate(msg.sender, poolId, amount, ipfsCID) {
            emit ZKDonationReceived(poolId, nullifier, amount, msg.sender);
            return;
        } catch {
            poolManager.donate(msg.sender, poolId, amount, ipfsCID);
            emit ZKDonationReceived(poolId, nullifier, amount, msg.sender);
        }
    }

    /**
     * @notice Emitted when a ZK-verified private donation is received
     */
    event ZKDonationReceived(
        uint256 indexed poolId,
        bytes32 indexed nullifier,
        uint256 amount,
        address indexed donor
    );

    function donateZKPrivate(
        uint256 poolId,
        uint256 amount,
        bytes calldata proof,
        bytes32[] calldata publicInputs,
        bytes32 nullifier
    ) external {
        require(honkVerifier.verify(proof, publicInputs), "Invalid ZK proof");
        nullifierRegistry.spend(nullifier);
        privateDonationPool.donatePrivately(msg.sender, poolId, amount, nullifier, publicInputs[6]);
    }

    /**
     * @notice Withdraw funds from campaign pool
     */
    function withdrawFunds(uint256 poolId) external {
        // Route to appropriate manager based on pool existence
        try zakatEscrowManager.withdrawFunds(msg.sender, poolId) {
            return; // Success - was a Zakat pool
        } catch {
            // Fallback to PoolManager
            poolManager.withdrawFunds(msg.sender, poolId);
        }
    }

    // ============ Milestone Functions ============

    /**
     * @notice Submit proof document for milestone completion
     * @param proposalId Proposal ID containing the milestone
     * @param milestoneId Index of the milestone
     * @param ipfsCID IPFS CID of the proof document
     */
    function submitMilestoneProof(uint256 proposalId, uint256 milestoneId, string memory ipfsCID)
        external
        onlyRole(ORGANIZER_ROLE)
    {
        milestoneManager.submitMilestoneProof(msg.sender, proposalId, milestoneId, ipfsCID);
    }

    /**
     * @notice Start voting period for milestone approval
     * @param proposalId Proposal ID containing the milestone
     * @param milestoneId Index of the milestone
     */
    function startMilestoneVoting(uint256 proposalId, uint256 milestoneId) external {
        milestoneManager.startMilestoneVoting(proposalId, milestoneId);
    }

    /**
     * @notice Cast vote on milestone completion
     * @param proposalId Proposal ID containing the milestone
     * @param milestoneId Index of the milestone
     * @param support Vote type: 0 = Against, 1 = For, 2 = Abstain
     */
    function voteMilestone(uint256 proposalId, uint256 milestoneId, uint8 support) external {
        milestoneManager.voteMilestone(msg.sender, proposalId, milestoneId, support);
    }

    /**
     * @notice Finalize milestone vote and determine approval
     * @param proposalId Proposal ID containing the milestone
     * @param milestoneId Index of the milestone
     */
    function finalizeMilestoneVote(uint256 proposalId, uint256 milestoneId) external {
        milestoneManager.finalizeMilestoneVote(proposalId, milestoneId);
    }

    /**
     * @notice Withdraw funds for an approved milestone
     * @param poolId Campaign pool ID
     * @param milestoneId Milestone index to withdraw funds for
     */
    function withdrawMilestoneFunds(uint256 poolId, uint256 milestoneId) external {
        poolManager.withdrawMilestoneFunds(msg.sender, poolId, milestoneId);
    }

    // ============ Zakat-Specific Functions ============

    /**
     * @notice Check timeout status of a Zakat pool
     */
    function checkZakatTimeout(uint256 poolId) external {
        zakatEscrowManager.checkTimeout(poolId);
    }

    /**
     * @notice Sharia council grants extension to Zakat pool deadline
     */
    function councilExtendZakatDeadline(uint256 poolId, string memory reasoning)
        external
        onlyRole(SHARIA_COUNCIL_ROLE)
    {
        zakatEscrowManager.councilExtendDeadline(poolId, reasoning);
    }

    /**
     * @notice Execute redistribution to fallback pool
     */
    function executeZakatRedistribution(uint256 poolId) external {
        zakatEscrowManager.executeRedistribution(poolId);
    }

    /**
     * @notice Propose a fallback pool for Zakat redistribution
     */
    function proposeFallbackPool(address pool, string memory reasoning) external {
        zakatEscrowManager.proposeFallbackPool(pool, reasoning);
    }

    /**
     * @notice Sharia council approves a proposed fallback pool
     */
    function vetFallbackPool(address pool) external onlyRole(SHARIA_COUNCIL_ROLE) {
        zakatEscrowManager.vetFallbackPool(pool);
    }

    /**
     * @notice Set default fallback pool for Zakat redistribution
     */
    function setDefaultFallbackPool(address pool) external {
        zakatEscrowManager.setDefaultFallbackPool(pool);
    }

    // ============ Configuration Functions (DEFAULT_ADMIN_ROLE for initial setup) ============
    
    function setVotingPeriod(uint256 _votingPeriod) external onlyRole(DEFAULT_ADMIN_ROLE) {
        proposalManager.setVotingPeriod(_votingPeriod);
    }
    
    function setQuorumPercentage(uint256 _quorumPercentage) external onlyRole(DEFAULT_ADMIN_ROLE) {
        votingManager.setQuorumPercentage(_quorumPercentage);
    }
    
    function setPassThreshold(uint256 _passThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        votingManager.setPassThreshold(_passThreshold);
    }
    
    function setShariaQuorum(uint256 _quorum) external onlyRole(DEFAULT_ADMIN_ROLE) {
        shariaReviewManager.setShariaQuorum(_quorum);
    }
    
    // ============ Module Access (for advanced users) ============
    
    function getProposalManagerAddress() external view returns (address) {
        return address(proposalManager);
    }
    
    function getVotingManagerAddress() external view returns (address) {
        return address(votingManager);
    }
    
    function getShariaReviewManagerAddress() external view returns (address) {
        return address(shariaReviewManager);
    }
    
    function getPoolManagerAddress() external view returns (address) {
        return address(poolManager);
    }

    function getZakatEscrowManagerAddress() external view returns (address) {
        return address(zakatEscrowManager);
    }

    // ============ Zakat Pool View Functions ============

    /**
     * @notice Get Zakat pool details
     */
    function getZakatPool(uint256 poolId) external view returns (ZakatEscrowManager.ZakatPool memory) {
        return zakatEscrowManager.getPool(poolId);
    }

    /**
     * @notice Get time remaining for Zakat pool withdrawal
     */
    function getZakatTimeRemaining(uint256 poolId)
        external
        view
        returns (
            uint256 remaining,
            bool inGracePeriod,
            bool canRedistribute
        )
    {
        return zakatEscrowManager.getTimeRemaining(poolId);
    }

    /**
     * @notice Check if Zakat pool is ready for redistribution
     */
    function isZakatReadyForRedistribution(uint256 poolId) external view returns (bool) {
        return zakatEscrowManager.isReadyForRedistribution(poolId);
    }

    /**
     * @notice Get Zakat pool status as string
     */
    function getZakatPoolStatusString(uint256 poolId) external view returns (string memory) {
        return zakatEscrowManager.getPoolStatusString(poolId);
    }

    /**
     * @notice Get fallback pool details
     */
    function getFallbackPool(address pool) external view returns (ZakatEscrowManager.FallbackPoolData memory) {
        return zakatEscrowManager.getFallbackPool(pool);
    }

    /**
     * @notice Get all fallback pools
     */
    function getAllFallbackPools() external view returns (address[] memory) {
        return zakatEscrowManager.getAllFallbackPools();
    }

    // ============ Milestone View Functions ============

    /**
     * @notice Get milestone details
     * @param proposalId Proposal ID
     * @param milestoneId Milestone index
     * @return milestone Milestone struct
     */
    function getMilestone(uint256 proposalId, uint256 milestoneId)
        external
        view
        returns (IProposalManager.Milestone memory)
    {
        return proposalManager.getMilestone(proposalId, milestoneId);
    }

    /**
     * @notice Get all milestones for a proposal
     * @param proposalId Proposal ID
     * @return milestones Array of Milestone structs
     */
    function getMilestones(uint256 proposalId)
        external
        view
        returns (IProposalManager.Milestone[] memory)
    {
        return proposalManager.getMilestones(proposalId);
    }

    /**
     * @notice Get milestone count for a proposal
     * @param proposalId Proposal ID
     * @return count Number of milestones
     */
    function getMilestoneCount(uint256 proposalId) external view returns (uint256) {
        return proposalManager.getMilestoneCount(proposalId);
    }

    /**
     * @notice Check if voter has voted on milestone
     * @param proposalId Proposal ID
     * @param milestoneId Milestone index
     * @param voter Voter address
     * @return voted True if already voted
     */
    function hasVotedOnMilestone(uint256 proposalId, uint256 milestoneId, address voter)
        external
        view
        returns (bool)
    {
        return milestoneManager.hasVotedOnMilestone(proposalId, milestoneId, voter);
    }

    /**
     * @notice Get MilestoneManager contract address
     */
    function getMilestoneManagerAddress() external view returns (address) {
        return address(milestoneManager);
    }

    // ============ NFT View Functions ============

    /**
     * @notice Get VotingNFT contract address
     */
    function getVotingNFTAddress() external view returns (address) {
        return address(votingNFT);
    }

    /**
     * @notice Get OrganizerNFT contract address
     */
    function getOrganizerNFTAddress() external view returns (address) {
        revert("OrganizerNFT replaced by TawfPassport");
    }

    /**
     * @notice Get ParticipationTracker contract address
     */
    function getParticipationTrackerAddress() external view returns (address) {
        return address(participationTracker);
    }

    /**
     * @notice Get voting power for an address
     * @param voter Address to check
     * @return Voting power (1, 2, or 3 based on tier)
     */
    function getVotingPower(address voter) external view returns (uint256) {
        return votingNFT.getVotingPower(voter);
    }

    /**
     * @notice Get voting tier for an address
     * @param voter Address to check
     * @return Current voting tier
     */
    function getVotingTier(address voter) external view returns (VotingNFT.VotingTier) {
        return votingNFT.getTier(voter);
    }

    /**
     * @notice Check if address has a Voting NFT
     * @param voter Address to check
     * @return True if voter has a Voting NFT
     */
    function hasVotingNFT(address voter) external view returns (bool) {
        return votingNFT.hasVotingNFT(voter);
    }

    /**
     * @notice Check if address is a verified organizer
     * @param organizer Address to check
     * @return True if organizer is verified and active
     */
    function isVerifiedOrganizer(address organizer) external view returns (bool) {
        return hasRole(ORGANIZER_ROLE, organizer);
    }

    /**
     * @notice Get organizer data
     * @param organizer Address to check
     * @return data Full organizer NFT data
     */
    function getOrganizerData(address organizer) external view returns (bool, bool) {
        return (hasRole(ORGANIZER_ROLE, organizer), hasRole(ORGANIZER_ROLE, organizer));
    }

    /**
     * @notice Get participation metrics for an address
     * @param user Address to check
     * @return metrics Full participation metrics
     */
    function getParticipationMetrics(address user) external view returns (ParticipationTracker.ParticipationMetrics memory) {
        return participationTracker.getMetrics(user);
    }

    /**
     * @notice Get tier eligibility for an address
     * @param user Address to check
     * @return tier1 Eligible for Tier 1
     * @return tier2 Eligible for Tier 2
     * @return tier3 Eligible for Tier 3
     */
    function getTierEligibility(address user) external view returns (bool tier1, bool tier2, bool tier3) {
        return participationTracker.getTierEligibility(user);
    }

    /**
     * @notice Auto-upgrade voting tier based on participation
     * @param voter Address to upgrade
     * @return upgraded True if tier was upgraded
     */
    function autoUpgradeVotingTier(address voter) external returns (bool) {
        return votingNFT.autoUpgradeTier(voter);
    }
}

