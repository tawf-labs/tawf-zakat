# Recipient privacy: store a commitment for zakat disbursements, the raw wallet for normal campaigns

ADR-0005 made the fund flow auditable by minting a `Disbursement` receipt on
every `withdraw` (recipient + amount + asnaf). Reviewing the Ethereum paper
(`zk-private-zakat.pdf`) against that design surfaced a conflict: the receipt
recorded the **raw recipient wallet**, and for a zakat pool the recipient is by
definition a mustahik (below nisab). A durable, queryable on-chain record that
labels a wallet "zakat recipient (asnaf=fakir)" broadcasts that person's poverty
— exactly the `hifz al-nafs` (dignity) harm the paper argues existing blockchain
zakat platforms commit. This ADR resolves it.

## The two axes of transparency (the framing this rests on)

Maqasid al-shariah gives two relevant objectives that pull in opposite
directions for an on-chain zakat system:

- **`hifz al-mal`** (protection of wealth) → the *fund flow* must be auditable:
  collected correctly, distributed to the eight asnaf, amil accountable
  (`amanah`). Transparency is **required** here.
- **`hifz al-nafs`** (protection of dignity) → the *identity* of individual
  donors and recipients must be protected. Exposing who is poor harms their
  honour (Ibn Ashur on financial dignity; `sadaqah al-sirr`'s precedence).

So "transparency" is not monolithic. The correct posture (reconciling ADR-0005's
"transparency is the product" with the paper's privacy thesis):

> **Fund flow + eligibility → transparent/auditable. Donor + recipient identity → private.**

## Decision

The `Disbursement.recipient` field holds a different form per campaign type, with
`asnaf` as the disambiguator:

- **Zakat pool** (`asnaf` 0-7): store an **off-chain commitment**
  `hash(recipient || salt)` supplied by the amil, not the raw wallet. The
  durable receipt set therefore never enumerates mustahik addresses. The amil
  keeps `(recipient, salt)` off-chain and can **selectively disclose** it to a
  regulator/auditor on demand — accountability without public exposure.
- **Normal campaign** (`asnaf == ASNAF_NA`): store the **raw beneficiary**
  (`dest_ta.owner()`). A flood-relief or mosque-build beneficiary is typically an
  institution that wants public credit, and public transparency is desirable. No
  dignity concern, so no commitment.

The commitment is computed off-chain and passed as the `recipient_commitment`
instruction argument; the program does not hash on-chain (see Limitations).

## Limitations (stated honestly, matching the paper)

- The `withdraw` transfer still sends funds to `dest_ta`, whose owner is visible
  in the transaction. The commitment hides the recipient in the **durable,
  labelled receipt set**, not in the raw transaction graph. Full unlinkability
  (so even the transfer target is unlinkable) requires **intermediary / escrow
  disbursement** — the amil pays a distribution account, the mustahik claims via
  an encrypted note. That is deliberately out of scope (the paper lists it as
  future work; it is Layer-B-shaped crypto we chose not to build — ADR-0005).
- The program cannot verify the commitment binds the real recipient (no salt
  on-chain — and a public salt would not hide anything, since `dest_ta.owner` is
  already in the tx). The recipient/asnaf are **amil-asserted**, consistent with
  the existing trust model (SECURITY.md): the chain captures the claim for audit,
  it does not adjudicate it.

## Consequences

- `withdraw` gains a `recipient_commitment: [u8; 32]` argument. Zakat callers
  pass the amil's commitment; normal callers pass all-zero (ignored).
- Covered by `test_withdraw_records_disbursement_and_validates_asnaf` (zakat
  stores the commitment) and `test_normal_pool_has_no_deadline` (normal stores
  the raw owner).
- A future intermediary-disbursement flow would make the commitment fully
  effective; until then it is a meaningful but partial dignity safeguard.
