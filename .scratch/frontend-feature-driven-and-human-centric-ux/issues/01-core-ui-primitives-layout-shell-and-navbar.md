# 01 — Core UI Primitives, Layout Shell & Multi-Route Navigation Bar

## Parent
Parent issue: #39

## What to build
Build a unified, responsive application layout shell (`Navbar`, `Footer`, `PageHeader`, `Container`) and reusable UI primitives (`Button`, `Card`, `Tabs`, `Badge`, `Dialog`, `Table`, `Input`, `Accordion`) supporting a multi-route architecture across five distinct sections (`/`, `/donasi`, `/transparansi`, `/verifikasi`, `/tata-kelola`).

The navigation bar must provide clean links to all routes, active link indicators, a responsive mobile drawer, and a real-time WebSocket connectivity status badge. All UI primitives must adhere to the soft emerald and cream design system (`#17332c`, `#1b765e`, `#c4ed70`, `#f4f8f3`).

## Acceptance criteria
- [x] Implement reusable UI primitives (`src/components/ui/`) based on Tailwind CSS and Radix UI with unified styling.
- [x] Implement layout shell components (`src/components/layout/Navbar.tsx`, `Footer.tsx`, `PageHeader.tsx`, `Container.tsx`).
- [x] Replace anchor hash links in Navbar with TanStack Router `<Link>` components to `/`, `/donasi`, `/transparansi`, `/verifikasi`, and `/tata-kelola`.
- [x] Include active state indicator and mobile hamburger drawer in Navbar.
- [x] Preserve ConnectKit wallet connection button and live WebSocket status indicator in Navbar.
- [x] Create basic placeholder route files for `/donasi`, `/transparansi`, `/verifikasi`, and `/tata-kelola` so the route tree compiles cleanly.

## Blocked by
- None — can start immediately.
