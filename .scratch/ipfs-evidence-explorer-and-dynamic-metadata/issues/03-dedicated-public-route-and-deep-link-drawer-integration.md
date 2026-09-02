## Parent
[GitHub Issue #45](https://github.com/tawf-labs/tawf-zakat/issues/45)

## What to build
Create the dedicated TanStack Router route `/transparansi/bukti` supporting `?cid=...` deep links, build the universal `UniversalEvidenceModal.tsx` triggerable from any table in `/transparansi` and `/tata-kelola`, and verify clean bundle compilation with zero route generation errors.

## Acceptance criteria
- [x] Create TanStack Router route `src/routes/transparansi/bukti.tsx` with typed search parameter `cid?: string`.
- [x] Create `UniversalEvidenceModal.tsx` and integrate deep-link opening from tables across `/transparansi` (Disbursement Table, BAST button) and `/tata-kelola` (Proposal List, DPS approval queue, Auditor attestation panel).
- [x] Add direct link in Navigation bar and Transparency Center to the Evidence Explorer.
- [x] Run `bun run generate-routes` (`tsr generate`) and `bun run build` to verify route tree integrity and error-free compilation.

## Blocked by
- Ticket 02 — Universal Evidence Feature Slice & Split-View Inspector
