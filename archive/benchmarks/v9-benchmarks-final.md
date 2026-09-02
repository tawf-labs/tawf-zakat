## V9 Benchmark Logs — May 17 2026 (00:20 UTC)

### Environment
| Metric | Value |
|--------|-------|
| Noir version | 1.0.0-beta.21 |
| Barretenberg version | 5.0.0-nightly.20260324 |
| Machine | 16-core Linux |
| Solidity version | 0.8.31 |
| Foundry optimizer | enabled, runs=1, via_ir=true |

### Circuit Performance (n=5)
| Metric | Value |
|--------|-------|
| ACIR opcodes | 29 |
| Brillig opcodes | 44 |
| Proof generation (avg) | 240 ms |
| Proof verification (avg) | 11 ms |
| Proof size | 8,384 bytes |
| Public inputs | 7 × 32 bytes (224 bytes) |
| Public input layout | [0]=nisab_threshold, [1]=current_time, [2]=recipient_address, [3]=cycle_id, [4]=expected_nullifier, [5]=nullifier, [6]=amountCommitment |

### Gas Consumption (Foundry Gas Report)
| Contract | Function | Gas (avg) |
|----------|----------|-----------|
| ZKTCore | donate() | 490,187 |
| ZKTCore | createCampaignPool() | 365,552 |
| ZKTCore | castVote() | 132,909 |
| ZKTCore | donateZK() (e2e) | 721,345 |
| ZKTCore | donateZKPrivate() (e2e) | 172,461 |
| ZKTCore | Deploy | 5,538,881 |
| ZakatEscrowMgr | Deploy | 3,069,194 |
| ShariaReviewMgr | Deploy | 2,114,319 |

### V9 Sepolia Deployment (ONCHAIN EXECUTION COMPLETE)
| # | Contract | Address |
|---|----------|---------|
| 1 | MockIDRX | 0x43d83af6ad5a4e4612bfa058a3dbc94c3ee163f6 |
| 2 | DonationReceiptNFT | 0xdc60887323c3555300f6aa9c153d92176fc5c3b0 |
| 3 | VotingNFT | 0xcea6733f1075423c463cd09b83e8c03d44ea0429 |
| 4 | OrganizerNFT | 0x7a78e1b18aab0acdcc820f7bcfadbf45bf184ead |
| 5 | ParticipationTracker | 0x7d9bc173bd517ef678d83ddbc32d0f8efe147608 |
| 6 | Groth16Verifier | 0x404d6df5aa44c9f7a668e23059459ca29f288afc |
| 7 | ZKVerifier | 0xC2c19e859DaD72D8DB8440355BF76C6dCEa3743d |
| 8 | NullifierRegistry | 0x87253C2aF1BB7FDA37D1DcaEEFD27E5C26C60717 |
| 9 | ProposalManager | 0x358CF3C51243dBa9C36d35d066d94359E468e5E3 |
| 10 | VotingManager | 0x27B935041C4048Ba8cc323d1081A73FbB55c5C47 |
| 11 | ShariaReviewManager | 0xBBB79aFB580eFd2A47F181026843FE6E8c2d29fF |
| 12 | PoolManager | 0xb2dFFeB80227F3236657C3B8FAD086E03398A569 |
| 13 | ZakatEscrowManager | 0x562009d716DbEAEDD7ed805aCAAF14922b2cB7D3 |
| 14 | PrivateDonationPool | 0xAee7800E0562d3274F62d66dC6E7Fdf4f886f122 |
| 15 | MilestoneManager | 0x11569446b840d45c4408f80d0dc293314fc5e9c4 |
| 16 | ZKTCore | 0x5e3241AC904cE8B8EC2cAEB506e933A350bD19CC |
