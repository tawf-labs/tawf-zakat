# 04 — Public Transparency Center & Merkle Verification

## Parent
Parent issue: #39

## What to build
Build a dedicated Public Transparency Center at `/transparansi` and a Self-Service Verification Portal at `/verifikasi` (`src/features/transparency/`, `src/features/verification/`, `routes/transparansi.tsx`, and `routes/verifikasi.tsx`).

The Transparency Center provides live multi-unit treasury balances (IDR fiat & USDC), visual distribution breakdown across the 8 Asnaf categories, and a searchable/filterable table of mustahik disbursements with IPFS BAST receipt inspection modals and Sepolia Etherscan transaction links.

The Verification Portal allows donors to search their donation record using Transaction ID or NIK Hash, view an instant digital certificate of zakat inclusion, and access a secondary expandable "Detail Bukti Kriptografi" accordion to inspect Merkle tree inclusion proofs without UI clutter.

## Acceptance criteria
- [x] Create `src/features/transparency/` with subcomponents: `TreasuryBalanceCards.tsx`, `AsnafChart.tsx`, `DisbursementTable.tsx`, `BastModal.tsx`, and `LiveActivityFeed.tsx`.
- [x] Display verified BAST receipts directly from Pinata dedicated IPFS gateway with multi-gateway fallbacks.
- [x] Create `src/features/verification/` with subcomponents: `SearchReceiptForm.tsx`, `CertificateCard.tsx`, and `MerkleProofDetails.tsx`.
- [x] Implement zero-gas client-side Merkle inclusion verification with human-friendly Indonesian result status and expandable raw tree proof view.
- [x] Wire up real-time WebSocket invalidation so new donations and disbursements update the transparency tables instantly.

## Blocked by
- Ticket 01 — Core UI Primitives, Layout Shell & Multi-Route Navigation Bar
