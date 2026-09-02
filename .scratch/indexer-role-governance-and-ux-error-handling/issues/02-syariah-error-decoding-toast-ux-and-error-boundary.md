# 02 — Unified Syariah Error Decoding, Toast UX (Sonner), and Error Boundary

## Parent
Spec: Embedded Indexer, Public Role Governance Panel, and Unified Syariah Error Decoding

## What to build
Frontend feedback infrastructure providing unified toast notifications and user-friendly error handling. Integrates Sonner `<Toaster />` in root layout, creates `decodeContractError()` converting contract reverts (`DoubleClaimDetected`, `InsufficientVaultBalance`, `QuorumNotMet`, `Unauthorized`, `UserRejectedRequestError`) into intuitive Indonesian Sharia explanations, builds a `useTxToast()` transaction tracker with clickable Sepolia Etherscan links, and wraps the app with a graceful `<ErrorBoundary>`.

## Blocked by
None — can start immediately.

## Acceptance criteria
- [x] `<Toaster richColors position="top-right" closeButton />` mounted in `frontend/src/routes/__root.tsx`.
- [x] `decodeContractError(error)` correctly parses EVM revert selectors, simulation errors, and user cancellations into clear Indonesian explanations.
- [x] `useTxToast()` helper provides seamless loading ➔ success / error transitions with direct links to Sepolia explorer.
- [x] `<ErrorBoundary>` catches component-level crashes and renders a graceful recovery card styled in the Soft Syariah palette.
- [x] TypeScript types and frontend build (`bun run build`) pass cleanly.
