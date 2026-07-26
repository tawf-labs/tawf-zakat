# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZKT is a Next.js web application for transparent, traceable zakat donations on
**Ethereum Sepolia (chain 11155111)**. It is a **real on-chain application** —
wallet connections, donations, governance votes, and NFT receipts all hit
deployed contracts. It is not a mock.

Branding: **ZKT** is the product and leads the visual hierarchy; **Tawf
Foundation** is the ecosystem/organisation and appears as a smaller secondary
mark. The `--tawf-*` CSS tokens keep their names — they are the foundation's
design tokens, not product branding.

## Development Commands

```bash
pnpm dev          # Start development server (localhost:3000)
pnpm build        # Build for production (ignores ESLint/TypeScript errors!)
pnpm start        # Start production server
pnpm lint         # Run ESLint (check only, not enforced during builds)
npx tsc --noEmit  # The ONLY way to actually typecheck — see warning below
```

⚠️ **`next.config.mjs` sets both `eslint.ignoreDuringBuilds` and
`typescript.ignoreBuildErrors` to `true`.** A green `pnpm build` proves nothing
about type correctness. There is a long tail of pre-existing type errors
(~73 as of the last audit), so when changing typed code, run `npx tsc --noEmit`
before and after and compare counts rather than expecting zero.

## Architecture & Tech Stack

- **Next.js 15+ App Router**, React 19, TypeScript
- **Tailwind CSS v4** with CSS variables
- **Radix UI / shadcn-ui** components in `components/ui/`
- **Typography**: Cormorant Garamond (serif, headings/logo) + Inter (sans, body),
  loaded in `app/layout.tsx`. See `DESIGN_GUIDELINES.md` at the repo root.
- **pnpm** package manager

### Web3 stack

- **wagmi + viem**, wrapped by **XellarKit** (`@xellar/kit`)
- Provider: `components/providers/web3-provider.tsx` (**not** `components/wallet/WalletProvider.tsx`)
- Chain config: `lib/client-config.ts` — Sepolia only. `ChainEnforcer` in the
  provider auto-switches wallets onto Sepolia.
- Contract addresses + ABIs: `lib/abi.ts` (`CONTRACT_ADDRESSES`), each entry
  `process.env.NEXT_PUBLIC_CONTRACT_* || <hardcoded fallback>`
- Currency is **IDRX** (an 18-decimal ERC-20), not USDT/USD

### Two contract families

- **zkt-hackathon (ZK layer)**: ZKTCore, ShariaReviewManager, PrivateDonationPool,
  HonkVerifier, Groth16Verifier, NullifierRegistry
- **tawf-gov (DAO layer)**: TawfPassport, TawfReputation, MockIDRX, VotingNFT,
  DonationReceiptNFT, ProposalManager, VotingManager, MilestoneManager,
  ParticipationTracker, PoolManager, ZakatEscrowManager

`ZKTCore` is a thin facade that calls the DAO contracts **synchronously**, so the
whole stack must live on one chain.

## ⚠️ ZK proofs do not work

The private-donation path is **not functional**, deliberately and fail-closed:

- `PRIVATE_DONATION_AVAILABLE` in `lib/aztec-private-donation.ts` is `false`.
  Check it before offering privacy UI.
- `/api/generate-proof` **does not exist**; there is no such route handler.
- The on-chain `HonkVerifier` is a stub returning `false`, so
  `ZKTCore.donateZK` / `donateZKPrivate` always revert with "Invalid ZK proof".

Do not "fix" this by making a verifier return true. The blocker is EIP-170: the
real Barretenberg verifier is 33,880 bytes vs the 24,576 limit.

## Project Structure

```
app/                   # App Router pages
├── campaigns/[id]/    # Campaign detail + donate
├── zakat/, zakat/[slug]/
├── governance/        # Dual-layer DAO (community + Sharia council)
├── explorer/          # On-chain tx explorer via getLogs polling
├── faucet/            # Claim MockIDRX, grant voting power
├── organizer/         # Organizer dashboard + application flow
├── dashboard/donor/, dashboard/auditor/
├── partners/, contact/, mainnet/
└── api/               # 10 route handlers — campaigns, certificates,
                       # sessions, sharia/*, upload-to-pinata
components/
├── providers/         # web3-provider, language-provider, currency-provider
├── donations/, campaigns/, certificates/, landing/, layout/, shared/, ui/
data/                  # STATIC demo data — see caveat below
hooks/                 # useCampaigns, useDonationReceipts, useVoting,
                       # useMilestones, useShariaReview, useZakatLifecycle, ...
lib/                   # abi, contract-client, relayer, pinata-client, types
```

## Gotchas

- **`data/campaigns.ts` is mock data.** It is legitimate as a *fallback merge*
  inside `app/api/campaigns/**`. It must **not** be the sole source for a
  user-facing view — prefer `useCampaigns()`. Several pages used to render it
  directly, which advertised campaigns that did not exist on chain.
- **`app/styles/globals.css` vs `styles/globals.css`**: only `app/globals.css`
  is imported by `app/layout.tsx`. `styles/globals.css` is dead.
- **Wallet signature auth was removed**, not disabled — `/auth/request-message`
  and `/auth/verify` never existed. See the note in `web3-provider.tsx`.
- **`.env` holds live secrets** (`RELAYER_PRIVATE_KEY`, `PINATA_JWT`). Confirm
  it is gitignored before committing anything near it.
- **`package.json` name is still `my-v0-project`** — cosmetic, but not the
  product name.
- UI language is Indonesian-first via `language-provider.tsx` (EN + ID strings).

## Common Tasks

- **Adding a contract call**: add the address/ABI to `lib/abi.ts`, then write a
  hook in `hooks/` using `useReadContract` / `useWriteContract`.
- **New page**: App Router conventions; `"use client"` for anything using wagmi.
- **UI components**: reuse `components/ui/` (shadcn) before adding new ones.
