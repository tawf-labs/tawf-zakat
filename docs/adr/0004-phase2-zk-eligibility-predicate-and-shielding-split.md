# Phase 2 ZK: fix the eligibility predicate, and split eligibility from fund-shielding

Phase 2 adds the privacy layer to the Solana port (after the Phase 1 guarded
launch, ADR-0003). Reviewing the inherited Ethereum ZK code surfaced two
problems we resolve here: the eligibility predicate is inverted, and the design
conflates two separable privacy concerns.

## Decision 1 — eligibility predicate is `wealth ≥ nisab AND hawl elapsed`

The inherited Noir circuit (`noir-circuits/zkat_eligibility/src/main.nr`) asserts
`total_wealth < nisab_threshold`, i.e. it proves the prover is *below* nisab
(poor → a zakat **recipient**/mustahik). But the circuit is invoked in the
**donation** flow, by the **donor**. That is incoherent. We treat the `<` as an
inversion bug and define the Solana circuit predicate as:

```
total_wealth = income * 12 + assets
assert total_wealth >= nisab          // donor is obligated to pay zakat (muzakki)
assert current_time >= hawl_start + ONE_LUNAR_YEAR
```

**Rationale.** The proof's job is to certify that a donation **qualifies as
zakat** (payer above nisab, held one hawl) — not voluntary sadaqah. That is
exactly what makes the funds subject to the strict zakat rules we already
encoded: the 8 asnaf, prompt distribution, and hence the zakat-pool deadline →
grace → redistribution lifecycle. The predicate must match that architecture.
Giving zakat secretly (*sirr*) is also religiously preferred, so donor
anonymity has a genuine basis. The misleading `recipient_address` witness is
renamed `campaign_id` (the donation target), not "the donor is a recipient".

(If the product ever genuinely needs to prove *recipient* eligibility — a
mustahik claiming funds — that is a separate circuit in a separate flow, not
this one. Confirm with the Sharia owner before building it.)

## Decision 2 — eligibility (we build) and fund-shielding (third-party) are separate layers

The inherited code merges two things; keeping them merged is the root of the
confusion. They are independent:

- **Layer A — Eligibility proof** (nisab/hawl). A statement about the donor's
  *own* data. We build this: a small Circom/Groth16 circuit producing a
  Poseidon nullifier (ADR-0002). Client-side proving, trustless.
- **Layer B — Fund shielding** (hide who donated and how much; unlinkable
  sender→recipient). Generic financial privacy. We do **not** build this — a
  bespoke Tornado-style shielded pool is the most audit-hostile crypto a small
  team could write, and we hold zakat funds. We integrate an existing
  third-party shielded pool instead.

This split also resolves the Arcium tension in ADR-0002: Arcium was correctly
rejected for **Layer A** (MPC is the wrong shape for proving your own data).
For **Layer B**, an MPC shielded pool (Arcium/Umbra) is a legitimate candidate —
different layer, different trust calculus. ADR-0002 already flagged this
("MPC only becomes relevant if we ever need shared private state").

### Layer B vendor choice — Privacy Cash (primary), gated on an IDRX whitelist

Research pass (mid-2026) compared the candidates against two hard requirements:
shielded withdrawal must be able to land in a **program-controlled vault**
(our `zkt_core` pool PDA), and it must shield an **arbitrary SPL mint** (IDRX).

- **Privacy Cash — chosen, primary.** Trustless ZK (Tornado-style), live on
  mainnet (~$121M shielded in its first 100 days), open-source, ~20 audits +
  Veridise formal verification. Rust SDK (`send_privately()`) matches our stack.
  Transparent fees: 0% deposit, 0.35% withdraw + ~0.006 SOL network fee.
  Composable: withdrawal binds an arbitrary recipient address in the proof, so
  the pattern is **withdraw unlinkably → a fresh platform-controlled address →
  normal `donate` CPI into the `zkt_core` pool**, preserving sender↔recipient
  unlinkability while funds still land in the vault.
- **Umbra / Arcium — rejected for now.** MPC (not trustless). Mainnet Alpha only,
  gated onboarding with a **$500 deposit cap** (unusable for an open donation
  platform), and a **note-claim recipient model** requiring Umbra keys — fights
  "funds land in a program vault." Watch-item until it exits alpha and ships
  C-SPL + a passive-recipient path.
- **Light Protocol / Helius — fallback.** Trustless ZK, UTXO, arbitrary-SPL
  friendlier; but the production privacy SDK was mid-relaunch post Helius
  acquisition. Revisit if the Privacy Cash IDRX path stalls.
- ~~Token-2022 confidential transfer~~ — hides amount only (not sender↔recipient),
  and is disabled on mainnet pending audit. Does not meet Level 3.

**BLOCKER (external, must action):** Privacy Cash gates tokens behind an
on-chain `ALLOWED_TOKENS` whitelist; each mint needs its own Merkle tree
(`initialize_tree_account_for_spl_token`). **IDRX is not whitelisted and we
cannot self-serve it** — it requires the Privacy Cash team / their program
upgrade authority. Action: contact Privacy Cash to whitelist IDRX + provision
its tree. Until then, Layer B cannot shield IDRX. (Layer A ships regardless —
see Consequences: MVP launches pseudonymous on Layer A alone.)

## Decision 3 — trusted setup: reuse Phase 1, run a small Phase 2 ceremony with the Squads signers

Groth16 needs a per-circuit trusted setup (ADR-0002 noted this).
- **Phase 1 (Powers of Tau, universal):** reuse an existing ceremony (Perpetual
  Powers of Tau / Hermez `.ptau`). Do not run our own.
- **Phase 2 (circuit-specific):** required, but the eligibility circuit is tiny,
  so a quick snarkjs ceremony suffices. Security holds if **≥1 contributor**
  honestly discards toxic waste. The **three Squads multisig signers**
  (see the squads-multisig-config memory) double as the Phase 2 contributors —
  they are already our vetted trust set.

Operational rule: **freeze the circuit before the ceremony.** Any circuit change
invalidates the Phase 2 `.zkey` and forces a re-run.

## Consequences

- The Solana eligibility circuit intentionally **diverges** from the Ethereum
  Noir circuit's `<` predicate (it fixes the bug). The Ethereum side should be
  corrected too, or documented as knowingly-wrong, to avoid the two drifting on
  *purpose* vs *accident*.
- Layer A ships independently of Layer B. An MVP can launch with Layer A
  (eligibility + nullifier, pseudonymous) before Layer B (full unlinkability)
  is integrated.
- The donate flow gains a ZK path alongside the plain `donate` instruction: a
  `donate_zk` that verifies the Groth16 proof (via `groth16-solana`) and burns
  the nullifier through a per-nullifier PDA.
