# ADR-0001: Vite + Bun Hono Architecture and Ethereum Sepolia Target

- **Status**: Accepted
- **Date**: 2026-08-24
- **Deciders**: User, Agent

## Context and Problem Statement

The Zakat Protocol MVP requires a high-performance, developer-friendly architecture to demonstrate end-to-end transparent zakat ingestion (Fiat QRIS batching & Web3 USDC) and proof-of-disbursement on EVM. The legacy codebase had mixed Next.js and monolithic scripts.

## Decision Drivers

- Fast execution and modern TypeScript runtime for the off-chain relayer & batching coordinator.
- Lightweight frontend SPA for clean Muzakki verification and Amil/Public dashboard without server-rendering overhead.
- Direct alignment with Ethereum mainnet data availability trends (Ethereum Sepolia testnet).

## Considered Options

1. Next.js App Router Monolith on Base L2.
2. Vite (React) Frontend + Bun Hono Backend API on Ethereum Sepolia Testnet.

## Decision Outcome

Chosen Option: **Option 2 (Vite React + Bun Hono + Ethereum Sepolia)**.

### Positive Consequences

- **Bun + Hono**: Ultra-fast TypeScript execution, native ESM, low latency for off-chain Merkle tree construction and batch relayer triggers.
- **Vite (React)**: Fast build times, clean single-page app architecture for Muzakki Verification & Public Transparency Dashboard.
- **Ethereum Sepolia**: Direct L1 testnet deployment, verifying data availability and gas cost efficiency directly on Ethereum.

## Pros and Cons of the Options

### Option 2 (Chosen)
- **Pro**: Decoupled frontend/backend architecture; high testability for Bun API routes.
- **Pro**: Simple deployment model for client-side Merkle proof verification.
- **Con**: Requires running separate frontend and Bun backend dev servers during local development.
