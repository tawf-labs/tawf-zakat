// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.31;
import "forge-std/Script.sol";
import "../src/DAO/ZKTCore.sol";
import "@tawf-gov/tokens/MockIDRX.sol";
import "@tawf-gov/tokens/VotingNFT.sol";
import "@tawf-gov/interfaces/IProposalManager.sol";

/**
 * @title PopulateDemoData
 * @notice Script to populate the ZKT DAO with demo campaigns for testing
 * @dev Run with: forge script script/PopulateDemoData.s.sol --rpc-url sepolia --broadcast
 */
contract PopulateDemoData is Script {
    // Contract addresses (update these with your deployed addresses)
    address constant ZKT_CORE = 0x7C206211F6cEB66e494515F436fB91175d390893;
    address constant MOCK_IDRX = 0x06317B6009e39Dbcd49d6654e08363FDC17e88a9;
    address constant VOTING_NFT = 0xA7Ff9FD09eD70c174Ae9CB580FB6b31325869a05;

    ZKTCore public dao;
    MockIDRX public idrx;
    VotingNFT public votingNFT;

    function run() external {
        address deployer = msg.sender;
        console.log("Populating demo data with account:", deployer);

        vm.startBroadcast();

        // Load contracts
        dao = ZKTCore(ZKT_CORE);
        idrx = MockIDRX(MOCK_IDRX);
        votingNFT = VotingNFT(VOTING_NFT);

        // Create demo proposals
        console.log("\n3. Creating demo proposals...");

        // Proposal 1: Normal campaign - Active voting
        uint256 proposal1 = createProposal(
            "Build Water Wells in Rural Indonesia",
            "Provide clean water access to 5 villages in Central Java through construction of 10 deep wells with modern filtration systems.",
            50_000 * 10 ** 18,
            false, // Not emergency
            IProposalManager.CampaignType.Normal,
            new IProposalManager.MilestoneInput[](0) // No milestones
        );
        console.log("Created Proposal 1 (Normal - Active):", proposal1);

        // Proposal 2: Zakat campaign - Completed with pool
        uint256 proposal2 = createProposal(
            "Emergency Food Aid for Disaster Victims",
            "Distribute food packages to 1000 families affected by recent flooding in East Java. Zakat-compliant program.",
            30_000 * 10 ** 18,
            false,
            IProposalManager.CampaignType.ZakatCompliant,
            new IProposalManager.MilestoneInput[](0)
        );
        console.log(
            "Created Proposal 2 (Zakat - Will be completed):",
            proposal2
        );

        // Proposal 3: Normal campaign with milestones - PoolCreated
        IProposalManager.MilestoneInput[]
            memory milestones = new IProposalManager.MilestoneInput[](3);
        milestones[0] = IProposalManager.MilestoneInput({
            description: "Phase 1: Site survey and planning",
            targetAmount: 10_000 * 10 ** 18
        });
        milestones[1] = IProposalManager.MilestoneInput({
            description: "Phase 2: Construction of school building",
            targetAmount: 30_000 * 10 ** 18
        });
        milestones[2] = IProposalManager.MilestoneInput({
            description: "Phase 3: Furniture and equipment installation",
            targetAmount: 10_000 * 10 ** 18
        });

        uint256 proposal3 = createProposal(
            "Build School for Underprivileged Children",
            "Construct a 3-classroom school building with library and computer lab in rural Sumatra.",
            50_000 * 10 ** 18,
            false,
            IProposalManager.CampaignType.Normal,
            milestones
        );
        console.log("Created Proposal 3 (Normal with milestones):", proposal3);

        // Proposal 4: Emergency campaign - Active
        uint256 proposal4 = createProposal(
            "Emergency Medical Supplies",
            "Urgent: Purchase medical supplies and equipment for overwhelmed rural health clinics.",
            20_000 * 10 ** 18,
            true, // Emergency
            IProposalManager.CampaignType.Emergency,
            new IProposalManager.MilestoneInput[](0)
        );
        console.log("Created Proposal 4 (Emergency):", proposal4);

        // Proposal 5: Normal campaign that will be ready for Sharia review after voting ends
        uint256 proposal5 = createProposal(
            "Mosque Renovation Project",
            "Renovate and expand the community mosque to accommodate 500 worshippers. Includes structural repairs, new facilities, and modern amenities.",
            40_000 * 10 ** 18,
            false,
            IProposalManager.CampaignType.Normal,
            new IProposalManager.MilestoneInput[](0)
        );
        console.log(
            "Created Proposal 5 (Normal - will be voted on):",
            proposal5
        );

        // Process proposals to achievable states
        console.log("\n4. Processing proposals to demo states...");

        // Proposal 1: Submit for community vote (Normal campaign)
        dao.updateKYCStatus(
            proposal1,
            IProposalManager.KYCStatus.Verified,
            "KYC verified - demo data"
        );
        console.log("  -> KYC verified for proposal", proposal1);

        dao.submitForCommunityVote(proposal1);
        console.log("  -> Submitted for community vote:", proposal1);

        // Proposal 2: Submit for community vote (Zakat campaign)
        dao.updateKYCStatus(
            proposal2,
            IProposalManager.KYCStatus.Verified,
            "KYC verified - demo data"
        );
        dao.submitForCommunityVote(proposal2);
        console.log("  -> Zakat proposal in active voting:", proposal2);

        // Proposal 3: Leave in Draft state (with milestones for demo)
        console.log("  -> Milestone proposal left in Draft:", proposal3);

        // Proposal 4: Emergency - submit for vote (KYC auto-bypassed)
        dao.submitForCommunityVote(proposal4);
        console.log("  -> Emergency proposal in active voting:", proposal4);

        console.log("\n=== Demo Data Population Complete ===");
        console.log("Summary of created proposals:");
        console.log(
            "- Proposal",
            proposal1,
            ": Normal Campaign (Active Voting)"
        );
        console.log(
            "- Proposal",
            proposal2,
            ": Zakat Campaign (Active Voting)"
        );
        console.log(
            "- Proposal",
            proposal3,
            ": Milestone Campaign (Draft - pending KYC)"
        );
        console.log(
            "- Proposal",
            proposal4,
            ": Emergency Campaign (Active Voting)"
        );
        console.log("");
        console.log("Next steps:");
        console.log("1. Vote on active proposals in the governance UI");
        console.log("2. Wait 7 days for voting period to end");
        console.log("3. Finalize votes and proceed with Sharia review");
        console.log("4. Create pools for approved campaigns");

        vm.stopBroadcast();
    }

    function createProposal(
        string memory title,
        string memory description,
        uint256 fundingGoal,
        bool isEmergency,
        IProposalManager.CampaignType campaignType,
        IProposalManager.MilestoneInput[] memory milestones
    ) internal returns (uint256) {
        bytes32 mockProof = keccak256(abi.encodePacked(title, block.timestamp));
        string[] memory checklistItems = new string[](2);
        checklistItems[0] = "Recipients verified through local authorities";
        checklistItems[1] = "Transparent fund distribution plan prepared";

        string memory metadataURI = string(
            abi.encodePacked("ipfs://Qm", title)
        );

        uint256 proposalId = dao.createProposal(
            title,
            description,
            fundingGoal,
            isEmergency,
            mockProof,
            checklistItems,
            metadataURI,
            milestones
        );

        return proposalId;
    }
}
