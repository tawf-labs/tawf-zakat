# ZKT: Zero-Knowledge Zakat

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.31-blue.svg)](https://soliditylang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.1.1-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Noir](https://img.shields.io/badge/Noir-1.0.0--beta.21-purple.svg)](https://noir-lang.org/)

Privacy-preserving zakat donations using UltraHONK zero-knowledge proofs on Ethereum Sepolia. Donors contribute zakat with cryptographic anonymity while maintaining verifiable Sharia compliance and institutional accountability.

> **⚠️ ZK verification status — read before evaluating this repo.**
> The circuits are real, compile, and produce valid proofs off-chain. **On-chain
> proof verification is not deployed.** The deployed `HonkVerifier` is a
> fail-closed stub returning `false`, so `donateZK` / `donateZKPrivate` revert;
> `Groth16Verifier` is likewise a fail-closed placeholder. The blocker is code
> size: the Barretenberg-generated verifier is 33,880 bytes of deployed
> bytecode against the EIP-170 limit of 24,576, so it cannot be deployed as a
> single contract. Donations work; the ZK privacy tier does not yet.
> See `sc/src/DAO/verifiers/HonkVerifier.sol` and `security-analysis-corrections.md`.

- **Testnet**: [ziswaf.tawf.foundation](https://ziswaf.tawf.foundation)
- **Live Sepolia Protocol Contract**: [`0x72b60a0C37a78dF62295F88294E790083089f665`](https://sepolia.etherscan.io/address/0x72b60a0C37a78dF62295F88294E790083089f665)
- **Circle Sepolia USDC**: [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)
- **Paper**: `zk-private-zakat.pdf` (IEEE ICIMTech 2026, 6 pages, 33 references)
- **Authors**: Muhammad Zidan Fatonie, Alexander Agung Santoso Gunawan (BINUS University)

---

## Deployed Contracts (Ethereum Sepolia Testnet)

| Contract | Address | Explorer Link |
| :--- | :--- | :--- |
| **ZakatProtocolL1** | `0x72b60a0C37a78dF62295F88294E790083089f665` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x72b60a0C37a78dF62295F88294E790083089f665) |
| **Circle USDC (Sepolia)** | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) |
| **Deployer / Admin / Relayer** | `0x5e9B652C4E8a013f6fAb69F0b55377c408B59968` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x5e9B652C4E8a013f6fAb69F0b55377c408B59968) |

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Deployed Contracts (Sepolia)](#deployed-contracts-sepolia)
- [Quick Start](#quick-start)
- [Circuit Performance](#circuit-performance)
- [Project Structure](#project-structure)
- [Smart Contract Architecture](#smart-contract-architecture)
- [ZK Pipeline](#zk-pipeline)
- [Frontend Features](#frontend-features)
- [Testing](#testing)
- [Benchmarks](#benchmarks)
- [Paper](#paper)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Overview

ZKT addresses a critical gap in blockchain-based zakat systems: all existing platforms expose complete donor-recipient transaction records on public ledgers, violating Islamic principles of dignity preservation (nafs protection in maqasid al-shariah).

**Key features:**
- **Noir circuit** (29 ACIR opcodes) encoding nisab + hawl + pedersen nullifier verification
- **UltraHONK proofs** generated via Barretenberg v5.0.0-nightly (270ms avg), off-chain
- **On-chain verification is NOT live** — see the status note below
- **Solidity contracts** deployed on Ethereum Sepolia testnet (chain 11155111)
- **Next.js 16** frontend with wagmi/XellarKit wallet connectivity
- **Privacy tier toggle** supporting Public and Private donation modes

## Architecture

```
Donor Frontend (Next.js 16 + wagmi/XellarKit)
    │  wallet connect, tier select, private inputs
    ▼
Off-Chain Proving (Noir + Barretenberg v5.0.0-nightly)
    │  nargo compile → nargo execute → bb prove UltraHONK
    │  29 ACIR opcodes, 270ms avg prove, 10ms avg verify, 8,384 bytes proof
    ▼
Ethereum Sepolia (Solidity contracts)
    │  ZKTCore.donate() → PoolManager.donate()
    │  → DonationReceiptNFT.mint() → receipt SBT to donor
    ▼
Donor receives soulbound NFT receipt (proof of zakat payment)
```

The intended ZK path — `HonkVerifier.verify() → ZKTCore.donateZK() →
NullifierRegistry.spend()` — is wired end to end in code but **inert**: the
deployed verifier returns `false`, so `donateZK` reverts. Only the public
donation path above is functional today.

## Deployed Contracts (Ethereum Sepolia, chain 11155111)

V10 deployment. These are the addresses the frontend actually uses — they match
`fe/lib/abi.ts` and `sc/broadcast/V10Deploy.s.sol/11155111/run-latest.json`.
(The table here previously listed V9 addresses, none of which the app used.)

**ZK layer** — redeployed by `sc/script/V10Deploy.s.sol`:

Redeployed 2026-07-26 at block 11350675 (tx `0xef7cd594…` for ZKTCore).

| Contract | Address |
|----------|---------|
| ZKTCore | `0x28Eb1b95dFf00B2f876eaE24024B4e501710A287` |
| ShariaReviewManager | `0x3A968cDc9CFC2f3aDFab4733415943E12B72a953` |
| PrivateDonationPool | `0xe8908AD46ecC4A7F7e0e634BEB0e696bd497c846` |
| HonkVerifier | `0x1696c9e54c425760cF0E46181CE91A57A0ca8369` |
| Groth16Verifier | `0x7702B20B7302A82E3Cb09aAe7A72bb19A2d5Db84` |
| NullifierRegistry | `0x49a8C624c52A6A3F88Cc0073834dEf9b11326B56` |

Both verifiers report `isOperational() == false` and reject every proof.

**DAO layer (tawf-gov)** — deployed separately, unchanged by ZK-layer redeploys:

| Contract | Address |
|----------|---------|
| TawfPassport | `0x68A39923A1b80F3d48B4bd60FBe4187Ff2B0a38e` |
| TawfReputation | `0xEBc9637933575Aa3b047Dc19C4dE3706F03DC32c` |
| MockIDRX | `0x23A48A17ea36627ACF4Ce349C14d17c7e7F90BCE` |
| VotingNFT | `0xEb44b1409F34944cd137DD522e8FE9dD41533D33` |
| DonationReceiptNFT | `0x536a7249113E2f2c06a6E85acDa9B54dc79F5e58` |
| ProposalManager | `0x37f87a1913a8efAE70a39850f8c9e2C63AeC556B` |
| VotingManager | `0x4B6600f35592A83770A610a038c012186471143a` |
| MilestoneManager | `0xb0Fa6d4a2038ed85c9d16664BeeD169858D5f183` |
| ParticipationTracker | `0xA2313195cB23cC0AeB28E94f43DFBE0Fdc3d2e37` |
| PoolManager | `0x10bE98A362c18d690BEd51069F8D0c847cf2092A` |
| ZakatEscrowManager | `0x3534105fD0338dAF5Faa0BC97c760Fe861bd052e` |

Public donations are verified working end to end on Sepolia. The `donateZK`
benchmark recorded in `benchmarks/sepolia-donatezk-gas.txt` ran against the V9
`ZKVerifier`, which accepted any input without a pairing check — that
transaction is real but proves nothing cryptographically.

## Quick Start

### Prerequisites

- Node.js v22+, pnpm
- Foundry (forge + cast)
- Noir/nargo v1.0.0-beta.21+

### Frontend

```bash
cd fe
pnpm install
pnpm dev       # http://localhost:3000
pnpm build     # production build
```

### Smart Contracts

```bash
cd sc
forge build
forge test      # 44 tests passing
```

### ZK Circuit

```bash
cd noir-circuits/zkat_eligibility
nargo test      # 3 tests passing
nargo compile   # compile to ACIR
nargo execute   # generate witness
```

## Circuit Performance

All benchmarks run on a 16-core Linux machine with Barretenberg v5.0.0-nightly.

| Metric | Value |
|--------|-------|
| ACIR opcodes | 29 |
| Brillig opcodes | 44 |
| Expression width | 4 (Bounded) |
| Proof generation (avg) | 270 ms |
| Proof generation (min) | 239.0 ms |
| Proof generation (max) | 263.0 ms |
| Proof verification (avg) | 10 ms |
| Proof size | 8,384 bytes |
| Verification key size | 1,888 bytes |

On-chain gas consumption (Foundry gas report):

| Function | Gas (avg) |
|----------|-----------|
| `ZKTCore.donate()` | 490,187 |
| `ZKTCore.donateZK()` (e2e) | 721,345 |
| `ZKTCore.castVote()` | 132,909 |
| `ZKTCore.deploy` | 5,538,881 |
| `ZakatEscrowManager.donate()` | 30,884 |

## Project Structure

```
├── fe/                           # Next.js 16 frontend
│   ├── app/                      # App router pages (campaigns, zakat, dashboard, dao)
│   ├── components/
│   │   ├── donations/            # DonationDialog (public + private toggle)
│   │   ├── providers/            # Web3Provider (wagmi + XellarKit)
│   │   ├── shared/               # CampaignCard, ZakatCertificateModal
│   │   └── ui/                   # shadcn/ui components
│   ├── hooks/
│   │   ├── usePrivateDonation.ts # ZK donation pipeline
│   │   └── useWallet.ts          # Wallet state + donate()
│   └── lib/
│       ├── abi.ts                # All 16 contract addresses + ABIs
│   └── aztec-private-donation.ts  # Proof generation pipeline
│
├── sc/                           # Solidity smart contracts
│   ├── src/DAO/
│   │   ├── ZKTCore.sol           # Main orchestrator (v8, donateZK, donate, castVote)
│   │   ├── NullifierRegistry.sol # Nullifier tracking for double-donation prevention
│   │   ├── core/                 # ProposalManager, VotingManager, ShariaReviewManager,
│   │   │                          PoolManager, ZakatEscrowManager, MilestoneManager
│   │   └── verifiers/
│   │       └── HonkVerifier.sol  # IHonkVerifier interface
│   ├── src/tokens/               # MockIDRX, DonationReceiptNFT, VotingNFT, OrganizerNFT
│   ├── src/participants/         # ParticipationTracker
│   ├── script/
│   │   ├── DeployZKT.s.sol       # Full deployment script (16 contracts)
│   │   └── GenerateZKProof.mjs   # Off-chain proof generator
│   └── test/                     # Foundry tests (26 passing)
│
├── noir-circuits/
│   └── zkat_eligibility/         # Noir circuit (nisab + hawl + pedersen nullifier)
│
├── docs/diagrams/                # PlantUML sources + generated PNGs (6 diagrams)
├── benchmarks/                   # UltraHONK prove/verify logs, Forge gas reports
│
├── zk-private-zakat.tex          # IEEE conference paper (ICIMTech 2026)
└── zk-private-zakat.pdf          # Compiled PDF (6 pages, 33 references)
```

## Smart Contract Architecture

The system follows a modular architecture with ZKTCore as the central orchestrator:

```
ZKTCore (v8)
  ├── ZKVerifier           # verifies UltraHONK proofs (hash anchoring)
  ├── NullifierRegistry    # prevents double-donation (flat mapping)
  ├── ZakatEscrowManager   # fund custody + pool accounting (30-day timelock)
  ├── DonationReceiptNFT   # soulbound receipt SBT (IPFS metadata)
  ├── ProposalManager      # community proposal lifecycle
  ├── VotingManager        # tiered voting (VotingNFT-based)
  ├── ShariaReviewManager  # Sharia council review (Groth16 verifier)
  ├── PoolManager          # general donation pools
  └── MilestoneManager     # milestone-based fund release
```

**Access control**: Role-based (OpenZeppelin AccessControl) with ORGANIZER_ROLE, SHARIA_COUNCIL_ROLE, KYC_ORACLE_ROLE, and MINTER_ROLE.

**v8 E2E Flow** (all executed on-chain):
`createProposal → submitForCommunityVote → castVote → finalizeCommunityVote → createShariaReviewBundle → reviewProposal → finalizeShariaBundle → createCampaignPool → donateZK()`

## ZK Pipeline

The private donation flow:

```
1. Donor connects wallet (wagmi + XellarKit, Sepolia)
2. Selects privacy tier (Public/Private)
3. Provides amount + private eligibility inputs
4. Frontend calls /api/generate-proof → nargo execute → bb prove
5. UltraHONK proof generated (270ms avg, 8,384 bytes)
6. ZKTCore.donateZK() on Sepolia:
   → ZKVerifier.verify() → true
   → NullifierRegistry.spend() → nullifier marked spent
   → ZakatEscrowManager.donate() → fund transfer + pool accounting
   → DonationReceiptNFT.mint() → soulbound receipt SBT
7. Donor receives SBT receipt (proof of zakat payment)
```

## Frontend Features

- **Wallet connection**: wagmi + XellarKit (multi-wallet support)
- **Privacy tier toggle**: Public / Private switch with contextual notices
- **Quick amount buttons**: 10K, 50K, 100K, 500K IDRX
- **Campaign browsing**: Browse active zakat campaigns
- **Donation flow**: Two-step approval (IDRX.approve → ZKTCore.donate)
- **Certificate modal**: ZakatCertificateModal after successful donation
- **Dashboard**: Donor and organizer dashboards with transaction history
- **Chain enforcement**: Auto-switch to Sepolia with UI warning

## Testing

### Solidity (Foundry)

```bash
cd sc
forge test          # 44 tests passing
forge test --gas-report # full gas report
```

Key test suites:
- `ZKTCoreTest` — 11 tests (donation flow, voting, milestone management)
- `ShariaZKProofTest` — 22 tests (ZK proof submission, quorum verification, forgery regression)
- `CoreTeam.t.sol` — 8 tests (role management, access control)
- `TawfPassport.t.sol` — 3 tests (passport issuance)

### Noir Circuit

```bash
cd noir-circuits/zkat_eligibility
nargo test          # 3 tests (eligible, ineligible, hawl met)
```

### Frontend

```bash
cd fe
pnpm build          # production build verification
```

## Benchmarks

All benchmark logs are in `benchmarks/`:

| File | Content |
|------|---------|
| `ultrahonk-*.log` | 5 prove runs + 5 verify runs with timings |
| `forge-gas-*.log` | Complete Foundry gas report |
| `sepolia-donatezk-gas.txt` | Actual Sepolia tx gas used |

## Paper

The IEEE conference paper is at `zk-private-zakat.pdf` (6 pages, 33 references).

**Conference**: ICIMTech 2026 (International Conference on Information Management and Technology)

**Scope**: Blockchain Technologies and Fintech

**Section structure**: Introduction, Literature Review, Methodology, Results, Discussion, Conclusion

## Acknowledgments

- **pidi.id** — hackathon organizer
- **BINUS University** — Research Track program
- **Ethereum Jakarta** — technical support and guidance
- **Tawf Labs** — sharia consultation and research implementation

## License

Apache-2.0
