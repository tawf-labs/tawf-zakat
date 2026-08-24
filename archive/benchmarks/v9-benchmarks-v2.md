## V9v2 Benchmark Logs — May 17 2026 (ONCHAIN COMPLETE)

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
| Proof generation (avg) | 270 ms (0.27, 0.27, 0.27, 0.26, 0.29s) |
| Proof verification (avg) | 10 ms (0.01, 0.01, 0.01, 0.01, 0.01s) |
| Proof size | 8,384 bytes |
| Public inputs | 7 × 32 bytes (224 bytes) |

### Gas Consumption (Foundry)
| Contract | Function | Gas (avg) |
|----------|----------|-----------|
| ZKTCore | donateZK() (e2e) | 721,345 |
| ZKTCore | donateZKPrivate() (e2e) | 170,710 |
| ZKTCore | Deploy | 5,538,881 |

### V9v2 Sepolia Deployment (deployer 0x236c6ea9DDc48ae72DCFb8724BF8a136aa3C6EBB)
| # | Contract | Address |
|---|----------|---------|
| 1 | MockIDRX | 0x3532d68bd08c34a948d73a0eaa00f6c6e88e9b36 |
| 2 | DonationReceiptNFT | 0xac0c50184c13d1319d9e0235273d113b1501081c |
| 3 | VotingNFT | 0x5ca75c2aa2a49afcc09ec203f680bd63bc0e4cfc |
| 4 | OrganizerNFT | 0x909743b8b91afd830207a3210dafca4affa87c57 |
| 5 | ParticipationTracker | 0x3f4d92464fae9678000cca795635f0d062e1a3a1 |
| 6 | Groth16Verifier | 0x34a6b3235230765ccf5ddd349bdabd819d06adc3 |
| 7 | ZKVerifier | 0xE3771eC9665094111c8f9b05abea2CE53358d336 |
| 8 | NullifierRegistry | 0xbfCE5C282B2083e1ed31bC32a1cE56E7bf9A4C93 |
| 9 | ProposalManager | 0x7618B6C60C4a06E61dEC45AB49a64fa14E455233 |
| 10 | VotingManager | 0x50E6B6471Afce685cc4351DB9284D9Bd0DA181cc |
| 11 | ShariaReviewManager | 0xF4eDC53fa4b9B6381A46e268D934c109CD578D03 |
| 12 | PoolManager | 0x6CeE69eF3DE8c53b1946C050c5DB5AD5B9df1506 |
| 13 | ZakatEscrowManager | 0xEb435Bc1003b7A70747aC096c6c8D2ecFde193fE |
| 14 | PrivateDonationPool | 0xcD80477e372c60659E5D52255e3139a54903c787 |
| 15 | MilestoneManager | 0x734851d43b7cb22f326715383c0ddac22097be2a |
| 16 | ZKTCore | 0xf14ca6BA400bc0CE9354C9c00288597987F8F0D5 |
