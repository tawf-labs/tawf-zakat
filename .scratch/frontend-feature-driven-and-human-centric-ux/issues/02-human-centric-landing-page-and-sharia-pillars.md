# 02 — Human-Centric Landing Page & Sharia Pillars

## Parent
Parent issue: #39

## What to build
Re-architect the homepage (`routes/index.tsx`) and feature module (`src/features/landing/`) into a welcoming, trustworthy, and educational landing page tailored to Indonesian Muslim donors (Muzakki).

The page must feature warm Islamic philanthropy copywriting, explain the 3-layer sharia governance model (Amil, Sharia Supervisory Board / DPS, and Independent Auditor), show real-time summarized treasury numbers (collected and distributed), provide a quick zakat calculator preview with a direct CTA to `/donasi`, and highlight featured humanitarian aid programs.

## Acceptance criteria
- [x] Create `src/features/landing/` domain slice containing focused subcomponents (<150 lines each): `Hero.tsx`, `ShariaPillars.tsx`, `LiveMetricsSummary.tsx`, `QuickCalculatorPreview.tsx`, `FeaturedPrograms.tsx`, and `CtaBanner.tsx`.
- [x] Frame blockchain immutability as trust benefits (*"Jaminan Syariah Terkunci Sistem"*, *"Bukti Penyaluran Nyata & Terbuka"*) rather than raw cryptographic jargon.
- [x] Implement live summary metrics fetching total collected and distributed funds from backend APIs via TanStack Query.
- [x] Connect the quick calculator preview CTA to navigate to `/donasi` with pre-selected category.
- [x] Refactor `routes/index.tsx` into a clean route composer assembling the landing feature components.

## Blocked by
- Ticket 01 — Core UI Primitives, Layout Shell & Multi-Route Navigation Bar
