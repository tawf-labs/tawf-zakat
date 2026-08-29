# 01 — Safe.global DPS Multi-Sig Queue Integration & Real-Time Pending Signature Tracker

## Parent
#31 (Spec: Production-Ready DPS Safe.global Multi-Sig Queue & Ex-Post Auditor Attestation Engine)

## What to build
DPS Sharia scholars can view and sign pending disbursement proposals via their institutional Safe.global account. The system integrates with the Safe Transaction Service API on Sepolia to track and display pending multi-sig signatures in real time (e.g. `⏳ Safe DPS: 1/2 Signatures - Waiting for Ustadz 2`). Upon reaching the required threshold, on-chain execution transitions proposal status to `Approved`.

## Blocked by
None — can start immediately.

## Acceptance criteria
- [ ] Safe Transaction API client polls and fetches active multisig queue transactions for the registered Safe DPS address.
- [ ] Governance UI displays live signature progress badge: showing confirmed signers and remaining signatures needed.
- [ ] Connecting via WalletConnect or Safe Apps triggers `approveDisbursement` proposal in the Safe multisig queue.
- [ ] Once threshold is reached, on-chain execution event transitions proposal status to `Approved`.
- [ ] Unit & integration tests verify signature polling, threshold detection, and status synchronization.
