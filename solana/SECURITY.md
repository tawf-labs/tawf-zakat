# zkt_core — Security Notes (Phase 1)

Internal review, not a substitute for the external audit ADR-0001 requires
(it must cover Quasar itself — unaudited beta, pinned rev `a89a932`).
This file maps the trust model and records the in-house audit pass so an
external auditor starts from the invariants, not a cold read.

## Trust model

- **Admin authority** (`Config.authority`, a Squads multisig — ADR-0003):
  whitelists/revokes organizers, sets `max_pool_cap`/`fallback_authority`,
  trips `paused`, grants the one-time deadline extension, two-step transfers
  its own role. Cannot move pool funds directly.
- **Organizer** (whitelisted wallet): opens pools under its own PDA, withdraws
  from its own pools' vaults to any destination of the pool's mint, recording a
  `Disbursement` receipt (recipient + amount + asnaf) on each withdraw. Trusted
  with the funds it raises; the $300 pool cap bounds blast radius. The recorded
  recipient/asnaf are organizer-asserted — the chain captures the claim for
  audit, it does not verify the recipient is genuinely that asnaf (off-chain /
  the licensed amil's responsibility — ADR-0005).
- **Donor**: transfers tokens into a pool vault, gets a `Receipt` PDA. No
  privileges.
- **Anyone**: may call `redistribute` once a zakat pool's deadline + grace has
  lapsed. Funds can only land in a token account owned by `fallback_authority`
  — permissionless trigger, trusted destination.

## Invariants (enforced + tested)

- Funds leave a vault only via `withdraw` (pool's own organizer, signed by the
  pool PDA, every withdraw mints a `Disbursement` receipt) or `redistribute`
  (zakat-only, post-grace, → fallback). Covered by
  `test_only_pool_organizer_can_withdraw`, the lifecycle test, the pause test.
- `total_donated <= cap <= max_pool_cap`; cap fixed at creation. Covered by
  `test_zakat_donate_cap_and_receipt`, `..._rejects_over_cap_...`.
- Receipt indices are monotonic (`receipt_index == donation_count`), so receipt
  PDAs never collide. Covered by `test_zakat_donate_cap_and_receipt`.
- Disbursement indices are monotonic (`disbursement_index == disbursement_count`),
  so the outflow audit trail is gapless and disbursement PDAs never collide; the
  asnaf code is 0-7 for zakat and `ASNAF_NA` for normal campaigns. Covered by
  `test_withdraw_records_disbursement_and_validates_asnaf`.
- Zakat pools enforce the distribution window: donate/withdraw blocked past
  deadline, one +14d extension only within grace, redistribution only after
  deadline+grace. Covered by the lifecycle test.
- Admin actions require `has_one(authority)` + signer. Authority handover is
  two-step (`transfer` → `accept`). Covered by the whitelist + transfer tests.
- `paused` freezes all inflow (`donate`, `create_pool`) **and** organizer
  outflow (`withdraw`). `redistribute` is intentionally exempt. Covered by
  `test_pause_freezes_donate_and_withdraw`.

## Audited vulnerability classes (in-house pass)

| Class | Status |
|---|---|
| Arbitrary CPI | OK — `Program<TokenProgram>`/`AssociatedTokenProgram` are type-checked to their canonical ids |
| PDA / discriminator | OK — `address = X::seeds()` on config; typed `Account<T>` checks owner+disc; `has_one(vault/organizer)` binds the rest |
| Missing signer | OK — every privileged path has a `Signer` + matching `has_one` |
| Missing ownership | OK — vaults/token accounts are typed `Account<Token>`; SPL `transfer` enforces matching mints |
| Sysvar spoofing | OK — `Clock::get()` syscall, never a passed account |
| Integer overflow | OK — all arithmetic is `checked_add` / `checked_*` |

### Finding H1 (fixed, commit 6f5f8a5)

`paused` originally gated inflow only, so an organizer could still drain a
pool during an incident. Fixed: `withdraw` now takes `Config` and requires
`!paused`. `redistribute` deliberately stays ungated — it is the sharia
safety-valve and only ever pays the trusted `fallback_authority`; freezing it
would trap zakat that is religiously obligated to be distributed.

## Open items for the external audit

- Quasar framework (account macros, zero-copy deserialization, CPI helpers).
- A lowered `max_pool_cap` does not retroactively cap existing pools — accepted
  (pause is the live brake); confirm acceptable.
- Per-pool mint is organizer-chosen (no allowlist). Mainnet should constrain to
  IDRX at the UI/indexer layer, or add an on-chain mint allowlist if required.
- Phase 2 ZK layer (Groth16/Circom — ADR-0002) is not yet in this program.
