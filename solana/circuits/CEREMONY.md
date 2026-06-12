# Trusted-setup ceremony runbook (Groth16 Phase 2)

How the team produces the production verifying key for `zakat_eligibility.circom`
and wires it into the on-chain verifier. Groth16 needs a per-circuit trusted
setup (ADR-0002, ADR-0004 Decision 3). The verifier itself is already built and
proven (`zkt_core/src/groth16.rs`); this runbook produces the **key** it is
missing, after which `donate_zk` can leave its fail-closed state.

**Security model.** The Phase-2 ceremony is secure if **at least one** contributor
honestly generates randomness and destroys their "toxic waste". We use the three
[Squads multisig signers](../../docs/adr/0003-phase1-guarded-launch-squads-multisig.md)
as contributors — already our vetted trust set. A single honest signer makes
forged proofs infeasible.

---

## Roles

- **Coordinator** — prepares the initial `.zkey`, relays files between
  contributors, runs the final verification, and does the on-chain integration.
- **Contributors** — the **three Squads signers**. Each, in turn, injects fresh
  entropy on their own machine and destroys it afterward. They never share their
  randomness.

---

## 0. Pre-flight — FREEZE THE CIRCUIT (do not skip)

Any change to `zakat_eligibility.circom` after the ceremony invalidates the
`.zkey` and forces a full re-run. Before starting:

- [ ] Circuit reviewed and final (predicate, public-signal order, Poseidon arity).
- [ ] Tag the commit: `git tag circuit-freeze-vN && git push --tags`.
- [ ] Record the exact `circom` + `snarkjs` versions used (write them in the PR).

```sh
cd solana/circuits
npm install                    # circomlib + snarkjs, pinned in package.json
circom zakat_eligibility.circom --r1cs --wasm -l node_modules
# sanity: constraint count should match what was reviewed (~394)
snarkjs r1cs info zakat_eligibility.r1cs
```

---

## 1. Phase 1 — Powers of Tau (reuse, do NOT run our own)

The circuit is tiny (≤ 2^12 constraints), so reuse a published universal
ceremony. **Do not generate your own Phase-1** — that would reintroduce trust.

- [ ] Download a Hermez / Perpetual Powers of Tau file sized for the circuit,
      e.g. `powersOfTau28_hez_final_12.ptau` (2^12 = 4096 constraints).
- [ ] Verify its published hash before use.

```sh
# example (confirm the current canonical URL + hash first):
# wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau
snarkjs powersoftau verify powersOfTau28_hez_final_12.ptau
```

> The `pot12_*.ptau` files currently in this directory are **dev scratch** — use
> a verified published file for production.

---

## 2. Phase 2 — circuit-specific contributions (the 3 signers)

### 2a. Coordinator: initialise

```sh
snarkjs groth16 setup zakat_eligibility.r1cs powersOfTau28_hez_final_12.ptau zkey_0000.zkey
```

Send `zkey_0000.zkey` to **Signer 1**.

### 2b. Each signer contributes (on their own machine, ideally air-gapped)

Signer 1:
```sh
snarkjs zkey contribute zkey_0000.zkey zkey_0001.zkey \
  --name="squads-signer-1 BZiu…6HHe" -v
# snarkjs prompts for random text; type a long unpredictable string.
```
Signer 1 publishes `zkey_0001.zkey` + the contribution hash snarkjs prints, then
**securely deletes** any local entropy. Pass `zkey_0001.zkey` to **Signer 2**.

Signer 2: `… contribute zkey_0001.zkey zkey_0002.zkey --name="squads-signer-2 5v8a…k6o9"`
Signer 3: `… contribute zkey_0002.zkey zkey_0003.zkey --name="squads-signer-3 ECFF…PhSn"`

Each signer records the printed **contribution hash** — these form the public
transcript that anyone can later check.

### 2c. Coordinator: (optional) public-randomness beacon, then finalise

A beacon adds a final, publicly-verifiable contribution (e.g. a future Bitcoin
block hash) so no contributor was last:

```sh
# <beaconHash> = a public, unpredictable-at-setup hex string; 10 = iterations
snarkjs zkey beacon zkey_0003.zkey zkey_final.zkey <beaconHash> 10 \
  -n="zakat eligibility final beacon"
```
If you skip the beacon, just rename `zkey_0003.zkey` → `zkey_final.zkey`.

---

## 3. Verify and export the verifying key

```sh
# Verifies the full transcript: Phase-1 file + every Phase-2 contribution.
snarkjs zkey verify zakat_eligibility.r1cs powersOfTau28_hez_final_12.ptau zkey_final.zkey

snarkjs zkey export verificationkey zkey_final.zkey verification_key.json
```

- [ ] `zkey verify` prints `ZKey Ok!`.
- [ ] Each signer confirms their contribution hash appears in the transcript.
- [ ] Publish the transcript (contribution hashes + beacon) so the ceremony is
      auditable. Keep `zkey_final.zkey` (needed by every prover); the
      intermediate `zkey_000N.zkey` files can be discarded.

---

## 4. Wire the key on-chain

```sh
node vk_to_rust.js verification_key.json
```

1. Paste the emitted `VK_IC` + `VERIFYING_KEY = Some(...)` block into
   `zkt_core/src/instructions/donate_zk.rs`, **replacing** the
   `const VERIFYING_KEY: Option<Groth16Verifyingkey<'static>> = None;` line.
   (`nr_pubinputs` must be `6` = 1 output + 5 public signals.)
2. Refresh the dev integration test in `zkt_core/src/groth16.rs`
   (`circuit_vector_tests`) with a real proof from the final `.zkey` — or delete
   it in favour of the on-chain happy-path test below. Regenerate bytes with the
   same conversion (`ffjavascript leInt2Buff`, G2 ordering `[c1, c0]`).
3. Add the now-reachable QuasarSVM tests for `donate_zk`: a valid proof
   **accepts** (transfer happens, nullifier PDA created) and a **replayed**
   nullifier is rejected (`init` fails on the existing PDA).
4. `quasar build && quasar test` — all green.

---

## 5. Prover integration (off-chain, for the client/relayer)

The prover builds the witness and proof, and must derive the public signals
exactly as the program expects (see `README.md`):

- Public-signal order: `[nullifier, nisab, currentTime, campaignId, cycleId]`.
- `campaignId` = the target pool's PDA address, big-endian, **most-significant
  byte cleared** (matches `campaign_id_from_pool` on-chain).
- `currentTime` must be within `MAX_PROOF_AGE` (300 s) of the on-chain clock.
- Submit the proof as `A(64) ++ B(128) ++ C(64)`, uncompressed big-endian, in
  snarkjs order — the program negates `A` itself, do **not** pre-negate.

---

## Security checklist

- [ ] Circuit frozen + tagged before setup (§0).
- [ ] Phase-1 `.ptau` is a verified published file, not self-generated (§1).
- [ ] All three signers contributed, each with fresh entropy destroyed after (§2).
- [ ] `snarkjs zkey verify` passes; transcript published (§3).
- [ ] At least one signer is trusted to have discarded their toxic waste — the
      whole security argument rests on this.
- [ ] `donate_zk` stays fail-closed until the key is embedded **and** the
      happy-path + replay tests pass (§4).
- [ ] If the circuit ever changes, the ceremony is void — re-run from §0.
