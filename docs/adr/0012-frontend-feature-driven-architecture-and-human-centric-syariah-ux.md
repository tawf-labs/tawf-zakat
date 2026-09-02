# ADR-0012: Frontend Feature-Driven Architecture, Route Separation, and Indonesian Human-Centric Syariah UX

## Status
Accepted

## Context
Previously, the frontend bundled all application capabilities into a single monolithic page (`routes/index.tsx`):
1. **Single-Page Congestion**: Landing page marketing, donation checkout (fiat & crypto), Merkle tree verification, multi-unit ledger dashboard, and 3-of-3 multi-sig governance portals were all mounted simultaneously on `/`.
2. **Monolithic Components & Render Cascades**: Key components grew excessively large (`GovernanceSection.tsx` ~70 KB, `TransparencyDashboard.tsx` ~42 KB, `DonateSection.tsx` ~42 KB), combining state management, polling, and sub-views in single files, causing frequent re-render cascades.
3. **Alienating Web3 Jargon**: Heavy technical terminology (*"Zero-Gas Merkle Invariant Split"*, *"EIP-712 Typed Structured Data"*, *"Safe Global Multisig Account"*) intimidated standard Indonesian Muslim donors (Muzakki) who primarily seek a simple, trustworthy, and sharia-compliant zakat payment experience.
4. **Navigational Incoherence**: Navigation relied on hash anchors (`#why`, `#donate`, `#governance`), breaking browser history, URL bookmarking, and route-level code splitting.

## Decision

### 1. Multi-Route Information Architecture (TanStack Router)
Decompose the single-page application into dedicated, purposeful routes:
- **`/` (Beranda)**: Value proposition, Islamic governance pillars, live metrics overview, quick zakat calculator, and featured programs.
- **`/donasi` (Salurkan Zakat)**: Distraction-free payment flow for Muzakki with zakat category selection (Maal, Penghasilan, Fitrah, Infaq), payment methods (QRIS, Virtual Account, USDC), and digital akad/niat recitation.
- **`/transparansi` (Pusat Transparansi & Explorer)**: Public financial ledger, 8 Asnaf allocation charts, and real-time disbursement feed with BAST IPFS documents & Sepolia Etherscan audit links.
- **`/verifikasi` (Cek Bukti Donasi)**: Donor certificate verification via Transaction ID or NIK Hash with instant Merkle proof validation.
- **`/tata-kelola` (Portal Stakeholder)**: Segregated operational portal for Amil proposal creation, DPS Sharia Safe Multisig approvals, and Independent Auditor gasless EIP-712 attestations.
- **`/tata-kelola/roles`**: Public and administrative role governance panel.

### 2. Feature-Driven / Domain-Driven Component Architecture
Organize frontend code into domain-specific vertical slices instead of rigid Atomic Design or flat component folders:
```
frontend/src/
├── components/
│   ├── ui/               # Primitives (Button, Dialog, Card, Badge, Input, Tabs, Table)
│   ├── layout/           # Navbar, Footer, PageHeader, Container
├── features/
│   ├── landing/          # Hero, QuickCalculator, LiveMetricsSummary, ShariaPillars
│   ├── donation/         # DonationForm, PaymentMethodSelector, ZakatCalculator, NiatCard
│   ├── transparency/     # BalanceMetrics, AsnafAllocationChart, DisbursementFeed, BastViewerModal
│   ├── verification/     # SearchReceiptForm, MerkleProofVisualizer, CertificateCard
│   ├── governance/       # ProposalList, CreateProposalModal, DpsApprovalCard, AuditorAttestationPanel
├── routes/               # Thin route composers
├── lib/                  # Web3 config, contracts, WebSocketContext, errorHandler
```
Each feature directory encapsulates subcomponents (< 150 lines each), custom hooks, types, and API helpers.

### 3. Indonesian Human-Centric Copywriting & Islamic Fiqh Framing
- Lead with familiar Islamic philanthropic language (Zakat Maal, Zakat Penghasilan, Dewan Pengawas Syariah, BAST, Opini WTP).
- Encapsulate technical Web3 and cryptographic guarantees as trust benefits (*"Jaminan Syariah Terkunci Sistem"*, *"Bukti Digital Anti-Manipulasi"*, *"Pengawasan 3 Lapis"*).
- Provide secondary expandable accordions/tabs (*"Lihat Bukti Kriptografi & Data On-Chain"*) for technical auditors without cluttering the primary user interface.

### 4. Interactive BAZNAS Zakat Calculator
Integrate an interactive sharia calculator supporting:
- **Zakat Penghasilan/Profesi**: Monthly income and allowable expenses checked against monthly gold nisab (85g gold / 12).
- **Zakat Maal/Harta**: Cumulative wealth evaluated against the 85g gold threshold.
- One-click transfer of calculated zakat amounts into the checkout form with contextual Arabic/Indonesian intention (*niat*) texts.

### 5. Render Optimization & Granular State Management
- Isolate local form state and input fields in leaf components.
- Utilize TanStack Query v5 with granular cache keys (`['transparency-stats']`, `['proposals']`, `['donations']`).
- Leverage real-time WebSocket thin invalidation (`useWebSocket`) to selectively invalidate cache keys without triggering full page reloads.

## Consequences

### Positive
- **Streamlined User Journeys**: Muzakki experience a frictionless checkout, while institutional stakeholders have a focused workspace.
- **Optimized Performance & Code-Splitting**: Routes load on demand; heavy Safe multisig and IPFS libraries are only fetched when navigating to `/tata-kelola`.
- **Maintainability**: Isolated feature slices eliminate 1000-line monolithic files and make unit/integration testing straightforward.
- **Enhanced Trust**: Clear Islamic copywriting tailored to Indonesian donors builds confidence and increases donor conversion.

### Negative / Trade-offs
- Refactoring requires decomposing existing legacy components (`DonateSection.tsx`, `TransparencyDashboard.tsx`, `GovernanceSection.tsx`) into feature modules and generating updated TanStack route trees.
