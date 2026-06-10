# Phase 1 Solana launch: Squads multisig control, $300 vault cap, no on-chain governance

Management decision (mas Maulana, relayed via Zidan, 2026-06-10): the Solana port launches as a guarded Phase 1 — no governance programs are ported (no proposal lifecycle, no community voting, no Sharia-council voting, no Groth16 council circuit). All privileged authority (organizer whitelisting, config, program upgrades) is held by a [Squads](https://squads.so) multisig, and every campaign vault is capped at ~$300 to bound the blast radius of any bug while the program and the unaudited Quasar framework are young. Whitelisted organizers open campaigns directly in `Active` state; there is no per-campaign Sharia review on-chain in Phase 1.

This mirrors the progressive-decentralization roadmap already written for the Ethereum deployment (smartcontract.md Phase 1: core-team multisig, 6–12 months).

## Consequences

- The program must treat all authorities as replaceable pubkeys in a config PDA (two-step transfer), so the later handover from Squads to a governance program is an authority rotation, not a redeploy or state migration.
- The vault cap is a config parameter in token base units (per-pool value validated against a global config maximum), never a hardcoded constant — the "$300" is policy, not code.
- Pool accounts carry a `status` field from day one (Phase 1 skips straight to `Active`) so a `PendingReview` Sharia-approval step can be enabled later without account migration.
- Product/marketing must not claim on-chain Sharia review during Phase 1.
- Phase 1 ZK scope shrinks to a single circuit: donor zakat eligibility (see ADR-0002). The Sharia-council Groth16 voting circuit is deferred with the rest of governance.
