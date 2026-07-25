# Demo Data Population Guide

This guide explains how to populate your deployed ZKT DAO with demo campaigns for testing and demonstration purposes.

## Quick Start

### 1. Update Contract Addresses

Edit `script/PopulateDemoData.s.sol` and update these addresses with your deployed contracts:

```solidity
address constant ZKT_CORE = 0x7C206211F6cEB66e494515F436fB91175d390893;
address constant MOCK_IDRX = 0x06317B6009e39Dbcd49d6654e08363FDC17e88a9;
address constant VOTING_NFT = 0xA7Ff9FD09eD70c174Ae9CB580FB6b31325869a05;
```

### 2. Run the Script

```bash
# From the sc/ directory
forge script script/PopulateDemoData.s.sol:PopulateDemoData \
  --rpc-url sepolia \
  --account <your-account-name> \
  --sender <your-address> \
  --broadcast \
  -vvvv
```

**Alternative:** Using private key:
```bash
forge script script/PopulateDemoData.s.sol:PopulateDemoData \
  --rpc-url https://ethereum-sepolia.publicnode.com \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### 3. What Gets Created

The script creates 4 demo proposals in different achievable states:

| Proposal | Title | Type | Initial Status | Features |
|----------|-------|------|----------------|----------|
| 2 | Build Water Wells | Normal | **Active Voting** | KYC verified, voting live |
| 3 | Food Aid for Families | Zakat | **Active Voting** | Zakat-compliant, voting live |
| 4 | Build School | Normal | Draft (KYC Pending) | **Has 3 milestones** |
| 5 | Medical Supplies | Emergency | **Active Voting** | Emergency (KYC auto-bypassed) |

**Note:** Proposal IDs start from wherever your current `proposalCount` is. If you already have proposals, the new IDs will be sequential.

### 4. What Happens

The script will:
- ✅ Create 4 different campaign proposals
- ✅ Verify KYC for non-emergency campaigns
- ✅ Submit 3 proposals for community voting
- ✅ Leave 1 proposal in Draft state (with milestones for demo)

## Testing the Frontend

After running the script, you can test these features:

### Governance Page (`/governance`)
- View all 5 proposals
- Vote on active proposals (IDs: 1, 3, 4)
- See proposal details and voting stats
- Check real-time vote counts from VotingManager

### Campaign Page (`/campaigns`)
- Browse proposed campaigns
- Filter by status (Active, Draft, etc.)
- View milestone breakdown (Proposal 2)

### Voting
1. Go to `/governance`
2. Find an active proposal (status: "Active Voting")
3. Click "Vote For", "Against", or "Abstain"
4. Confirm transaction in wallet
5. See your "Voted" badge appear

### Donations
*Note: Requires campaigns to have pools created (status: PoolCreated)*

1. Create a pool for an approved proposal:
   ```bash
   cast send $ZKT_CORE "createCampaignPool(uint256)" <proposalId> \
     --rpc-url sepolia \
     --private-key $PRIVATE_KEY
   ```

2. Approve IDRX spending:
   ```bash
   cast send $MOCK_IDRX "approve(address,uint256)" $ZKT_CORE 10000000000000000000000 \
     --rpc-url sepolia \
     --private-key $PRIVATE_KEY
   ```

3. Make a donation:
   ```bash
   cast send $ZKT_CORE "donate(uint256,uint256,string)" <poolId> 5000000000000000000000 "ipfs://QmProof" \
     --rpc-url sepolia \
     --private-key $PRIVATE_KEY
   ```

## Next Steps After Running Script

After the script completes, you can:

1. **Vote on Active Proposals:**
   - Go to `/governance` page in your frontend
   - Connect your wallet
   - Vote on proposals 2, 3, or 5
   - Each requires vZKT/VotingNFT to vote

2. **Wait for Voting Period (7 days):**
   - Voting periods last 7 days by default
   - You can finalize after the period ends
   - Use `dao.finalizeCommunityVote(proposalId)`

3. **Complete Approval Flow:**
   - After voting: Create Sharia review bundle
   - Sharia council reviews and approves
   - Create campaign pool
   - Start accepting donations

## Troubleshooting

### Error: "Voting period still active"
- This is expected! Voting periods are 7 days by default
- Proposals will stay in "Active Voting" status until finalized
- You can still vote and test the UI

### Error: "Already voted"
- Your address has already voted on this proposal
- Check the `hasVoted` mapping in VotingManager
- Use a different wallet address for more votes

### Error: "No voting power"
- Make sure you have a VotingNFT
- The script should mint one automatically
- Check your balance: `cast call $VOTING_NFT "balanceOf(address)" <your-address>`

### Error: "Insufficient IDRX balance"
- The script mints 1M IDRX automatically
- Check your balance: `cast call $MOCK_IDRX "balanceOf(address)" <your-address>`
- Mint more if needed: `cast send $MOCK_IDRX "mint(address,uint256)" <your-address> 1000000000000000000000000`

## Clean Up

To reset and repopulate:

1. Redeploy all contracts (see `script/DeployZKT.s.sol`)
2. Update contract addresses in the demo script
3. Run the demo script again

## Environment Variables

Set these in your `.env` file:

```bash
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com
PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

Load with:
```bash
source .env
```

## Useful Commands

Check proposal count:
```bash
cast call $ZKT_CORE "proposalCount()" --rpc-url sepolia
```

Get proposal details:
```bash
cast call $ZKT_CORE "getProposal(uint256)" 0 --rpc-url sepolia
```

Check voting power:
```bash
cast call $VOTING_NFT "getVotingPower(address)" <your-address> --rpc-url sepolia
```

Check has voted:
```bash
cast call $VOTING_MANAGER "hasVoted(uint256,address)" 1 <your-address> --rpc-url sepolia
```

## Need Help?

- Check the main README: `../README.md`
- Review test files: `test/ZKTCore.t.sol`
- Check deployment script: `script/DeployZKT.s.sol`
