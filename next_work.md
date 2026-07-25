<!--
  ⚠️ OUTDATED — This document was generated 2026-01-26, before the V10 ZK-layer
  redeploy (2026-07-26, block 11350675). Contract addresses, test counts, and
  architecture descriptions below reflect the V9 state. See README.md for
  current addresses and fe/lib/abi.ts for the contracts the frontend uses.
-->
# zkt.app Analysis & Next Steps Document

## Executive Summary

The zkt.app project is a **ZK Zakat donation platform** built on Ethereum Sepolia testnet. It combines smart contracts with a Next.js frontend to enable transparent, verifiable charitable donations with dual governance (community + Sharia council) and NFT donation receipts.

**Current Status: ~70% Complete**

The project has a solid foundation with deployed contracts and a functional frontend, but several key vision features are missing or incomplete.

---

## Part 1: What Is Implemented

### Smart Contracts (100% Complete & Deployed)

All contracts are deployed on **Ethereum Sepolia Testnet** (chain 11155111) and verified:

| Contract | Address | Purpose |
|----------|---------|---------|
| **ZKTCore** | `0xacc7d3d90ba0e06dfa3ddd702214ed521726efdd` | Main orchestrator |
| **MockIDRX** | `0xb3970735048e6db24028eb383d458e16637cbc7a` | Test ERC20 token with faucet |
| **DonationReceiptNFT** | `0x3d40bad0a1ac627d59bc142ded202e08e002b6a7` | Soulbound NFT receipts |
| **VotingToken** | `0x4461b304f0ce2a879c375ea9e5124be8bc73522d` | Non-transferable governance token |

#### Core Contract Features:
1. **ZKTCore.sol** - Modular orchestrator with role-based access control
2. **ProposalManager.sol** - Campaign proposal lifecycle management
3. **VotingManager.sol** - Community voting with vZKT tokens (10% quorum, 51% threshold)
4. **ShariaReviewManager.sol** - Sharia council approval with bundle-based reviews
5. **PoolManager.sol** - Campaign pools and donation processing

### Frontend (75% Complete)

**Tech Stack:**
- Next.js 15.2.4 with App Router
- TypeScript, Tailwind CSS v4
- viem/wagmi for blockchain integration
- XellarKit for multi-wallet support

#### Implemented Pages:

| Page | Route | Status |
|------|-------|--------|
| Home | `/` | Complete |
| Campaign Explorer | `/campaigns` | Complete |
| Campaign Detail | `/campaigns/[id]` | Partial (milestones mocked) |
| Create Campaign | `/campaigns/new` | Complete |
| Donor Dashboard | `/dashboard/donor` | Complete |
| Organization Dashboard | `/dashboard/organization` | Partial |
| Auditor Dashboard | `/dashboard/auditor` | Partial (KYC mocked) |
| Governance | `/governance` | Complete |
| Zakat Calculator | `/zakat` | Complete (live gold price API) |
| Faucet | `/faucet` | Complete |
| Explorer | `/explorer` | Complete |

#### Wallet Support:
- MetaMask, WalletConnect, Coinbase Wallet, Safe (multisig)
- Indonesian language interface
- Dark/light theme support

---

## Part 2: What Is Missing from Vision

### Critical Gaps

#### 1. Tranche-Based Funding (MISSING)

**Vision:** Funds released in milestones with NFT holder approval after each tranche.

**Reality:** `PoolManager.withdrawFunds()` (line 198-214) releases **ALL funds at once**:

```solidity
function withdrawFunds(address organizer, uint256 poolId) external nonReentrant {
    // ...
    pool.fundsWithdrawn = true;
    uint256 amount = pool.raisedAmount;  // ENTIRE balance
    require(idrxToken.transfer(organizer, amount), "Transfer failed");
}
```

**Impact:** High risk - organizers receive all funds upfront with no accountability.

**Required:**
- New `MilestonesManager` contract
- Per-milestone voting by NFT holders
- Time-locked fund releases

---

#### 2. Emergency Vault System (MISSING)

**Vision:** Dedicated reserve contract for disaster relief with rapid deployment.

**Reality:** Only exists as `isEmergency` boolean flag in proposals (line 49, ProposalManager.sol).

**Required:**
- New `EmergencyVault` contract
- Separate fund pool for instant disbursement
- Multi-sig approval for emergencies

---

#### 3. Real ZK-KYC (MOCKED)

**Vision:** Zero-knowledge proofs for identity verification.

**Reality:** All proofs are mocked:

```solidity
// ProposalManager.sol line 32
bytes32 mockZKKYCProof  // Just a placeholder!

// ShariaReviewManager.sol line 132
bytes32 mockZKReviewProof  // Also fake!
```

**Frontend also mocks:** `components/donations/donation-dialog.tsx` uses random hashes.

**Required:**
- Noir/Circom ZK circuits
- Prover client integration
- Verifier contract deployment

---

#### 4. True Private Donations (PARTIAL)

**Vision:** Anonymous donations using Pedersen commitments.

**Reality:** `PoolManager.donatePrivate()` exists (line 157-196) but:
- Donor address still tracked: `poolDonations[poolId][donor] += amount;`
- Only commitment is stored, but linkability remains

**Privacy leak:** The `donor` parameter is publicly logged in events and stored in mappings.

---

#### 5. NFT Governance Power (MISSING)

**Vision:** NFT holders govern fund releases.

**Reality:** Governance uses separate `VotingToken` (vZKT), not donation NFTs.

**Architecture conflict:**
- `VotingManager` checks `votingToken.balanceOf(voter)`
- NFT receipts are soulbound and non-governance

---

### Minor Gaps

| Feature | Status | Notes |
|---------|--------|-------|
| IPFS metadata | Mock | Empty/placeholder URIs |
| Milestone tracking | Frontend only | No on-chain verification |
| Organization verification | Manual | No decentralized attestations |
| Real IDRX token | Mock | Needs real fiat-backed token |

---

## Part 3: File Structure Reference

### Smart Contract Files

```
sc/src/DAO/
├── ZKTCore.sol              # Main orchestrator
├── interfaces/
│   └── IProposalManager.sol # Enums + structs
└── core/
    ├── ProposalManager.sol       # Proposals, KYC status
    ├── VotingManager.sol         # Community voting
    ├── ShariaReviewManager.sol   # Sharia council review
    └── PoolManager.sol           # DONATIONS RELEASE ALL AT ONCE (line 198-214)

sc/src/tokens/
├── MockIDRX.sol             # Test token with faucet
├── DonationReceiptNFT.sol   # Soulbound receipts
└── VotingToken.sol          # Non-transferable governance

sc/script/
└── DeployZKT.s.sol          # Deployment script
```

### Frontend Files

```
fe/app/
├── page.tsx                     # Home
├── campaigns/
│   ├── page.tsx                # Explorer
│   ├── [id]/page.tsx           # Detail (milestones mocked at line 40-44)
│   └── new/page.tsx            # Create campaign
├── governance/page.tsx          # DAO voting
├── dashboard/
│   ├── donor/page.tsx
│   ├── organization/page.tsx
│   └── auditor/page.tsx         # KYC mocked
├── zakat/page.tsx               # Calculator
└── faucet/page.tsx              # Token faucet

fe/lib/
└── abi.ts                       # Contract ABIs + addresses (lines 4-9)

fe/components/
├── donations/
│   └── donation-dialog.tsx      # Real blockchain donations
└── campaigns/
    └── campaign-map.tsx         # Leaflet map
```

---

## Part 4: Prioritized Action Items

### Priority 1: Critical Security

1. **Implement Tranche-Based Funding**
   - Create `MilestonesManager.sol`
   - Add milestone voting logic
   - Time-locked withdrawals
   - Files: `sc/src/DAO/core/MilestonesManager.sol` (new)

2. **Fix Private Donation Privacy**
   - Remove donor address from public mappings in `PoolManager.sol`
   - Use nullifier/commitment scheme properly
   - Files: `sc/src/DAO/core/PoolManager.sol:182`

### Priority 2: Core Features

3. **Emergency Vault Contract**
   - Create `EmergencyVault.sol`
   - Fast-track approval for disasters
   - Files: `sc/src/DAO/core/EmergencyVault.sol` (new)

4. **Real ZK-KYC Integration**
   - Design Noir circuit for KYC
   - Deploy verifier contract
   - Integrate prover in frontend
   - Files: `circuits/kyc.nr`, `fe/lib/zk-kyc.ts` (new)

### Priority 3: Enhanced Governance

5. **NFT-Based Governance**
   - Modify `VotingManager.sol` to accept NFTs
   - Or create new `NFTVotingManager.sol`

6. **Organization Verification**
   - Decentralized attestations
   - Files: `sc/src/governance/AttestationManager.sol` (new)

### Priority 4: Polish

7. **IPFS Integration**
   - Real metadata uploads
   - Pinata/nft.storage integration
   - Files: `fe/lib/ipfs.ts` (new)

8. **Complete Dashboards**
   - Organization dashboard enhancements
   - Auditor dashboard with real KYC

---

## Part 5: Security Considerations

### Current Issues

1. **No Reentrancy on withdrawFunds** - Actually protected by `ReentrancyGuard` ✅
2. **Centralized roles** - Deployer has all roles initially
3. **No rate limiting on faucet** - Potential abuse
4. **Mock ZK proofs** - No real privacy

### Recommendations

1. Implement timelock for admin actions
2. Add pausable functionality
3. Consider multi-sig for critical roles
4. Audit before mainnet deployment

---

## Part 6: Deployment Checklist

### Pre-Mainnet

- [ ] Replace all mock ZK proofs with real circuits
- [ ] Implement tranche-based funding
- [ ] Add emergency vault
- [ ] Complete security audit
- [ ] Test on testnet with real users
- [ ] Deploy real IDRX token (fiat-backed)
- [ ] Set up IPFS for metadata
- [ ] Configure production monitoring
- [ ] Document API for third-party integrations

### Deployment Steps

```bash
# 1. Deploy to Base Mainnet
forge script script/DeployZKT.s.sol --rpc-url base_mainnet --broadcast --verify

# 2. Verify contracts
# 3. Grant initial roles
# 4. Configure governance parameters
# 5. Fund emergency vault
# 6. Update frontend addresses
```

---

## Part 7: Contract Quick Reference

### Key Functions

| Contract | Function | Purpose |
|----------|----------|---------|
| ZKTCore | `createProposal()` | Create campaign proposal |
| ZKTCore | `castVote()` | Vote on proposals |
| ZKTCore | `donate()` | Donate to pool |
| PoolManager | `withdrawFunds()` | **⚠️ Releases ALL funds** |
| DonationReceiptNFT | `getReceiptData()` | Get donation proof |

### Role Management

```solidity
// Grant roles
dao.grantOrganizerRole(address)
dao.grantVotingPower(address, amount)
dao.grantShariaCouncilRole(address)
dao.grantKYCOracleRole(address)
```

---

## Part 8: Frontend-Contract Data Flow

### Current API Routes

| Route | Purpose | Data Source |
|-------|---------|-------------|
| `GET /api/campaigns` | List campaigns | Blockchain (real) |
| `GET /api/campaigns/[id]` | Campaign details | Blockchain + mock milestones |
| `POST /api/campaigns` | Create campaign | Blockchain transaction |
| `POST /api/donate` | Process donation | Blockchain transaction |

### Mocked Data Areas

1. **Campaign Milestones** - `fe/app/campaigns/[id]/page.tsx` lines 40-44
2. **KYC Verification** - Auditor dashboard
3. **Donor Anonymization** - Shows "Anonymous Donor" but real addresses stored

---

## Conclusion

The zkt.app project demonstrates a sophisticated understanding of modular contract architecture and provides a solid foundation for a charitable donation platform. The smart contracts are well-structured and the frontend provides good user experience.

However, **critical vision features remain unimplemented**:
- Tranche-based funding (highest priority for security)
- Emergency vault
- Real ZK proofs
- True privacy for donations

The roadmap above prioritizes security and core functionality to bring the implementation in line with the original vision.

---

*Document generated: 2026-01-26*
*Contract addresses verified on Ethereum Sepolia (chain 11155111)*
*Analysis based on codebase exploration*
