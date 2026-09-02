## Parent
[GitHub Issue #45](https://github.com/tawf-labs/tawf-zakat/issues/45)

## What to build
Build the `src/features/evidence/` feature slice providing a Split-View Universal Evidence Inspector containing interactive PDF/image previews, structured metadata cards, expandable raw JSON trees, and real-time on-chain cryptographic integrity seals.

## Acceptance criteria
- [x] Create `src/features/evidence/` feature directory with focused subcomponents (< 150 lines each).
- [x] Create `DocumentPreviewer.tsx` supporting interactive PDF rendering, image proof viewer, multi-gateway resilience indicator, zoom, and direct download.
- [x] Create `MetadataInspectorCard.tsx` displaying Asnaf, Salted Beneficiary Hash (UU PDP), Nominal, Disbursement Channel, Bank Reference, and Sharia compliance checklist.
- [x] Create `RawJsonTree.tsx` providing syntax-highlighted collapsible JSON tree with 1-click clipboard copy.
- [x] Create `OnChainIntegrityBadge.tsx` verifying cryptographic match of CID and beneficiary hash against Sepolia L1 smart contract state.
- [x] Create `EvidenceViewer.tsx` assembling the split-view layout with quick CID search input and sample proposal selectors.
- [x] Export all subcomponents cleanly via `src/features/evidence/index.ts`.

## Blocked by
- Ticket 01 — Dynamic Metadata Schema v1.1.0 & Backend Inspection Endpoint
