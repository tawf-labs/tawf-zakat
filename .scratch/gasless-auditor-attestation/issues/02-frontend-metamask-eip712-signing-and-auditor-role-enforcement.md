# Issue 02: Frontend MetaMask EIP-712 Signing & Strict Auditor Role Enforcement

## Description
Integrate Wagmi's `useSignTypedData` hook in `GovernanceSection.tsx` and the Auditor Modal. When the auditor clicks "Terbitkan Atestasi Opini WTP", construct the EIP-712 typed payload, prompt MetaMask to request a gasless signature, enforce that the connected wallet holds `AUDITOR_ROLE` (`0xe8A4Ee352B95A4FC08667Df5d85c167006FE2A2f`), and send the signature to the backend.

## Blocked by
- 01 — Backend EIP-712 Signature Verification & Relayer On-Chain Sponsorship

## Acceptance criteria
- [x] ConnectKit / Wagmi `useSignTypedData` hooked into the Auditor modal.
- [x] Displays human-readable fields in MetaMask (Domain, Proposal ID, Beneficiary Hash, Amount, Opinion, Standard, Timestamp).
- [x] Non-auditor wallets are prevented from signing or given a clear warning if they lack `AUDITOR_ROLE`.
- [x] Sonner toast provides feedback during signing and transaction submission.
- [x] Frontend builds with zero TypeScript errors.
