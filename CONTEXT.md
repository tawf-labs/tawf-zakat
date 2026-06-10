# ZKT — Privacy-Preserving Zakat Platform

A donation platform for Islamic zakat where donors can prove eligibility (nisab + hawl) without revealing wealth or identity, governed progressively from team multisig toward a Sharia-supervised DAO. Deployed on Ethereum (Sepolia, live) and Solana (Phase 1 port in progress).

## Language

**Campaign**:
A fundraising effort with a type (Zakat, Normal, Emergency), an organizer, and exactly one Pool.
_Avoid_: project, proposal (a Proposal is the governance artifact that may *create* a Campaign)

**Pool**:
The on-chain account holding a Campaign's funds, denominated in a single token mint.
_Avoid_: vault (used informally by the team; canonical term is Pool), escrow

**Pool Cap**:
The maximum total donations a Pool may accept, set at creation and bounded by global config (Phase 1 policy: ~$300).
_Avoid_: vault limit

**Organizer**:
A whitelisted party authorized to create Campaigns and withdraw from their Pools.
_Avoid_: fundraiser, owner

**Admin Multisig**:
The Squads multisig holding operational authority: organizer whitelisting, config, program upgrades, deadline extensions (Phase 1 only).
_Avoid_: core team, owner

**Sharia Council**:
The body that reviews Campaigns for sharia compliance. Off-chain only in Phase 1; gains on-chain authority in later phases.
_Avoid_: council multisig (that is its future on-chain representation, not the body itself)

**Zakat Deadline**:
The 30-day distribution window of a Zakat Campaign, followed by a 7-day grace period and an optional 14-day extension.
_Avoid_: timeout, expiry

**Fallback Vault**:
The multisig-controlled destination that receives a Zakat Pool's remaining funds after its deadline fully lapses.
_Avoid_: treasury (the team treasury is a different thing)

**Redistribution**:
The permissionless move of an expired Zakat Pool's funds to the Fallback Vault.
_Avoid_: clawback, sweep

**Receipt**:
A per-donation PDA record (donor, pool, amount, time) proving a public donation; the future basis for per-campaign voting rights. Never created for Private Donations.
_Avoid_: receipt NFT (Ethereum's ZKT-RECEIPT is an NFT; on Solana it is a plain PDA record)

**Eligibility Proof**:
A ZK proof that a donor's wealth passed nisab and was held one hawl, revealing neither amount nor identity. UltraHONK/Noir on Ethereum; Groth16/Circom on Solana.
_Avoid_: zakat proof, KYC proof (KYC is identity verification — unrelated)

**Private Donation**:
A donation accompanied by an Eligibility Proof and a Nullifier instead of a Receipt.
_Avoid_: anonymous donation (the amount is still visible on Solana Phase 2; only donor identity is hidden)

**Nullifier**:
A one-time tag derived from the donor's secret that prevents reusing the same Eligibility Proof; recorded on-chain (PDA per nullifier on Solana).
_Avoid_: spent hash

**Nisab**:
The minimum wealth threshold making zakat obligatory.

**Hawl**:
The one-lunar-year holding period wealth must satisfy before zakat is due.

## Relationships

- An **Organizer** creates one or more **Campaigns**; each **Campaign** has exactly one **Pool**
- A **Pool** enforces its **Pool Cap** and holds exactly one token mint
- A public donation to a **Pool** produces exactly one **Receipt**
- A **Private Donation** consumes one **Nullifier** and produces no **Receipt**
- A Zakat **Pool** past its **Zakat Deadline** is subject to **Redistribution** into the **Fallback Vault**
- The **Admin Multisig** whitelists **Organizers** and (Phase 1) grants deadline extensions on behalf of the **Sharia Council**

## Example dialogue

> **Dev:** "When a donor sends a **Private Donation**, do we still mint them a **Receipt** so they can vote later?"
> **Domain expert:** "No — a **Receipt** names the donor's wallet, which would undo the privacy the **Eligibility Proof** bought. The **Nullifier** is the only trace, and it grants nothing."
>
> **Dev:** "And if the **Organizer** never withdraws from a Zakat **Pool**?"
> **Domain expert:** "After the **Zakat Deadline**, grace period, and any extension lapse, anyone may trigger **Redistribution** — the funds go to the **Fallback Vault**, because zakat must be distributed, not parked."

## Flagged ambiguities

- "vault" was used by the team to mean both **Pool** (per-campaign funds, as in "limit setiap vault max $300") and **Fallback Vault** — resolved: per-campaign funds are a **Pool**; **Fallback Vault** is only the redistribution destination. Note: Squads also calls its multisig treasury accounts "vaults" — a third meaning; in Squads context say "Squads vault".
- "voting" conflates community voting (vZKT, per-platform), receipt voting (per-campaign), and Sharia-council voting (Groth16-proven) — all three are deferred past Phase 1 on Solana; be explicit which one is meant.
- "IDRX" may refer to the real Solana mint (`idrxZcP8...wDur`, 2 decimals), its deprecated old mint, the Ethereum MockIDRX, or our devnet mock — programs are mint-agnostic, so always name the specific mint.
