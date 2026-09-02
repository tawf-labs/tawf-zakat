# Spec: Frontend Feature-Driven Architecture, Multi-Route Information Architecture, and Indonesian Human-Centric Syariah UX

## Problem Statement

Muzakki (Indonesian Muslim donors) wishing to pay zakat and monitor public distribution face an overwhelming and intimidating user experience in the current frontend:
1. All application capabilities—marketing landing, payment forms (fiat and crypto), Merkle inclusion proof verifications, multi-unit transparency metrics, and 3-of-3 multi-sig governance workflows—are stacked onto a single monolithic page (`/`).
2. The user interface uses heavy Web3/cryptographic jargon (*"Zero-Gas Merkle Invariant Split"*, *"EIP-712 Typed Structured Data"*, *"Safe Global Multisig Account"*), which alienates non-technical Indonesian donors who primarily expect familiar Islamic charity concepts and sharia compliance assurances.
3. Giant component files (>40 KB to 70 KB) create render cascades and poor code maintainability due to tightly coupled UI, state polling, and multiple unrelated domain concerns in single components.
4. Institutional actors (Amil, Sharia Supervisory Board / DPS, and Independent Auditors) have no dedicated workspace, forcing them to navigate public marketing content to perform governance operations.

## Solution

Re-architect the frontend into a modular, **Feature-Driven Architecture** with dedicated multi-route navigation using TanStack Router, intuitive Indonesian Islamic philanthropy copywriting, an interactive BAZNAS sharia zakat calculator, and isolated component slices:
1. **Multi-Route Navigation**:
   - **`/` (Beranda)**: Welcoming landing page focusing on transparency values, live summary metrics, 3-layer sharia governance overview, quick calculator, and featured aid campaigns.
   - **`/donasi` (Salurkan Zakat)**: Clean, distraction-free zakat & infaq checkout flow with BAZNAS Nisab Calculator, payment gateway (QRIS / Virtual Account & Web3 USDC), and digital intention (*niat*) recitation.
   - **`/transparansi` (Pusat Transparansi & Explorer)**: Real-time public ledger, 8 Asnaf distribution charts, and mustahik disbursement history with IPFS BAST documents and on-chain verification links.
   - **`/verifikasi` (Cek Bukti Donasi)**: Self-service digital donation certificate check via Transaction ID or NIK Hash with instant Merkle proof validation.
   - **`/tata-kelola` (Portal Stakeholder)**: Segregated operational portal for Amil proposals, DPS Sharia Safe Multisig approvals, Auditor EIP-712 attestations, and role governance (`/tata-kelola/roles`).
2. **Indonesian Human-Centric Syariah Framing**:
   - Frame cryptographic guarantees as trust benefits (*"Jaminan Syariah Terkunci Sistem"*, *"Bukti Digital Anti-Manipulasi"*, *"Persetujuan Dewan Pengawas Syariah"*).
   - Provide expandable secondary inspection tabs (*"Lihat Bukti Kriptografi & Data On-Chain"*) for technical auditors without cluttering the primary user view.
3. **Feature-Driven Vertical Slices**:
   - Separate code into domain features (`landing`, `donation`, `transparency`, `verification`, `governance`) and shared UI primitives, with components kept under 150 lines.
4. **Interactive BAZNAS Zakat Calculator**:
   - Built-in calculator for Zakat Penghasilan (Income) and Zakat Maal (Wealth) against gold nisab thresholds with direct checkout pre-fill.
5. **Granular State & Render Optimization**:
   - Isolate local form state in leaf components, use TanStack Query v5 with specific cache keys, and handle live updates via WebSocket thin invalidations.

## User Stories

1. As a Muzakki, I want to visit the homepage and immediately understand how the protocol guarantees 100% transparent and sharia-compliant zakat management without getting confused by technical blockchain jargon.
2. As a Muzakki, I want to use an interactive Zakat Penghasilan calculator with my monthly salary and expenses, so that I know whether my income meets the BAZNAS nisab standard and how much zakat I owe.
3. As a Muzakki, I want to use an interactive Zakat Maal calculator with my accumulated savings and gold holdings, so that I can accurately calculate my annual 2.5% wealth obligation.
4. As a Muzakki, I want to click "Salurkan Sekarang" from the calculator to automatically populate my zakat category and nominal in the donation checkout page.
5. As a Muzakki, I want to read the Arabic, Latin, and Indonesian translation of the Zakat Niat (intention) before confirming payment, so that my donation fulfills Islamic worship requirements.
6. As a Muzakki, I want to choose between standard Indonesian payment methods (QRIS / Bank Virtual Account) and Web3 USDC, so that I can donate using my preferred payment medium.
7. As a Muzakki, I want to receive a clear transaction confirmation with a receipt ID and payment summary once my donation is processed.
8. As a Muzakki, I want to visit the Verification page and search by my transaction ID or NIK hash, so that I can independently verify that my donation has been immutably recorded.
9. As a curious donor or tech auditor, I want to click "Lihat Bukti Kriptografi" in the verification view, so that I can inspect the Merkle tree root and leaf inclusion proof without disrupting the main view.
10. As a member of the public, I want to visit the Transparency Center and view live financial summary cards showing total collected funds, disbursed amounts, and remaining vault balance.
11. As a member of the public, I want to view an interactive visual breakdown of fund allocations across the 8 Asnaf categories, so that I can confirm funds are distributed according to Islamic law.
12. As a member of the public, I want to browse the table of disbursed programs and filter by asnaf or search by program name, so that I can track where community funds are going.
13. As a public observer, I want to click on a disbursement record to view its IPFS-stored BAST (Berita Acara Serah Terima) receipt and Sepolia Etherscan transaction, so that I have undeniable proof of legitimate aid handoff.
14. As an Amil officer, I want to access the Stakeholder Portal and submit a new disbursement proposal with program metadata, asnaf category, nominal, and beneficiary privacy hash, so that the proposal enters the governance pipeline.
15. As an Amil officer, I want to upload real physical BAST receipts and photos directly to decentralized IPFS storage when executing an approved disbursement.
16. As a Sharia Supervisory Board (DPS) member, I want to review submitted proposals and sign sharia approvals using our Safe Global 2-of-3 multisig account, so that illegitimate proposals are vetoed before funds can be released.
17. As an Independent Auditor, I want to review dual-receipt documentation and execute gasless EIP-712 WTP audit attestations sponsored by the relayer, so that formal audit opinions are recorded on the public ledger.
18. As an Admin, I want to manage protocol roles (DPS, Auditor, Relayer, Admin) from a dedicated governance panel, so that authority delegations are transparent and verifiable.
19. As a mobile user, I want a fully responsive navigation drawer and adaptive layouts, so that I can calculate zakat, donate, and check transparency reports on my smartphone seamlessly.
20. As a user viewing live data, I want real-time updates via WebSockets without full-page reloads, so that new donations and disbursement approvals reflect instantly on my screen.

## Implementation Decisions

1. **Routing Architecture**:
   - Utilize TanStack Router file-based routing.
   - Create explicit route files for `/` (home), `/donasi` (donation flow), `/transparansi` (public ledger explorer), `/verifikasi` (Merkle proof checking), `/tata-kelola` (stakeholder management), and `/tata-kelola/roles` (role governance).
   - Generate route tree using TanStack Router CLI (`tsr generate`).

2. **Component & Module Structure (Feature-Driven)**:
   - Restructure `frontend/src/` into clean feature directories:
     - `features/landing/`: Hero, ValueProposition, LiveMetricsSummary, ShariaPillars, FeaturedPrograms.
     - `features/donation/`: DonationCheckout, ZakatCalculator (Income & Maal), PaymentMethodSelector, NiatAkadCard, ReceiptModal.
     - `features/transparency/`: TreasuryLedger, AsnafAllocationChart, DisbursementFeed, BastViewerModal, RealtimeFeed.
     - `features/verification/`: CertificateSearch, MerkleProofVisualizer, CertificateCard.
     - `features/governance/`: AmilProposalForm, DpsApprovalQueue, SafeMultisigStatus, AuditorAttestationPanel, RoleRoster.
   - Retain and enhance UI primitives in `components/ui/` (Button, Card, Badge, Dialog, Tabs, Input, Table, Alert).
   - Layout shell in `components/layout/` (Navbar, Footer, PageHeader, Container).

3. **Indonesian Islamic Philanthropy Terminology & Abstraction**:
   - Translate all user-facing labels to clear, respectful Indonesian sharia phrasing.
   - Place blockchain transaction links and cryptographic proof technicalities inside collapsed "Detail Bukti Kriptografi" disclosures.

4. **Interactive BAZNAS Nisab Logic**:
   - Define sharia calculation formulas for Zakat Penghasilan (2.5% of net monthly income when exceeding monthly nisab equivalent to 85g gold/12) and Zakat Maal (2.5% of total wealth exceeding 85g gold).
   - Provide configurable/default gold price benchmark in IDR with fallback.

5. **State Management & Query Optimization**:
   - Keep input form state strictly local to leaf form components.
   - Scope React Query hooks with domain keys (`['transparency', 'metrics']`, `['proposals', 'list']`, `['donations', 'recent']`).
   - Listen to `WebSocketContext` push notifications to trigger `queryClient.invalidateQueries` on targeted query keys.

## Testing Decisions

- **Behavioral Integration Testing**: Tests will verify end-to-end user flows rather than internal implementation details.
- **Route & UI Integrity**:
  - Verify that navigating between `/`, `/donasi`, `/transparansi`, `/verifikasi`, and `/tata-kelola` renders corresponding feature views.
  - Verify that the BAZNAS Zakat Calculator correctly applies nisab thresholds and passes calculated amounts to the donation form.
  - Verify that technical cryptographic proof details remain accessible via secondary toggle/accordions.
  - Verify that WebSocket invalidation updates query caches without causing full component re-mounts.
- **Compilation & Route Generation Seam**:
  - Run `tsr generate` and `vite build` to guarantee type safety, zero dead routes, and clean bundle generation.
- **Prior Art**: Follows existing frontend test suites and contracts integration established in `backend/test/` and `sc/test/`.

## Out of Scope

- Modifying existing Sepolia smart contracts (`ZakatProtocolL1.sol`) or changing deployed contract addresses.
- Modifying core database schemas in PostgreSQL / Drizzle ORM (frontend consumes existing API endpoints and WebSocket channels).
- Integrating additional third-party payment gateways beyond Midtrans and direct USDC.

## Further Notes

- The design maintains the soft emerald and cream aesthetic (`#17332c`, `#1b765e`, `#c4ed70`, `#f4f8f3`), ensuring a dignified, serene, and modern Islamic brand identity.
- All code changes will preserve accessibility, mobile responsiveness, and dark/light contrast compliance.
