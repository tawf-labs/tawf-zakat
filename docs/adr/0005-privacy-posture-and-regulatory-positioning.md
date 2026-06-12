# Privacy posture and regulatory positioning: transparency is the product, drop fund-shielding, partner with a licensed amil

After researching how zakat is actually received and managed in Indonesia (BAZNAS / UU 23/2011), we resolve two product-level questions that were driving the ZK design: *how much donor privacy do we actually need*, and *what is the app's legal standing as a thing that touches zakat funds*. The conclusions cut scope rather than add it.

## Context — how zakat works in Indonesia (BAZNAS scheme)

- Value chain: **muzakki → amil → mustahik (8 asnaf)**. The **amil** (BAZNAS or a licensed LAZ) is the regulated party that collects, holds, and distributes.
- **Transparency is a legal duty**, not a feature: every transaction is recorded, audited, and published (annual public reports). BAZNAS's own framing (Dr. Hasbi Zaenal, R&D BAZNAS) is that blockchain's value is an *immutable, verifiable audit trail* that rebuilds trust — because distrust in zakat institutions is a primary reason collected zakat sits far below its national potential.
- Donor anonymity is **already a solved, mundane thing**: BAZNAS offers *"Donasi Lepas"*, recorded as *"hamba Allah"*. Wanting to give without others knowing (*sirr*) is a labelling/UX concern, not a cryptographic one.
- **Legal gate (the big one):** UU 23/2011 **Pasal 38** — acting as amil (collecting, distributing, storing, or managing zakat) **without a permit** is a criminal offence: up to **5 years imprisonment + Rp 500,000,000 fine**.

## Decision 1 — transparency is the product; donor privacy is an edge nicety, not the thesis

The reason to put zakat on-chain is a **public, auditable fund flow** (muzakki can trace funds toward mustahik) plus **programmatic distribution rules** that enforce sharia-required prompt disbursement (our deadline → grace → permissionless-redistribution lifecycle stops funds from sitting idle — something a spreadsheet cannot enforce).

A fully **shielded fund flow directly contradicts this thesis.** Therefore donor privacy is scoped to the **deposit edge only** and satisfied by **pseudonymity + "hamba Allah"-style labelling**, not by a shielded pool.

## Decision 2 — drop Layer B (fund-shielding); keep Layer A (eligibility proof)

This supersedes the Layer-B vendor selection in [ADR-0004](0004-phase2-zk-eligibility-predicate-and-shielding-split.md).

- **Drop Layer B / Privacy Cash.** A Tornado-style shielded pool fights the transparency value-prop, and its IDRX-whitelist blocker was external and open-ended. Removing it also removes that blocker. (ADR-0004's Layer-A/Layer-B *split* still stands as the right conceptual framing; we are simply choosing not to build/integrate Layer B.)
- **Keep Layer A (`donate_zk` eligibility proof).** It still earns its place: a muzakki proves obligation (`wealth ≥ nisab AND hawl elapsed`) and donates **without exposing their wealth or identity**, while the **fund side stays fully transparent and auditable**. This is the correct marriage — *sirr* at the deposit edge, auditability on distribution.
- Consequence: the `donate_zk` fail-closed verifier-wiring milestone (vendor groth16-solana / embed ceremony vkey / bind collision-free campaignId) is **still relevant** and remains the Phase 2 ZK deliverable. The trusted-setup ceremony with the Squads signers is unchanged. What is cancelled is only the Privacy-Cash integration and the IDRX-whitelist outreach.

## Decision 3 — regulatory positioning: the app is a rail for a licensed amil, via BAZNAS partnership

The app must **not** be the unlicensed amil. Pasal 38 makes that a crime. The app is **infrastructure/rails**; the licensed amil (BAZNAS / a LAZ) holds the regulated authority to collect and distribute.

This is viable because **the app has already been exhibited at a BAZNAS exhibition**, so a partnership path exists. The positioning to lock with that partner:
- The licensed amil is the legal collector/distributor of record; the app provides the on-chain ledger, eligibility proofs, and programmatic distribution.
- Privileged on-chain authority (config, organizer whitelist, upgrade) stays with the Squads multisig (ADR-0003) — and the partnership should clarify how that multisig maps to the amil's governance.
- Product/marketing must not present the app itself as collecting/managing zakat independently of the licensed amil.

## Consequences

- Phase 2 scope **shrinks**: Layer A (eligibility + nullifier) only. No third-party shielded pool, no Privacy Cash outreach, no IDRX-whitelist dependency.
- The `donate_zk` fail-closed state is unchanged; wiring the Groth16 verifier + ceremony remains the Phase 2 ZK milestone.
- **Open action (team, not code):** formalise the BAZNAS / LAZ partnership and the app's rail-vs-amil legal standing **before** any mainnet collection of real zakat. This is the top launch blocker, above any ZK work.
- Onchain-zakat caveats to keep honest with stakeholders: Indonesian crypto legal status is still "commodity, not legal tender" and zakat-in-crypto is fiqh-debated — hence IDRX (an IDR stablecoin) as the pragmatic rupiah bridge; global Islamic-finance on-chain adoption is still mostly pilots, so transparency/trust is the defensible value, not novelty.
