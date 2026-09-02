# 05 — Stakeholder Governance Portal & Monolith Decommission

## Parent
Parent issue: #39

## What to build
Build a dedicated institutional Stakeholder Portal at `/tata-kelola` (`src/features/governance/`, `routes/tata-kelola.tsx`, and `routes/tata-kelola/roles.tsx`) providing focused, role-based workflows for Amil, Sharia Supervisory Board (DPS), Independent Auditors, and Admins.

Decommission legacy monolithic component files (`DonateSection.tsx`, `TransparencyDashboard.tsx`, `GovernanceSection.tsx`), regenerate TanStack Router's route tree (`tsr generate`), and verify that the full production build (`vite build`) completes cleanly with zero errors.

## Acceptance criteria
- [x] Create `src/features/governance/` with modular subcomponents: `ProposalList.tsx`, `CreateProposalModal.tsx`, `DpsSafeApprovalCard.tsx`, `AuditorAttestationPanel.tsx`, and `RoleRoster.tsx`.
- [x] Support Amil disbursement proposal intake with NIK salted hashing and Pinata IPFS metadata upload.
- [x] Support DPS 2-of-3 Safe Global multisig approval execution and signing queue view.
- [x] Support Auditor gasless EIP-712 structured typed signature verification with Relayer gas sponsorship.
- [x] Route `/tata-kelola.tsx` and subroute `/tata-kelola/roles.tsx` provide tabs for respective stakeholder tasks.
- [x] Completely delete legacy monolithic files (`DonateSection.tsx`, `TransparencyDashboard.tsx`, `GovernanceSection.tsx`, `MerkleVerifier.tsx`).
- [x] Run `tsr generate` and `vite build` to guarantee clean route tree generation and error-free compilation.

## Blocked by
- Ticket 02 — Human-Centric Landing Page & Sharia Pillars
- Ticket 03 — Zakat Donation Flow & BAZNAS Calculator
- Ticket 04 — Public Transparency Center & Merkle Verification
