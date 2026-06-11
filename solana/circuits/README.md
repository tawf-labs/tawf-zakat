# zakat_eligibility — Circom circuit (Layer A)

Proves a donation qualifies as zakat (`wealth ≥ nisab`, held ≥ 1 hawl) without
revealing the donor's wealth, and emits a Poseidon nullifier. Verified on Solana
via Light Protocol's `groth16-solana`. Design: ADR-0002, ADR-0004.

This is **Layer A** (eligibility). Fund-shielding (Layer A is unlinkability of
the money itself) is **Layer B** — a third-party shielded pool, not built here.

## Public signals (order is load-bearing)

The on-chain verifier consumes them in this exact order:

```
[ nisab, currentTime, campaignId, cycleId, nullifier ]
```

`nullifier` is the circuit's public output; the rest are public inputs.

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

## On-chain (next steps, not yet built — ADR-0004 Decision 1/2)

- Convert `verification_key.json` to the byte layout `groth16-solana` expects and
  embed it in `zkt_core`.
- Add a `donate_zk` instruction: verify the proof against the public signals,
  bind `currentTime` to a recent `Clock`, then **burn the nullifier** via a
  PDA `seeds = [b"nullifier", nullifier_bytes]` opened with `init` — a second use
  fails because the account already exists.
- `campaignId` must equal the target pool; `cycleId` is the zakat cycle.
