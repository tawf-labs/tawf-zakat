# zakat_eligibility — Circom circuit (Layer A)

Proves a donation qualifies as zakat (`wealth ≥ nisab`, held ≥ 1 hawl) without
revealing the donor's wealth, and emits a Poseidon nullifier. Verified on Solana
via Light Protocol's `groth16-solana`. Design: ADR-0002, ADR-0004.

This is **Layer A** (eligibility). Fund-shielding (Layer A is unlinkability of
the money itself) is **Layer B** — a third-party shielded pool, not built here.

## Public signals (order is load-bearing)

snarkjs emits circuit **outputs first**, then public inputs in declaration
order. The on-chain verifier must consume them in this exact order (verified
against a real `public.json`):

```
[ nullifier, nisab, currentTime, campaignId, cycleId ]
```

`nullifier` is the circuit's public output; the rest are public inputs.

This ordering + byte encoding is **proven against a real proof** by
`groth16::circuit_vector_tests::our_circuit_proof_verifies_end_to_end` in
`zkt_core`: a genuine proof of this circuit, with its public signals encoded the
way `donate_zk` reconstructs them (32-byte big-endian), verifies through the
vendored on-chain verifier. The dev verifying key / proof there are throwaway —
regenerate and re-embed them (and the production `VERIFYING_KEY`) from the
ceremony output once the circuit is frozen.

## Toolchain

- `circom` 2.1.6+
- `snarkjs` (`npm i -g snarkjs`)
- `circomlib` (`npm i circomlib`) — include path is `circomlib/circuits/...`

## Build

```sh
# 1. compile circuit -> r1cs + wasm witness generator
circom zakat_eligibility.circom --r1cs --wasm -l node_modules

# 2. witness (sanity check with the example input)
node zakat_eligibility_js/generate_witness.js \
  zakat_eligibility_js/zakat_eligibility.wasm inputs.example.json witness.wtns
```

## Trusted setup (ADR-0004 Decision 3)

**Phase 1 — Powers of Tau (universal): reuse, do not run.**
The circuit is small; the `powersOfTau28_hez_final_12.ptau` round from the
Hermez / Perpetual Powers of Tau ceremony covers it (2^12 constraints).

```sh
# download a vetted Phase 1 ptau (verify its hash against the published value)
wget https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau
snarkjs powersoftau verify powersOfTau28_hez_final_12.ptau   # MUST pass
```

**Phase 2 — circuit-specific ceremony.** FREEZE the circuit first; any change
invalidates the `.zkey`. The three Squads signers are the contributors
(see the squads-multisig-config memory) — ≥1 honest contributor → secure.

```sh
snarkjs groth16 setup zakat_eligibility.r1cs powersOfTau28_hez_final_12.ptau ze_0000.zkey

# each signer contributes in turn, on their own machine, with fresh entropy:
snarkjs zkey contribute ze_0000.zkey ze_0001.zkey --name="signer-1" -e="$(head -c64 /dev/urandom | base64)"
snarkjs zkey contribute ze_0001.zkey ze_0002.zkey --name="signer-2" -e="..."
snarkjs zkey contribute ze_0002.zkey ze_final.zkey --name="signer-3" -e="..."

snarkjs zkey verify zakat_eligibility.r1cs powersOfTau28_hez_final_12.ptau ze_final.zkey  # MUST pass
snarkjs zkey export verificationkey ze_final.zkey verification_key.json
```

Publish the contribution hashes so anyone can audit the ceremony. Keep
`ze_final.zkey` (proving) + `verification_key.json` (on-chain) under version
control or a release artifact; discard intermediate `.zkey`s.

## Prove / verify (off-chain sanity)

```sh
snarkjs groth16 prove ze_final.zkey witness.wtns proof.json public.json
snarkjs groth16 verify verification_key.json public.json proof.json   # true
```

## On-chain (mostly built — ADR-0004 Decision 1/2)

- **Verifier: DONE.** `zkt_core/src/groth16.rs` is a vendored no_std Groth16
  (BN254) verifier running on the `alt_bn128` syscalls (<200k CU). `donate_zk`
  (disc 11) verifies the proof against the public signals, binds `currentTime` to
  a recent `Clock`, and **burns the nullifier** via a PDA
  `seeds = [b"nullifier", nullifier_bytes]` opened with `init` (a second use
  fails — the account already exists).
- **Remaining: embed the verifying key.** `donate_zk` is fail-closed
  (`VERIFYING_KEY = None`) until the Phase-2 ceremony runs. To go live: convert
  `verification_key.json` to the `Groth16Verifyingkey` byte layout (see
  `groth16-solana`'s `parse_vk_to_rust.js`) and replace the `None` in
  `donate_zk.rs`. `nr_pubinputs` = 6 (1 output + 5 public, i.e. `vk_ic.len()`).
- **Proof wire format** (the `proof: [u8; 256]` instruction arg): uncompressed
  big-endian `A (G1, 64) ++ B (G2, 128) ++ C (G1, 64)`, exactly as snarkjs emits
  (the program negates `A` itself — do **not** pre-negate). Public signals are
  passed as the instruction args (`nullifier`, `nisab`, `currentTime`,
  `cycleId`) plus the on-chain-derived `campaignId`, in the order below.
- `campaignId` binds the proof to one pool; `cycleId` is the zakat cycle.
  **Derivation (must match on-chain `campaign_id_from_pool`):** take the target
  pool's PDA address (32 bytes, big-endian), clear the most-significant byte so
  the value is a valid BN254 scalar-field element, and use that as the
  `campaignId` public input. The pool address is globally unique, so a proof for
  one organizer's pool cannot be replayed against another's — unlike `pool.index`
  (unique only per organizer; the provisional binding this replaces).
