# ZKT-Hackathon Solana Rewrite

## Overview

Solana rewrite of ZKT (Zero-Knowledge Zakat) using **Arcium MPC** for confidential computation instead of ZK proofs. All programs use Anchor 1.0.2 framework.

## Architecture

```
solana/
├── programs/
│   ├── zkt_hackathon_solana/  # Arcium MXE program (queues MPC computations)
│   └── zkt-core/              # Facade orchestrator (12 instructions)
├── encrypted-ixs/             # Arcis MPC circuits (Rust)
│   └── src/lib.rs             # 3 confidential circuits
├── frontend/                  # React 19 + Vite 6.2 + Solana wallet adapter
│   └── src/pages/             # Home, Organizers, Campaigns
├── tests/
│   ├── zkt-core.ts            # 12 integration tests
│   ├── arcium-integration.ts  # Arcium MXE tests (requires Docker)
│   └── zkt_hackathon_solana.ts # MXE scaffold test
├── scripts/
│   └── deploy.sh              # Deployment script (localnet/devnet/mainnet)
├── Arcium.toml                # Arcium localnet/cluster config
└── Anchor.toml                # Anchor workspace config
```

## Confidential Circuits (Arcis MPC)

| Circuit | Purpose | Inputs | Outputs |
|---------|---------|--------|---------|
| `check_zkat_eligibility` | Prove zakat eligibility without revealing income/assets | Encrypted income, assets, hawl_start, secret, amount + plaintext nisab, time, recipient | encrypted: eligible, nullifier, commitment |
| `aggregate_votes` | Tally Sharia council votes privately | Encrypted [5 votes] + plaintext proposal_id, quorum | encrypted: quorum_met, approval_count |
| `process_private_donation` | Process confidential donations | Encrypted donor, amount, commitment, timestamp + plaintext pool_id | encrypted: receipt_hash, pool_id |

## Quickstart

```bash
# Build
arcium build

# Run zkt-core tests
solana-test-validator &
solana airdrop 10
anchor deploy -p zkt-core
npx ts-mocha -t 1000000 tests/zkt-core.ts

# Run Arcium tests (requires Docker)
sudo systemctl start docker
arcium test                # Local MPC cluster
arcium test --skip-keygen  # Reuse cached MXE keys
```

## Deployment

```bash
# Localnet
bash scripts/deploy.sh localnet

# Devnet (requires Docker + funded wallet)
bash scripts/deploy.sh devnet
arcium deploy --cluster devnet

# Mainnet
bash scripts/deploy.sh mainnet
arcium deploy --cluster mainnet
```

## Dependencies

| Dependency | Version |
|-----------|---------|
| Anchor | 1.0.2 |
| Arcium | 0.10.3 |
| Solana CLI | 3.1.12 |
| Rust | 1.94.1 |
| Node.js | v22.22.2 |

## Key Decisions

- **Arcium MPC** over ZK proofs — no trusted setup, native Anchor integration, production-ready on Solana mainnet
- **Anchor 1.0.2** — required for Arcium CPI compatibility (tawf-gov also upgraded)
- **Standalone programs** — zkt-core has its own state, no direct CPI to tawf-gov (yet)
- **3 Arcis circuits** — zakat eligibility, vote aggregation, private donation (replacing Noir + Circom)
- **Frontend**: React 19 + Vite 6.2 (ported from Next.js, same 3 pages)

## Program IDs

| Program | ID |
|---------|----|
| zkt_hackathon_solana (MXE) | `EpT68DDpM3sasCBqw7VBp7XrKPv7mGQx9sy2JNdXciaD` |
| zkt-core | `HurjsoDphK87BtzNMUFZJUUGbxYe6fYxdtTAz3RXy9e4` |

## Test Results

- **zkt-core**: 12/12 passing (organizer, proposal, vote, pool, zakat, review, milestone)
- **Arcium MXE**: Tests written, require Docker + Arcium localnet to run
- **tawf-gov (parent)**: 27/27 passing (12 programs, Anchor 1.0.2)
