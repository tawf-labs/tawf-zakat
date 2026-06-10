# Groth16 via Circom for the Solana ZK layer (not UltraHONK, not Arcium)

The Ethereum deployment proves donor zakat eligibility (nisab + hawl) with Noir/UltraHONK and verifies Sharia-council voting with Groth16. On Solana (as of June 2026) no on-chain UltraHONK/Plonk verifier exists, and an 8.4KB Honk proof exceeds the 1,232-byte transaction limit regardless. We decided the Solana port uses **Groth16 on BN254 for both proof flows**, with the donor-eligibility circuit **rewritten in Circom** and verified via Light Protocol's audited `groth16-solana` library (~256-byte proofs, <200k CU, single transaction). Commitments and nullifiers switch from Pedersen to **Poseidon**, which has a native Solana syscall and circuit/on-chain hash parity.

## Considered Options

- **Sunspot (Reilabs)** — keep the Noir circuit, compile ACIR → gnark → Groth16 with an auto-generated Solana verifier. Rejected for now: tooling is young (audit in progress May 2026), pins Noir to beta.18, and its single-party trusted setup carries a toxic-waste warning, so we'd run our own MPC ceremony anyway. Circom/snarkjs has mature Powers-of-Tau ceremony tooling and the verifier path is battle-tested in production money protocols (Privacy Cash, Light Protocol). Revisit Sunspot once audited if maintaining two circuit languages becomes painful.
- **Arcium MPC** — the previous developer's abandoned approach (commit `f853446`). Rejected: wrong shape for the problem. Donor eligibility is a statement about the donor's *own* data, which client-side ZK proving handles trustlessly; MPC adds a node-committee trust assumption, a runtime dependency on the Arcium network (Mainnet Alpha since Feb 2026), and per-computation fees — for no capability we need. MPC only becomes relevant if we ever need shared private state (e.g., anonymous donor–recipient matching).

## Consequences

- The Solana eligibility circuit is a separate Circom artifact from the Ethereum Noir circuit; the two must be kept semantically in sync by hand (same nisab/hawl rules, different hash: Poseidon vs Pedersen).
- The frontend needs a per-chain proving pipeline (Barretenberg/UltraHONK for Ethereum, snarkjs/Groth16 for Solana).
- Groth16 requires a per-circuit trusted-setup ceremony before mainnet; budget for a proper multi-party phase-2 ceremony.
