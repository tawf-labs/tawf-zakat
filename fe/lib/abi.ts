// Smart Contract ABIs and Configuration for Ethereum Sepolia (chain 11155111)
//
// V10 ZK layer redeployed 2026-07-26 at block 11350675, wired to the existing
// tawf-gov DAO contracts. Verified on-chain: ZKTCore's DAO references and all
// role grants were read back after deployment.
//
// NOTE: HonkVerifier and Groth16Verifier are fail-closed placeholders — both
// report isOperational() == false and reject every proof. donateZK and
// donateZKPrivate therefore revert by design. See
// sc/src/DAO/verifiers/HonkVerifier.sol and PRIVATE_DONATION_AVAILABLE in
// lib/aztec-private-donation.ts.

export const CONTRACT_ADDRESSES = {
  // ── zkt-hackathon (ZK layer) ──
  ZKTCore: (process.env.NEXT_PUBLIC_CONTRACT_ZKT_CORE || '0x28Eb1b95dFf00B2f876eaE24024B4e501710A287') as `0x${string}`,
  ShariaReviewManager: (process.env.NEXT_PUBLIC_CONTRACT_SHARIA_REVIEW_MANAGER || '0x3A968cDc9CFC2f3aDFab4733415943E12B72a953') as `0x${string}`,
  PrivateDonationPool: (process.env.NEXT_PUBLIC_CONTRACT_PRIVATE_DONATION_POOL || '0xe8908AD46ecC4A7F7e0e634BEB0e696bd497c846') as `0x${string}`,
  HonkVerifier: (process.env.NEXT_PUBLIC_CONTRACT_HONK_VERIFIER || '0x1696c9e54c425760cF0E46181CE91A57A0ca8369') as `0x${string}`,
  Groth16Verifier: (process.env.NEXT_PUBLIC_CONTRACT_GROTH16_VERIFIER || '0x7702B20B7302A82E3Cb09aAe7A72bb19A2d5Db84') as `0x${string}`,
  NullifierRegistry: (process.env.NEXT_PUBLIC_CONTRACT_NULLIFIER_REGISTRY || '0x49a8C624c52A6A3F88Cc0073834dEf9b11326B56') as `0x${string}`,

  // ── tawf-gov (DAO layer) ──
  TawfPassport: (process.env.NEXT_PUBLIC_CONTRACT_TAWF_PASSPORT || '0x68A39923A1b80F3d48B4bd60FBe4187Ff2B0a38e') as `0x${string}`,
  TawfReputation: (process.env.NEXT_PUBLIC_CONTRACT_TAWF_REPUTATION || '0xEBc9637933575Aa3b047Dc19C4dE3706F03DC32c') as `0x${string}`,
  MockIDRX: (process.env.NEXT_PUBLIC_CONTRACT_MOCK_IDRX || '0x23A48A17ea36627ACF4Ce349C14d17c7e7F90BCE') as `0x${string}`,
  VotingNFT: (process.env.NEXT_PUBLIC_CONTRACT_VOTING_NFT || '0xEb44b1409F34944cd137DD522e8FE9dD41533D33') as `0x${string}`,
  DonationReceiptNFT: (process.env.NEXT_PUBLIC_CONTRACT_RECEIPT_NFT || '0x536a7249113E2f2c06a6E85acDa9B54dc79F5e58') as `0x${string}`,
  ProposalManager: (process.env.NEXT_PUBLIC_CONTRACT_PROPOSAL_MANAGER || '0x37f87a1913a8efAE70a39850f8c9e2C63AeC556B') as `0x${string}`,
  VotingManager: (process.env.NEXT_PUBLIC_CONTRACT_VOTING_MANAGER || '0x4B6600f35592A83770A610a038c012186471143a') as `0x${string}`,
  MilestoneManager: (process.env.NEXT_PUBLIC_CONTRACT_MILESTONE_MANAGER || '0xb0Fa6d4a2038ed85c9d16664BeeD169858D5f183') as `0x${string}`,
  ParticipationTracker: (process.env.NEXT_PUBLIC_CONTRACT_PARTICIPATION_TRACKER || '0xA2313195cB23cC0AeB28E94f43DFBE0Fdc3d2e37') as `0x${string}`,
  PoolManager: (process.env.NEXT_PUBLIC_CONTRACT_POOL_MANAGER || '0x10bE98A362c18d690BEd51069F8D0c847cf2092A') as `0x${string}`,
  ZakatEscrowManager: (process.env.NEXT_PUBLIC_CONTRACT_ZAKAT_ESCROW_MANAGER || '0x3534105fD0338dAF5Faa0BC97c760Fe861bd052e') as `0x${string}`,
} as const;

// ZKTCore ABI - Main orchestrator contract
export const ZKTCoreABI = [
  {
    "type": "constructor",
    "inputs": [
      { "name": "_idrxToken", "type": "address", "internalType": "address" },
      { "name": "_receiptNFT", "type": "address", "internalType": "address" },
      { "name": "_votingNFT", "type": "address", "internalType": "address" },
      { "name": "_organizerNFT", "type": "address", "internalType": "address" },
      { "name": "_participationTracker", "type": "address", "internalType": "address" },
      { "name": "_proposalManager", "type": "address", "internalType": "address" },
      { "name": "_votingManager", "type": "address", "internalType": "address" },
      { "name": "_shariaReviewManager", "type": "address", "internalType": "address" },
      { "name": "_poolManager", "type": "address", "internalType": "address" },
      { "name": "_zakatEscrowManager", "type": "address", "internalType": "address" },
      { "name": "_milestoneManager", "type": "address", "internalType": "address" },
      { "name": "_honkVerifier", "type": "address", "internalType": "address" },
      { "name": "_nullifierRegistry", "type": "address", "internalType": "address" }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "poolCount",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposalCount",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bundleCount",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DEFAULT_ADMIN_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "KYC_ORACLE_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ORGANIZER_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SHARIA_COUNCIL_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "applicantToApplicationId",
    "inputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "autoUpgradeVotingTier",
    "inputs": [{ "name": "voter", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "batchSubmitShariaReviewProofs",
    "inputs": [
      { "name": "bundleId", "type": "uint256", "internalType": "uint256" },
      { "name": "proposalIds", "type": "uint256[]", "internalType": "uint256[]" },
      { "name": "approvalCounts", "type": "uint256[]", "internalType": "uint256[]" },
      { "name": "campaignTypes", "type": "uint8[]", "internalType": "enum IProposalManager.CampaignType[]" },
      {
        "name": "proofs",
        "type": "tuple[]",
        "internalType": "struct Groth16Proof[]",
        "components": [
          { "name": "pi_a", "type": "uint256[2]", "internalType": "uint256[2]" },
          { "name": "pi_b", "type": "uint256[2][2]", "internalType": "uint256[2][2]" },
          { "name": "pi_c", "type": "uint256[2]", "internalType": "uint256[2]" }
        ]
      }
    ],
    "outputs": [{ "name": "successCount", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelProposal",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "castVote",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "support", "type": "uint8", "internalType": "uint8" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "checkAndCreateBundle",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "checkZakatTimeout",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "councilExtendZakatDeadline",
    "inputs": [
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "reasoning", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createCampaignPool",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "fallbackPool", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createCampaignPool",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createProposal",
    "inputs": [
      { "name": "title", "type": "string", "internalType": "string" },
      { "name": "description", "type": "string", "internalType": "string" },
      { "name": "fundingGoal", "type": "uint256", "internalType": "uint256" },
      { "name": "isEmergency", "type": "bool", "internalType": "bool" },
      { "name": "mockZKKYCProof", "type": "bytes32", "internalType": "bytes32" },
      { "name": "zakatChecklistItems", "type": "string[]", "internalType": "string[]" },
      { "name": "metadataURI", "type": "string", "internalType": "string" },
      {
        "name": "milestoneInputs",
        "type": "tuple[]",
        "internalType": "struct IProposalManager.MilestoneInput[]",
        "components": [
          { "name": "description", "type": "string", "internalType": "string" },
          { "name": "targetAmount", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createShariaReviewBundle",
    "inputs": [{ "name": "proposalIds", "type": "uint256[]", "internalType": "uint256[]" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "donate",
    "inputs": [
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "donatePrivate",
    "inputs": [
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" },
      { "name": "commitment", "type": "bytes32", "internalType": "bytes32" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "donateZK",
    "inputs": [
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" },
      { "name": "proof", "type": "bytes", "internalType": "bytes" },
      { "name": "publicInputs", "type": "bytes32[]", "internalType": "bytes32[]" },
      { "name": "nullifier", "type": "bytes32", "internalType": "bytes32" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeZakatRedistribution",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeCommunityVote",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeMilestoneVote",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeOrganizerApplication",
    "inputs": [
      { "name": "applicationId", "type": "uint256", "internalType": "uint256" },
      { "name": "approved", "type": "bool", "internalType": "bool" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeShariaBundle",
    "inputs": [{ "name": "bundleId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getAllFallbackPools",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address[]", "internalType": "address[]" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getApplicantApplicationId",
    "inputs": [{ "name": "applicant", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getFallbackPool",
    "inputs": [{ "name": "pool", "type": "address", "internalType": "address" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ZakatEscrowManager.FallbackPoolData",
        "components": [
          { "name": "pool", "type": "address", "internalType": "address" },
          { "name": "status", "type": "uint8", "internalType": "enum ZakatEscrowManager.FallbackStatus" },
          { "name": "proposedAt", "type": "uint256", "internalType": "uint256" },
          { "name": "proposer", "type": "address", "internalType": "address" },
          { "name": "reasoning", "type": "string", "internalType": "string" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getMilestone",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IProposalManager.Milestone",
        "components": [
          { "name": "milestoneId", "type": "uint256", "internalType": "uint256" },
          { "name": "description", "type": "string", "internalType": "string" },
          { "name": "targetAmount", "type": "uint256", "internalType": "uint256" },
          { "name": "proofIPFS", "type": "string", "internalType": "string" },
          { "name": "status", "type": "uint8", "internalType": "enum IProposalManager.MilestoneStatus" },
          { "name": "proofSubmittedAt", "type": "uint256", "internalType": "uint256" },
          { "name": "voteStart", "type": "uint256", "internalType": "uint256" },
          { "name": "voteEnd", "type": "uint256", "internalType": "uint256" },
          { "name": "votesFor", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAgainst", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAbstain", "type": "uint256", "internalType": "uint256" },
          { "name": "releasedAt", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getMilestoneCount",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getMilestones",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct IProposalManager.Milestone[]",
        "components": [
          { "name": "milestoneId", "type": "uint256", "internalType": "uint256" },
          { "name": "description", "type": "string", "internalType": "string" },
          { "name": "targetAmount", "type": "uint256", "internalType": "uint256" },
          { "name": "proofIPFS", "type": "string", "internalType": "string" },
          { "name": "status", "type": "uint8", "internalType": "enum IProposalManager.MilestoneStatus" },
          { "name": "proofSubmittedAt", "type": "uint256", "internalType": "uint256" },
          { "name": "voteStart", "type": "uint256", "internalType": "uint256" },
          { "name": "voteEnd", "type": "uint256", "internalType": "uint256" },
          { "name": "votesFor", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAgainst", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAbstain", "type": "uint256", "internalType": "uint256" },
          { "name": "releasedAt", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getOrganizerApplication",
    "inputs": [{ "name": "applicationId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IProposalManager.OrganizerApplication",
        "components": [
          { "name": "applicationId", "type": "uint256", "internalType": "uint256" },
          { "name": "applicant", "type": "address", "internalType": "address" },
          { "name": "organizationName", "type": "string", "internalType": "string" },
          { "name": "description", "type": "string", "internalType": "string" },
          { "name": "metadataURI", "type": "string", "internalType": "string" },
          { "name": "status", "type": "uint8", "internalType": "enum IProposalManager.OrganizerApplicationStatus" },
          { "name": "kycStatus", "type": "uint8", "internalType": "enum IProposalManager.KYCStatus" },
          { "name": "appliedAt", "type": "uint256", "internalType": "uint256" },
          { "name": "voteStart", "type": "uint256", "internalType": "uint256" },
          { "name": "voteEnd", "type": "uint256", "internalType": "uint256" },
          { "name": "votesFor", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAgainst", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAbstain", "type": "uint256", "internalType": "uint256" },
          { "name": "notes", "type": "string", "internalType": "string" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getOrganizerData",
    "inputs": [{ "name": "organizer", "type": "address", "internalType": "address" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct OrganizerNFT.OrganizerNFTData",
        "components": [
          {
            "name": "profile",
            "type": "tuple",
            "internalType": "struct OrganizerNFT.OrganizerProfile",
            "components": [
              { "name": "organizationName", "type": "string", "internalType": "string" },
              { "name": "description", "type": "string", "internalType": "string" },
              { "name": "website", "type": "string", "internalType": "string" },
              { "name": "contactEmail", "type": "string", "internalType": "string" },
              { "name": "metadataURI", "type": "string", "internalType": "string" }
            ]
          },
          { "name": "kycStatus", "type": "uint8", "internalType": "enum OrganizerNFT.OrganizerKYCStatus" },
          { "name": "approvedAt", "type": "uint256", "internalType": "uint256" },
          { "name": "campaignsCreated", "type": "uint256", "internalType": "uint256" },
          { "name": "campaignsCompleted", "type": "uint256", "internalType": "uint256" },
          { "name": "totalFundsReceived", "type": "uint256", "internalType": "uint256" },
          { "name": "kycNotes", "type": "string", "internalType": "string" },
          { "name": "lastUpdated", "type": "uint256", "internalType": "uint256" },
          { "name": "isActive", "type": "bool", "internalType": "bool" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getParticipationMetrics",
    "inputs": [{ "name": "user", "type": "address", "internalType": "address" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ParticipationTracker.ParticipationMetrics",
        "components": [
          { "name": "donationCount", "type": "uint256", "internalType": "uint256" },
          { "name": "uniqueCampaignsDonated", "type": "uint256", "internalType": "uint256" },
          { "name": "firstDonationTimestamp", "type": "uint256", "internalType": "uint256" },
          { "name": "lastDonationTimestamp", "type": "uint256", "internalType": "uint256" },
          { "name": "governanceVotesCast", "type": "uint256", "internalType": "uint256" },
          { "name": "proposalsVotedOn", "type": "uint256", "internalType": "uint256" },
          { "name": "lastVoteTimestamp", "type": "uint256", "internalType": "uint256" },
          { "name": "proposalsCreated", "type": "uint256", "internalType": "uint256" },
          { "name": "proposalsApproved", "type": "uint256", "internalType": "uint256" },
          { "name": "proposalsCompleted", "type": "uint256", "internalType": "uint256" },
          { "name": "milestoneVotesCast", "type": "uint256", "internalType": "uint256" },
          { "name": "disputesRaised", "type": "uint256", "internalType": "uint256" },
          { "name": "lastActivityTimestamp", "type": "uint256", "internalType": "uint256" },
          { "name": "isVerified", "type": "bool", "internalType": "bool" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPool",
    "inputs": [{ "name": "_poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolManager.CampaignPool",
        "components": [
          { "name": "poolId", "type": "uint256", "internalType": "uint256" },
          { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
          { "name": "organizer", "type": "address", "internalType": "address" },
          { "name": "fundingGoal", "type": "uint256", "internalType": "uint256" },
          { "name": "raisedAmount", "type": "uint256", "internalType": "uint256" },
          { "name": "campaignType", "type": "uint8", "internalType": "enum IProposalManager.CampaignType" },
          { "name": "campaignTitle", "type": "string", "internalType": "string" },
          { "name": "isActive", "type": "bool", "internalType": "bool" },
          { "name": "createdAt", "type": "uint256", "internalType": "uint256" },
          { "name": "donors", "type": "address[]", "internalType": "address[]" },
          { "name": "fundsWithdrawn", "type": "bool", "internalType": "bool" },
          { "name": "totalWithdrawn", "type": "uint256", "internalType": "uint256" },
          { "name": "usesMilestones", "type": "bool", "internalType": "bool" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getProposal",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IProposalManager.Proposal",
        "components": [
          { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
          { "name": "organizer", "type": "address", "internalType": "address" },
          { "name": "title", "type": "string", "internalType": "string" },
          { "name": "description", "type": "string", "internalType": "string" },
          { "name": "fundingGoal", "type": "uint256", "internalType": "uint256" },
          { "name": "kycStatus", "type": "uint8", "internalType": "enum IProposalManager.KYCStatus" },
          { "name": "isEmergency", "type": "bool", "internalType": "bool" },
          { "name": "mockZKKYCProof", "type": "bytes32", "internalType": "bytes32" },
          { "name": "kycNotes", "type": "string", "internalType": "string" },
          { "name": "createdAt", "type": "uint256", "internalType": "uint256" },
          { "name": "communityVoteStart", "type": "uint256", "internalType": "uint256" },
          { "name": "communityVoteEnd", "type": "uint256", "internalType": "uint256" },
          { "name": "votesFor", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAgainst", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAbstain", "type": "uint256", "internalType": "uint256" },
          { "name": "status", "type": "uint8", "internalType": "enum IProposalManager.ProposalStatus" },
          { "name": "campaignType", "type": "uint8", "internalType": "enum IProposalManager.CampaignType" },
          { "name": "poolId", "type": "uint256", "internalType": "uint256" },
          { "name": "zakatChecklistItems", "type": "string[]", "internalType": "string[]" },
          { "name": "metadataURI", "type": "string", "internalType": "string" },
          { "name": "currentMilestoneIndex", "type": "uint256", "internalType": "uint256" },
          { "name": "totalReleasedAmount", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getTierEligibility",
    "inputs": [{ "name": "user", "type": "address", "internalType": "address" }],
    "outputs": [
      { "name": "tier1", "type": "bool", "internalType": "bool" },
      { "name": "tier2", "type": "bool", "internalType": "bool" },
      { "name": "tier3", "type": "bool", "internalType": "bool" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getVotingPower",
    "inputs": [{ "name": "voter", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getVotingTier",
    "inputs": [{ "name": "voter", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint8", "internalType": "enum VotingNFT.VotingTier" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getZakatPool",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ZakatEscrowManager.ZakatPool",
        "components": [
          { "name": "poolId", "type": "uint256", "internalType": "uint256" },
          { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
          { "name": "organizer", "type": "address", "internalType": "address" },
          { "name": "fundingGoal", "type": "uint256", "internalType": "uint256" },
          { "name": "raisedAmount", "type": "uint256", "internalType": "uint256" },
          { "name": "campaignTitle", "type": "string", "internalType": "string" },
          { "name": "createdAt", "type": "uint256", "internalType": "uint256" },
          { "name": "deadline", "type": "uint256", "internalType": "uint256" },
          { "name": "gracePeriodEnd", "type": "uint256", "internalType": "uint256" },
          { "name": "fallbackPool", "type": "address", "internalType": "address" },
          { "name": "fallbackStatus", "type": "uint8", "internalType": "enum ZakatEscrowManager.FallbackStatus" },
          { "name": "status", "type": "uint8", "internalType": "enum ZakatEscrowManager.PoolStatus" },
          { "name": "redistributed", "type": "bool", "internalType": "bool" },
          { "name": "extensionUsed", "type": "bool", "internalType": "bool" },
          { "name": "extensionGranted", "type": "bool", "internalType": "bool" },
          { "name": "extensionGrantedAt", "type": "uint256", "internalType": "uint256" },
          { "name": "donors", "type": "address[]", "internalType": "address[]" },
          { "name": "fundsWithdrawn", "type": "bool", "internalType": "bool" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getZakatPoolStatusString",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "string", "internalType": "string" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getZakatTimeRemaining",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      { "name": "remaining", "type": "uint256", "internalType": "uint256" },
      { "name": "inGracePeriod", "type": "bool", "internalType": "bool" },
      { "name": "canRedistribute", "type": "bool", "internalType": "bool" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "grantKYCOracleRole",
    "inputs": [{ "name": "account", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "grantOrganizerRole",
    "inputs": [{ "name": "account", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "grantVotingNFT",
    "inputs": [
      { "name": "account", "type": "address", "internalType": "address" },
      { "name": "metadataURI", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hasVerifiedProof",
    "inputs": [
      { "name": "bundleId", "type": "uint256", "internalType": "uint256" },
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "verified", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasVotedOnMilestone",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" },
      { "name": "voter", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isVerifiedOrganizer",
    "inputs": [{ "name": "organizer", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isZakatReadyForRedistribution",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposeFallbackPool",
    "inputs": [
      { "name": "pool", "type": "address", "internalType": "address" },
      { "name": "reasoning", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "proposeOrganizer",
    "inputs": [
      { "name": "organizationName", "type": "string", "internalType": "string" },
      { "name": "description", "type": "string", "internalType": "string" },
      { "name": "metadataURI", "type": "string", "internalType": "string" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reviewProposal",
    "inputs": [
      { "name": "bundleId", "type": "uint256", "internalType": "uint256" },
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "approved", "type": "bool", "internalType": "bool" },
      { "name": "campaignType", "type": "uint8", "internalType": "enum IProposalManager.CampaignType" },
      { "name": "mockZKReviewProof", "type": "bytes32", "internalType": "bytes32" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setCouncilMerkleRoot",
    "inputs": [{ "name": "newRoot", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setDefaultFallbackPool",
    "inputs": [{ "name": "pool", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setNullifierMerkleRoot",
    "inputs": [{ "name": "newRoot", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPassThreshold",
    "inputs": [{ "name": "_passThreshold", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setQuorumPercentage",
    "inputs": [{ "name": "_quorumPercentage", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setShariaQuorum",
    "inputs": [{ "name": "_quorum", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setVotingPeriod",
    "inputs": [{ "name": "_votingPeriod", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "startMilestoneVoting",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitForCommunityVote",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitMilestoneProof",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitOrganizerApplicationForVote",
    "inputs": [{ "name": "applicationId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitShariaReviewProof",
    "inputs": [
      { "name": "bundleId", "type": "uint256", "internalType": "uint256" },
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "approvalCount", "type": "uint256", "internalType": "uint256" },
      { "name": "campaignType", "type": "uint8", "internalType": "enum IProposalManager.CampaignType" },
      {
        "name": "proof",
        "type": "tuple",
        "internalType": "struct Groth16Proof",
        "components": [
          { "name": "pi_a", "type": "uint256[2]", "internalType": "uint256[2]" },
          { "name": "pi_b", "type": "uint256[2][2]", "internalType": "uint256[2][2]" },
          { "name": "pi_c", "type": "uint256[2]", "internalType": "uint256[2]" }
        ]
      }
    ],
    "outputs": [{ "name": "success", "type": "bool", "internalType": "bool" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateKYCStatus",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "newStatus", "type": "uint8", "internalType": "enum IProposalManager.KYCStatus" },
      { "name": "notes", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateOrganizerKYC",
    "inputs": [
      { "name": "applicationId", "type": "uint256", "internalType": "uint256" },
      { "name": "newStatus", "type": "uint8", "internalType": "enum IProposalManager.KYCStatus" },
      { "name": "notes", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "verifyVoter",
    "inputs": [{ "name": "voter", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "vetFallbackPool",
    "inputs": [{ "name": "pool", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "voteMilestone",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" },
      { "name": "support", "type": "uint8", "internalType": "uint8" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawFunds",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawMilestoneFunds",
    "inputs": [
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "OrganizerApplicationFinalized",
    "inputs": [
      { "name": "applicationId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "applicant", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "approved", "type": "bool", "indexed": false, "internalType": "bool" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrganizerApplicationKYCUpdated",
    "inputs": [
      { "name": "applicationId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "applicant", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "status", "type": "uint8", "indexed": false, "internalType": "enum IProposalManager.KYCStatus" },
      { "name": "notes", "type": "string", "indexed": false, "internalType": "string" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrganizerApplicationSubmitted",
    "inputs": [
      { "name": "applicationId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "applicant", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "organizationName", "type": "string", "indexed": false, "internalType": "string" },
      { "name": "description", "type": "string", "indexed": false, "internalType": "string" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrganizerApplicationVoteStarted",
    "inputs": [
      { "name": "applicationId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "voteStart", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "voteEnd", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  }
] as const;

// ProposalManager ABI - For proposal lifecycle management
export const ProposalManagerABI = [
  { "type": "constructor", "inputs": [], "stateMutability": "nonpayable" },
  {
    "type": "function",
    "name": "ADMIN_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DEFAULT_ADMIN_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "KYC_ORACLE_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_MILESTONES",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MILESTONE_MANAGER_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ORGANIZER_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "VOTING_MANAGER_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "addToReleasedAmount",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "advanceToNextMilestone",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelProposal",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createProposal",
    "inputs": [
      { "name": "organizer", "type": "address", "internalType": "address" },
      { "name": "title", "type": "string", "internalType": "string" },
      { "name": "description", "type": "string", "internalType": "string" },
      { "name": "fundingGoal", "type": "uint256", "internalType": "uint256" },
      { "name": "isEmergency", "type": "bool", "internalType": "bool" },
      { "name": "mockZKKYCProof", "type": "bytes32", "internalType": "bytes32" },
      { "name": "zakatChecklistItems", "type": "string[]", "internalType": "string[]" },
      { "name": "metadataURI", "type": "string", "internalType": "string" },
      {
        "name": "milestoneInputs",
        "type": "tuple[]",
        "internalType": "struct IProposalManager.MilestoneInput[]",
        "components": [
          { "name": "description", "type": "string", "internalType": "string" },
          { "name": "targetAmount", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getMilestone",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IProposalManager.Milestone",
        "components": [
          { "name": "milestoneId", "type": "uint256", "internalType": "uint256" },
          { "name": "description", "type": "string", "internalType": "string" },
          { "name": "targetAmount", "type": "uint256", "internalType": "uint256" },
          { "name": "proofIPFS", "type": "string", "internalType": "string" },
          { "name": "status", "type": "uint8", "internalType": "enum IProposalManager.MilestoneStatus" },
          { "name": "proofSubmittedAt", "type": "uint256", "internalType": "uint256" },
          { "name": "voteStart", "type": "uint256", "internalType": "uint256" },
          { "name": "voteEnd", "type": "uint256", "internalType": "uint256" },
          { "name": "votesFor", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAgainst", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAbstain", "type": "uint256", "internalType": "uint256" },
          { "name": "releasedAt", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getMilestoneCount",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getMilestones",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct IProposalManager.Milestone[]",
        "components": [
          { "name": "milestoneId", "type": "uint256", "internalType": "uint256" },
          { "name": "description", "type": "string", "internalType": "string" },
          { "name": "targetAmount", "type": "uint256", "internalType": "uint256" },
          { "name": "proofIPFS", "type": "string", "internalType": "string" },
          { "name": "status", "type": "uint8", "internalType": "enum IProposalManager.MilestoneStatus" },
          { "name": "proofSubmittedAt", "type": "uint256", "internalType": "uint256" },
          { "name": "voteStart", "type": "uint256", "internalType": "uint256" },
          { "name": "voteEnd", "type": "uint256", "internalType": "uint256" },
          { "name": "votesFor", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAgainst", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAbstain", "type": "uint256", "internalType": "uint256" },
          { "name": "releasedAt", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getProposal",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IProposalManager.Proposal",
        "components": [
          { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
          { "name": "organizer", "type": "address", "internalType": "address" },
          { "name": "title", "type": "string", "internalType": "string" },
          { "name": "description", "type": "string", "internalType": "string" },
          { "name": "fundingGoal", "type": "uint256", "internalType": "uint256" },
          { "name": "kycStatus", "type": "uint8", "internalType": "enum IProposalManager.KYCStatus" },
          { "name": "isEmergency", "type": "bool", "internalType": "bool" },
          { "name": "mockZKKYCProof", "type": "bytes32", "internalType": "bytes32" },
          { "name": "kycNotes", "type": "string", "internalType": "string" },
          { "name": "createdAt", "type": "uint256", "internalType": "uint256" },
          { "name": "communityVoteStart", "type": "uint256", "internalType": "uint256" },
          { "name": "communityVoteEnd", "type": "uint256", "internalType": "uint256" },
          { "name": "votesFor", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAgainst", "type": "uint256", "internalType": "uint256" },
          { "name": "votesAbstain", "type": "uint256", "internalType": "uint256" },
          { "name": "status", "type": "uint8", "internalType": "enum IProposalManager.ProposalStatus" },
          { "name": "campaignType", "type": "uint8", "internalType": "enum IProposalManager.CampaignType" },
          { "name": "poolId", "type": "uint256", "internalType": "uint256" },
          { "name": "zakatChecklistItems", "type": "string[]", "internalType": "string[]" },
          { "name": "metadataURI", "type": "string", "internalType": "string" },
          { "name": "currentMilestoneIndex", "type": "uint256", "internalType": "uint256" },
          { "name": "totalReleasedAmount", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposalCount",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "submitForCommunityVote",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateKYCStatus",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "newStatus", "type": "uint8", "internalType": "enum IProposalManager.KYCStatus" },
      { "name": "notes", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateMilestoneProof",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateMilestoneStatus",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" },
      { "name": "newStatus", "type": "uint8", "internalType": "enum IProposalManager.MilestoneStatus" },
      { "name": "votesFor", "type": "uint256", "internalType": "uint256" },
      { "name": "votesAgainst", "type": "uint256", "internalType": "uint256" },
      { "name": "votesAbstain", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateProposalCampaignType",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "campaignType", "type": "uint8", "internalType": "enum IProposalManager.CampaignType" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateProposalPoolId",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "poolId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateProposalStatus",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "newStatus", "type": "uint8", "internalType": "enum IProposalManager.ProposalStatus" },
      { "name": "votesFor", "type": "uint256", "internalType": "uint256" },
      { "name": "votesAgainst", "type": "uint256", "internalType": "uint256" },
      { "name": "votesAbstain", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const;

// PoolManager ABI - For campaign pool management
export const PoolManagerABI = [
  { "type": "constructor", "inputs": [
    { "name": "_proposalManager", "type": "address", "internalType": "address" },
    { "name": "_idrxToken", "type": "address", "internalType": "address" },
    { "name": "_receiptNFT", "type": "address", "internalType": "address" }
  ], "stateMutability": "nonpayable" },
  {
    "type": "function",
    "name": "ADMIN_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DEFAULT_ADMIN_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createCampaignPool",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "donate",
    "inputs": [
      { "name": "donor", "type": "address", "internalType": "address" },
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "donatePrivate",
    "inputs": [
      { "name": "donor", "type": "address", "internalType": "address" },
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" },
      { "name": "commitment", "type": "bytes32", "internalType": "bytes32" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getPool",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolManager.CampaignPool",
        "components": [
          { "name": "poolId", "type": "uint256", "internalType": "uint256" },
          { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
          { "name": "organizer", "type": "address", "internalType": "address" },
          { "name": "fundingGoal", "type": "uint256", "internalType": "uint256" },
          { "name": "raisedAmount", "type": "uint256", "internalType": "uint256" },
          { "name": "campaignType", "type": "uint8", "internalType": "enum IProposalManager.CampaignType" },
          { "name": "campaignTitle", "type": "string", "internalType": "string" },
          { "name": "isActive", "type": "bool", "internalType": "bool" },
          { "name": "createdAt", "type": "uint256", "internalType": "uint256" },
          { "name": "donors", "type": "address[]", "internalType": "address[]" },
          { "name": "fundsWithdrawn", "type": "bool", "internalType": "bool" },
          { "name": "totalWithdrawn", "type": "uint256", "internalType": "uint256" },
          { "name": "usesMilestones", "type": "bool", "internalType": "bool" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolCount",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdrawFunds",
    "inputs": [
      { "name": "organizer", "type": "address", "internalType": "address" },
      { "name": "poolId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawMilestoneFunds",
    "inputs": [
      { "name": "organizer", "type": "address", "internalType": "address" },
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "milestoneId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const;

// ZakatEscrowManager ABI - For Zakat-compliant campaign timeout management
export const ZakatEscrowManagerABI = [
  {
    "type": "constructor",
    "inputs": [
      { "name": "_proposalManager", "type": "address", "internalType": "address" },
      { "name": "_idrxToken", "type": "address", "internalType": "address" },
      { "name": "_receiptNFT", "type": "address", "internalType": "address" }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ADMIN_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DEFAULT_ADMIN_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "EXTENSION_DURATION",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "GRACE_PERIOD",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SHARIA_COUNCIL_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ZAKAT_PERIOD",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolCount",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "checkTimeout",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "councilExtendDeadline",
    "inputs": [
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "reasoning", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createZakatPool",
    "inputs": [
      { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
      { "name": "fallbackPool", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "defaultFallbackPool",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "donate",
    "inputs": [
      { "name": "donor", "type": "address", "internalType": "address" },
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "donatePrivate",
    "inputs": [
      { "name": "donor", "type": "address", "internalType": "address" },
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" },
      { "name": "commitment", "type": "bytes32", "internalType": "bytes32" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeRedistribution",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getAllFallbackPools",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address[]", "internalType": "address[]" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getDonorContribution",
    "inputs": [
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "donor", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getFallbackPool",
    "inputs": [{ "name": "pool", "type": "address", "internalType": "address" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ZakatEscrowManager.FallbackPoolData",
        "components": [
          { "name": "pool", "type": "address", "internalType": "address" },
          { "name": "status", "type": "uint8", "internalType": "enum ZakatEscrowManager.FallbackStatus" },
          { "name": "proposedAt", "type": "uint256", "internalType": "uint256" },
          { "name": "proposer", "type": "address", "internalType": "address" },
          { "name": "reasoning", "type": "string", "internalType": "string" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPool",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ZakatEscrowManager.ZakatPool",
        "components": [
          { "name": "poolId", "type": "uint256", "internalType": "uint256" },
          { "name": "proposalId", "type": "uint256", "internalType": "uint256" },
          { "name": "organizer", "type": "address", "internalType": "address" },
          { "name": "fundingGoal", "type": "uint256", "internalType": "uint256" },
          { "name": "raisedAmount", "type": "uint256", "internalType": "uint256" },
          { "name": "campaignTitle", "type": "string", "internalType": "string" },
          { "name": "createdAt", "type": "uint256", "internalType": "uint256" },
          { "name": "deadline", "type": "uint256", "internalType": "uint256" },
          { "name": "gracePeriodEnd", "type": "uint256", "internalType": "uint256" },
          { "name": "fallbackPool", "type": "address", "internalType": "address" },
          { "name": "fallbackStatus", "type": "uint8", "internalType": "enum ZakatEscrowManager.FallbackStatus" },
          { "name": "status", "type": "uint8", "internalType": "enum ZakatEscrowManager.PoolStatus" },
          { "name": "redistributed", "type": "bool", "internalType": "bool" },
          { "name": "extensionUsed", "type": "bool", "internalType": "bool" },
          { "name": "extensionGranted", "type": "bool", "internalType": "bool" },
          { "name": "extensionGrantedAt", "type": "uint256", "internalType": "uint256" },
          { "name": "donors", "type": "address[]", "internalType": "address[]" },
          { "name": "fundsWithdrawn", "type": "bool", "internalType": "bool" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPoolByProposal",
    "inputs": [{ "name": "proposalId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPoolDonors",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "address[]", "internalType": "address[]" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPoolStatusString",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "string", "internalType": "string" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getTimeRemaining",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      { "name": "remaining", "type": "uint256", "internalType": "uint256" },
      { "name": "inGracePeriod", "type": "bool", "internalType": "bool" },
      { "name": "canRedistribute", "type": "bool", "internalType": "bool" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isReadyForRedistribution",
    "inputs": [{ "name": "poolId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposeFallbackPool",
    "inputs": [
      { "name": "pool", "type": "address", "internalType": "address" },
      { "name": "reasoning", "type": "string", "internalType": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeFallbackPool",
    "inputs": [{ "name": "pool", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setDefaultFallbackPool",
    "inputs": [{ "name": "pool", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "vetFallbackPool",
    "inputs": [{ "name": "pool", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawFunds",
    "inputs": [
      { "name": "organizer", "type": "address", "internalType": "address" },
      { "name": "poolId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const;

// MockIDRX ABI - ERC20 token with faucet
export const MockIDRXABI = [
  { "type": "constructor", "inputs": [], "stateMutability": "nonpayable" },
  {
    "type": "function",
    "name": "ADMIN_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DEFAULT_ADMIN_ROLE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "FAUCET_AMOUNT",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "FAUCET_COOLDOWN",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "adminMint",
    "inputs": [
      { "name": "to", "type": "address", "internalType": "address" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "allowance",
    "inputs": [
      { "name": "owner", "type": "address", "internalType": "address" },
      { "name": "spender", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      { "name": "spender", "type": "address", "internalType": "address" },
      { "name": "value", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{ "name": "account", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "canClaimFaucet",
    "inputs": [{ "name": "user", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "decimals",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint8", "internalType": "uint8" }],
    "stateMutability": "view"
  },
  { "type": "function", "name": "faucet", "inputs": [], "outputs": [], "stateMutability": "nonpayable" },
  {
    "type": "function",
    "name": "name",
    "inputs": [],
    "outputs": [{ "name": "", "type": "string", "internalType": "string" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "symbol",
    "inputs": [],
    "outputs": [{ "name": "", "type": "string", "internalType": "string" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "timeUntilNextClaim",
    "inputs": [{ "name": "user", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalSupply",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transfer",
    "inputs": [
      { "name": "to", "type": "address", "internalType": "address" },
      { "name": "value", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferFrom",
    "inputs": [
      { "name": "from", "type": "address", "internalType": "address" },
      { "name": "to", "type": "address", "internalType": "address" },
      { "name": "value", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "FaucetClaimed",
    "inputs": [
      { "name": "user", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "nextClaimTime", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      { "name": "from", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "to", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "value", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  }
] as const;

// VotingToken ABI - Tiered Voting NFT (vZKT)
export const VotingTokenABI = [
  { "type": "constructor", "inputs": [], "stateMutability": "nonpayable" },
  {
    "type": "function",
    "name": "autoUpgradeTier",
    "inputs": [{ "name": "voter", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{ "name": "owner", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "canVote",
    "inputs": [{ "name": "voter", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getParticipationMetrics",
    "inputs": [{ "name": "voter", "type": "address", "internalType": "address" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct VotingNFT.VoterMetrics",
        "components": [
          { "name": "donationsCount", "type": "uint256", "internalType": "uint256" },
          { "name": "governanceVotes", "type": "uint256", "internalType": "uint256" },
          { "name": "firstDonationTimestamp", "type": "uint256", "internalType": "uint256" },
          { "name": "successfulProposals", "type": "uint256", "internalType": "uint256" },
          { "name": "campaignsParticipated", "type": "uint256", "internalType": "uint256" },
          { "name": "isVerified", "type": "bool", "internalType": "bool" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getTier",
    "inputs": [{ "name": "voter", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint8", "internalType": "enum VotingNFT.VotingTier" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getVotingPower",
    "inputs": [{ "name": "voter", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasVotingNFT",
    "inputs": [{ "name": "voter", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "mintVotingNFT",
    "inputs": [
      { "name": "to", "type": "address", "internalType": "address" },
      { "name": "metadataURI", "type": "string", "internalType": "string" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ownerOf",
    "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalSupply",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  }
] as const;

// DonationReceiptNFT ABI - Soulbound NFT for donation receipts
export const DonationReceiptNFTABI = [
  { "type": "constructor", "inputs": [], "stateMutability": "nonpayable" },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{ "name": "owner", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getDonorReceiptCount",
    "inputs": [{ "name": "donor", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getDonorReceipts",
    "inputs": [{ "name": "donor", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256[]", "internalType": "uint256[]" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "mint",
    "inputs": [
      { "name": "to", "type": "address", "internalType": "address" },
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" },
      { "name": "campaignTitle", "type": "string", "internalType": "string" },
      { "name": "campaignType", "type": "string", "internalType": "string" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ownerOf",
    "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tokenMetadata",
    "inputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      { "name": "poolId", "type": "uint256", "internalType": "uint256" },
      { "name": "donor", "type": "address", "internalType": "address" },
      { "name": "donationAmount", "type": "uint256", "internalType": "uint256" },
      { "name": "donatedAt", "type": "uint256", "internalType": "uint256" },
      { "name": "campaignTitle", "type": "string", "internalType": "string" },
      { "name": "campaignType", "type": "string", "internalType": "string" },
      { "name": "ipfsCID", "type": "string", "internalType": "string" },
      { "name": "isActive", "type": "bool", "internalType": "bool" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tokenURI",
    "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "string", "internalType": "string" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalSupply",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  }
] as const;

export const VotingManagerABI = [{"type":"constructor","inputs":[{"name":"_proposalManager","type":"address","internalType":"address"},{"name":"_votingNFT","type":"address","internalType":"address"}],"stateMutability":"nonpayable"},{"type":"function","name":"ADMIN_ROLE","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"DEFAULT_ADMIN_ROLE","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"castVote","inputs":[{"name":"voter","type":"address","internalType":"address"},{"name":"proposalId","type":"uint256","internalType":"uint256"},{"name":"support","type":"uint8","internalType":"uint8"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"finalizeCommunityVote","inputs":[{"name":"proposalId","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"nonpayable"},{"type":"function","name":"getRoleAdmin","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"grantRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"account","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"hasRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"account","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"hasVoted","inputs":[{"name":"","type":"uint256","internalType":"uint256"},{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"passThreshold","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"proposalManager","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract ProposalManager"}],"stateMutability":"view"},{"type":"function","name":"quorumPercentage","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"renounceRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"callerConfirmation","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"revokeRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"account","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"setPassThreshold","inputs":[{"name":"_passThreshold","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"setQuorumPercentage","inputs":[{"name":"_quorumPercentage","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"supportsInterface","inputs":[{"name":"interfaceId","type":"bytes4","internalType":"bytes4"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"votesAbstain","inputs":[{"name":"","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"votesAgainst","inputs":[{"name":"","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"votesFor","inputs":[{"name":"","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"votingNFT","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract VotingNFT"}],"stateMutability":"view"},{"type":"event","name":"RoleAdminChanged","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"previousAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"newAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"RoleGranted","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"RoleRevoked","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"VoteCast","inputs":[{"name":"proposalId","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"voter","type":"address","indexed":true,"internalType":"address"},{"name":"support","type":"uint8","indexed":false,"internalType":"uint8"},{"name":"weight","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"VotingPeriodEnded","inputs":[{"name":"proposalId","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"passed","type":"bool","indexed":false,"internalType":"bool"},{"name":"forVotes","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"againstVotes","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"error","name":"AccessControlBadConfirmation","inputs":[]},{"type":"error","name":"AccessControlUnauthorizedAccount","inputs":[{"name":"account","type":"address","internalType":"address"},{"name":"neededRole","type":"bytes32","internalType":"bytes32"}]}] as const;

// Helper functions for formatting blockchain data
export function formatIDRX(amount: bigint): string {
  const value = Number(amount) / 1e18;
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

export function parseIDRX(amount: number): bigint {
  return BigInt(Math.floor(amount * 1e18));
}

export function formatAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString("id-ID", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAmount(amount: bigint, decimals: number = 18): string {
  const value = Number(amount) / Math.pow(10, decimals);
  return value.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

export function parseAmount(
  amount: string | number,
  decimals: number = 18,
): bigint {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return BigInt(Math.floor(num * Math.pow(10, decimals)));
}

// Zakat-specific helper functions

/**
 * Format time remaining for Zakat pool withdrawal
 * @param remainingSeconds Remaining time in seconds
 * @returns Formatted string like "25 days remaining" or "2 hours remaining"
 */
export function formatTimeRemaining(remainingSeconds: number | bigint): string {
  const seconds = Number(remainingSeconds);
  if (seconds <= 0) return "Expired";

  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);

  if (days > 0) {
    return `${days} day${days !== 1 ? "s" : ""} remaining`;
  } else if (hours > 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""} remaining`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? "s" : ""} remaining`;
  }
  return "Less than a minute remaining";
}

/**
 * Get Zakat pool status display information
 * @param status Pool status from contract
 * @param inGracePeriod Whether pool is in grace period
 * @param canRedistribute Whether pool can be redistributed
 * @returns Status display info
 */
export function getZakatPoolStatusInfo(
  status: number,
  inGracePeriod: boolean,
  canRedistribute: boolean,
): {
  label: string;
  variant: "default" | "warning" | "danger" | "success";
  description: string;
} {
  // PoolStatus enum: Active=0, GracePeriod=1, Redistributed=2, Completed=3
  if (status === 3) {
    return {
      label: "Completed",
      variant: "success",
      description: "Funds have been successfully distributed by the organizer.",
    };
  }

  if (status === 2) {
    return {
      label: "Redistributed",
      variant: "danger",
      description: "Funds were redistributed to an approved fallback pool.",
    };
  }

  if (inGracePeriod || status === 1) {
    return {
      label: "Grace Period",
      variant: "warning",
      description:
        "Withdrawal period has ended. Sharia council may grant extension or funds will be redistributed.",
    };
  }

  if (canRedistribute) {
    return {
      label: "Ready for Redistribution",
      variant: "danger",
      description:
        "Grace period has ended. Anyone can trigger redistribution to fallback pool.",
    };
  }

  return {
    label: "Active",
    variant: "default",
    description:
      "Organizer can withdraw funds within the 30-day Zakat distribution period.",
  };
}

/**
 * Calculate deadline from creation timestamp for Zakat pools
 * @param createdAt Pool creation timestamp
 * @param extensionUsed Whether extension was granted
 * @returns Deadline timestamp
 */
export function calculateZakatDeadline(
  createdAt: number,
  extensionUsed: boolean,
): number {
  const ZAKAT_PERIOD = 30 * 24 * 60 * 60; // 30 days in seconds
  const EXTENSION_DURATION = 14 * 24 * 60 * 60; // 14 days in seconds

  let deadline = createdAt + ZAKAT_PERIOD;
  if (extensionUsed) {
    deadline += EXTENSION_DURATION;
  }
  return deadline;
}

/**
 * Calculate grace period end timestamp
 * @param deadline Deadline timestamp
 * @returns Grace period end timestamp
 */
export function calculateGracePeriodEnd(deadline: number): number {
  const GRACE_PERIOD = 7 * 24 * 60 * 60; // 7 days in seconds
  return deadline + GRACE_PERIOD;
}

// ── ShariaReviewManager ABI ──
export const ShariaReviewManagerABI = [
  {
    "type": "function",
    "name": "bundleCount",
    "inputs": [],
    "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "shariaBundles",
    "inputs": [{"name": "bundleId", "type": "uint256", "internalType": "uint256"}],
    "outputs": [
      {"name": "bundleId", "type": "uint256", "internalType": "uint256"},
      {"name": "submittedAt", "type": "uint256", "internalType": "uint256"},
      {"name": "finalized", "type": "bool", "internalType": "bool"},
      {"name": "approvalCount", "type": "uint256", "internalType": "uint256"}
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "shariaQuorumRequired",
    "inputs": [],
    "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasVerifiedProof",
    "inputs": [
      {"name": "bundleId", "type": "uint256", "internalType": "uint256"},
      {"name": "proposalId", "type": "uint256", "internalType": "uint256"}
    ],
    "outputs": [{"name": "verified", "type": "bool", "internalType": "bool"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getProofApprovalCount",
    "inputs": [
      {"name": "bundleId", "type": "uint256", "internalType": "uint256"},
      {"name": "proposalId", "type": "uint256", "internalType": "uint256"}
    ],
    "outputs": [{"name": "count", "type": "uint256", "internalType": "uint256"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "checkAndCreateBundle",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createShariaReviewBundle",
    "inputs": [{"name": "proposalIds", "type": "uint256[]", "internalType": "uint256[]"}],
    "outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reviewProposal",
    "inputs": [
      {"name": "reviewer", "type": "address", "internalType": "address"},
      {"name": "bundleId", "type": "uint256", "internalType": "uint256"},
      {"name": "proposalId", "type": "uint256", "internalType": "uint256"},
      {"name": "approved", "type": "bool", "internalType": "bool"},
      {"name": "campaignType", "type": "uint8", "internalType": "uint8"},
      {"name": "zkReviewProof", "type": "bytes32", "internalType": "bytes32"}
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeShariaBundle",
    "inputs": [{"name": "bundleId", "type": "uint256", "internalType": "uint256"}],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const;

/**
 * Check if timestamp is within warning period (5 days before deadline)
 * @param remainingSeconds Remaining time in seconds
 * @returns True if in warning period
 */
export function isInWarningPeriod(remainingSeconds: number | bigint): boolean {
  const WARNING_PERIOD = 5 * 24 * 60 * 60; // 5 days in seconds
  const seconds = Number(remainingSeconds);
  return seconds > 0 && seconds <= WARNING_PERIOD;
}