# AGENTS.md — ZKT-Hackathon

> Privacy-preserving zakat platform. Dual-chain: **Ethereum Sepolia** (UltraHONK ZK) + **Solana** (Arcium MPC). Solana rewrite on `feat/solana-rewrite` branch.

## ⚡ Quick Reference

```bash
# === SOLANA (primary active development) ===
cd solana

# Build
arcium build                      # All programs + Arcis circuits

# Test zkt-core (no Docker needed)
solana-test-validator &
anchor deploy -p zkt-core
ANCHOR_WALLET=~/.config/solana/id.json npx ts-mocha -t 1000000 tests/zkt-core.ts  # 12 tests

# Test Arcium MXE (Docker required)
sudo systemctl start docker
arcium test                        # Full MPC cluster test

# Frontend
cd frontend && npm run dev && npm run build

# === ETHEREUM (legacy, reference only) ===
cd sc && forge build && forge test  # 26 tests
cd fe && pnpm install && pnpm dev   # Next.js 16 frontend
```

## What This Project Is

ZKT enables confidential zakat donations with cryptographic privacy guarantees. Donors prove zakat eligibility and donate without revealing income, assets, or identity on the public ledger.

**Two implementations exist:**
1. **Ethereum Sepolia** (`main` branch) — 16 Solidity contracts + UltraHONK ZK proofs via Noir/Barretenberg. Original research implementation (IEEE paper). **DEPLOYED and functional.**
2. **Solana** (`feat/solana-rewrite` branch) — Arcium MPC circuits + Anchor 1.0.2 programs + React/Vite frontend. **ACTIVE development. REPLACES ZK with Arcium MPC.**

## Architecture (Solana)

```
solana/
├── programs/
│   ├── zkt_hackathon_solana/   # Arcium MXE: queues computations, handles callbacks
│   └── zkt-core/               # Standalone facade: organizer, proposal, vote, pool, zakat, review
├── encrypted-ixs/src/lib.rs    # 3 Arcis MPC circuits:
│   │                           #   check_zkat_eligibility  — nisab + hawl check
│   │                           #   aggregate_votes         — Sharia council tally
│   │                           #   process_private_donation — confidential donation
├── frontend/                   # React 19 + Vite 6.2 + Tailwind + Solana wallet adapter
│   └── src/pages/              # Home, Organizers, Campaigns (3 pages)
├── tests/
│   ├── zkt-core.ts             # 12 integration tests ✅
│   └── arcium-integration.ts   # Arcium MXE tests (needs Docker)
├── scripts/deploy.sh           # Deploy script: localnet/devnet/mainnet
├── Arcium.toml                 # Localnet: 2 nodes, Cerberus backend
└── Anchor.toml                 # workspace config
```

## How Confidentiality Works (Arcium MPC)

```
Client                          Solana Program              Arx Nodes (MPC)
  │                                  │                           │
  │ 1. Encrypt inputs (x25519+Rescue  │                           │
  │    cipher)                       │                           │
  │ ── queue_computation ──────────► │                           │
  │                                  │ ── route to cluster ────► │
  │                                  │                           │ 2. Decrypt shares
  │                                  │                           │ 3. Execute circuit
  │                                  │                           │ 4. Re-encrypt result
  │                                  │ ◄── callback ──────────── │
  │                                  │ 5. Emit event             │
  │ ◄── decrypt result ──────────── │                           │
```

**ZK is NOT used on Solana.** Arcium MPC provides confidentiality via multi-party computation (Cerberus protocol, dishonest majority). This replaces both Noir (zkat_eligibility) and Circom/Groth16 (vote_aggregation) circuits.

## Arcis Circuits

| Circuit | Inputs (encrypted) | Plaintext inputs | Outputs |
|---------|-------------------|-----------------|---------|
| `check_zkat_eligibility` | income, assets, hawl_start, secret, amount | nisab_threshold, current_time, recipient_0/1, cycle_id | eligible, nullifier_0/1, commitment_0/1 |
| `aggregate_votes` | [5 votes: approved+weight] | proposal_id, quorum_threshold | quorum_met, total_weight, approval_count, proposal_id |
| `process_private_donation` | donor_0/1, amount, commitment_0/1, timestamp | pool_id | receipt_hash_0/1, pool_id, timestamp |

**Arcis limitations:**
- No XOR (`^`) operator — use `wrapping_add`/`wrapping_mul` instead
- No arrays as plaintext params — pack [u8;32] as 4×u64
- All loops must be fixed-size (MPC requirement)
- `Enc<Shared, T>` for client-encrypted data, `Enc<Mxe, T>` for MXE-only data

## zkt-core Instructions

| # | Instruction | Accounts |
|---|------------|----------|
| 1 | `apply_as_organizer` | applicant, organizer_state(PDA[organizer,applicant]) |
| 2 | `review_organizer` | reviewer, organizer_state(PDA[organizer,applicant]) |
| 3 | `create_proposal` | organizer, proposal(PDA[proposal,organizer]) |
| 4 | `cast_vote` | voter, proposal, vote(PDA[vote,proposal,voter]) |
| 5 | `finalize_vote` | caller, proposal |
| 6 | `submit_milestone_vote` | voter, proposal, milestone_vote(PDA[mvote,proposal,voter]) |
| 7 | `create_campaign_pool` | organizer, pool(PDA[pool,organizer]) |
| 8 | `donate` | donor, pool, donor_record(PDA[donor,pool,donor]) |
| 9 | `create_zakat_pool` | organizer, zakat_pool(PDA[zakat,organizer]), clock |
| 10 | `donate_zakat` | donor, zakat_pool, clock |
| 11 | `submit_sharia_review` | proposer, review(PDA[review,proposer]) |
| 12 | `review_sharia` | reviewer, review |
| 13 | `cast_milestone_vote` | voter, proposal, milestone_vote |

## Key Decisions

1. **Arcium MPC over ZK** — no trusted setup, native Anchor, production on Solana mainnet. UltraHONK has no native KZG syscalls on Solana.
2. **Standalone zkt-core** — own state, NO direct CPI to tawf-gov (yet). Frontend orchestrates calls to both programs.
3. **Anchor 1.0.2** — required for Arcium 0.10.3 CPI compatibility. tawf-gov also upgraded.
4. **3 Arcis circuits** replace all Noir + Circom circuits. Same privacy guarantees, simpler architecture.
5. **Frontend: React 19 + Vite 6.2** — ported from Next.js 16. Same 3 pages, Solana wallet adapter.
6. **USDC + IDRX** supported from day 1 alongside IDRX stablecoin.

## Toolchain

| Tool | Version | Notes |
|------|---------|-------|
| Anchor | 1.0.2 | Required by Arcium 0.10.3 |
| Arcium CLI | 0.10.3 | `arcium build`, `arcium test`, `arcium deploy` |
| Solana CLI | 3.1.12 | |
| Rust | 1.94.1 | |
| Node.js | v22.22.2 | |
| Docker | 29.x | Required for Arcium localnet (Arx nodes) |

## Ethereum → Solana Mapping

| Ethereum (Sepolia, 16 contracts) | Solana Equivalent |
|----------------------------------|-------------------|
| ZKTCore.sol | zkt-core program |
| ZKVerifier + Groth16Verifier + HonkVerifier | Arcium MXE (callback-based) |
| NullifierRegistry | Built into Arcis circuit (encrypted output) |
| PrivateDonationPool | Arcis `process_private_donation` |
| ProposalManager, VotingManager, ShariaReviewManager, PoolManager, ZakatEscrowManager, MilestoneManager, ParticipationTracker | Standalone zkt-core instructions + tawf-gov programs (future CPI) |
| MockIDRX, VotingNFT, DonationReceiptNFT, OrganizerNFT | tawf-gov programs (not duplicated) |

## Testing

```bash
# zkt-core tests (12 tests, no Docker)
cd solana
anchor deploy -p zkt-core
npx ts-mocha tests/zkt-core.ts

# Arcium MXE tests (Docker required)
arcium test                           # Full suite
arcium test --test-name zkt-core     # Single test file
arcium test --skip-keygen             # Reuse cached MXE keys

# Ethereum tests (legacy)
cd sc && forge test                   # 26 Solidity tests
cd noir-circuits/zkat_eligibility && nargo test  # 3 Noir tests
```

## Program IDs

| Program | Localnet ID |
|---------|------------|
| zkt_hackathon_solana (MXE) | `EpT68DDpM3sasCBqw7VBp7XrKPv7mGQx9sy2JNdXciaD` |
| zkt-core | `HurjsoDphK87BtzNMUFZJUUGbxYe6fYxdtTAz3RXy9e4` |

## Gotchas

1. **Docker required for Arcium** — localnet needs `sudo systemctl start docker`. Without Docker: only zkt-core tests work.
2. **Arcium `arcium init` creates nested .git** — removed and committed to parent zkt-hackathon repo
3. **Arcis no XOR** — use `.wrapping_add()` instead of `^`
4. **Arcis no arrays as plaintext** — pack [u8;32] as separate u64 params
5. **Anchor 1.0 `Bumps` trait** — every `#[derive(Accounts)]` needs at least one PDA with `bump`
6. **`mint_authority_bump` on InterfaceAccount** — not available, derive separately
7. **Anchor.toml must list ALL programs** under `[programs.localnet]` for deploy
8. **`Enc<Shared, T>`** — data encrypted with shared secret (client+MXE can decrypt). Use `Enc<Mxe, T>` for MXE-only.

## Related Repos

- **tawf-gov** (`feat/solana-migration`) — governance programs that zkt-core will CPI into
- **tawf-gov-solana** — 12 Anchor programs with ShariaReviewManager
