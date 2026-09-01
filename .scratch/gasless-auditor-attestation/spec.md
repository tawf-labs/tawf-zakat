# Spec: Gasless EIP-712 Independent Auditor Attestation & Relayer Gas Sponsorship

- **Status:** Ready for Agent
- **Date:** 2026-09-01
- **Domain:** Ex-Post Audit, Cryptographic Non-Repudiation, EIP-712, Relayer Meta-Transactions

---

## Problem Statement

When an independent auditor (e.g. Kantor Akuntan Publik / BAZNAS Sharia Auditor) reviews an executed zakat disbursement, they currently submit an attestation that is stored as an IPFS metadata document without a verifiable cryptographic wallet signature. Consequently:
1. There is no mathematical guarantee that the attestation was authored by the authorized `AUDITOR_ROLE` private key (`0xe8A4Ee352B95A4FC08667Df5d85c167006FE2A2f`).
2. Requiring the external audit firm to execute on-chain transactions directly would impose gas fee friction (forcing them to hold testnet/mainnet ETH).

---

## Solution

We implement a **Gasless EIP-712 Cryptographic Attestation Pipeline**:
1. **Human-Readable EIP-712 Signing in MetaMask**: The auditor signs structured typed data (`Tawf Zakat Protocol`, Proposal ID, Asnaf, Amount, Opinion WTP, PSAK 109 standard, Timestamp) with **zero gas fees**.
2. **Backend Relayer Gas Sponsorship & On-Chain Broadcast**: The backend validates the ECDSA signature against the authorized `AUDITOR_ROLE` address, embeds the signature into the IPFS audit dossier, and the Relayer broadcasts the attestation to Sepolia L1, paying the gas fee.
3. **Public Transparency Verifiable Badge**: The Public Transparency Explorer displays a verified badge *"Cryptographically Signed by Auditor (0xe8A4...2A2f)"* with links to both the IPFS audit report and the Sepolia Etherscan transaction.

---

## User Stories

1. As an **Independent Auditor**, I want to review executed disbursement proposals with their IPFS BAST receipts and bank reference numbers, so that I can independently verify funds reached valid mustahik.
2. As an **Independent Auditor**, I want to select an audit opinion (e.g. `WTP` - Wajar Tanpa Pengecualian) and enter compliance notes in accordance with PSAK 109 / SAS 109 standards, so that the protocol adheres to national zakat accounting rules.
3. As an **Independent Auditor**, I want to sign the attestation using my Web3 wallet (MetaMask) via EIP-712 structured data without paying any gas fees, so that my professional certification is mathematically non-repudiable without onboarding friction.
4. As a **Relayer Engine**, I want to verify the auditor's ECDSA signature cryptographically before sponsoring and broadcasting the transaction to Ethereum Sepolia L1, so that malicious or unauthorized signatures are rejected.
5. As a **Muzakki or Public Observer**, I want to view the auditor's verified signature and Etherscan transaction link on the Public Transparency Explorer, so that I have absolute trust that the audit was performed by an authorized independent auditor.

---

## Implementation Decisions

1. **EIP-712 Domain Definition**:
   - `name: "Tawf Zakat Protocol"`
   - `version: "1"`
   - `chainId: 11155111` (Sepolia)
   - `verifyingContract: ZAKAT_PROTOCOL_L1_ADDRESS`

2. **EIP-712 Type Schema (`AuditorAttestation`)**:
   - `proposalId`: `uint256`
   - `beneficiaryHash`: `bytes32`
   - `amountIDR`: `uint256`
   - `auditOpinion`: `string`
   - `standard`: `string`
   - `auditorName`: `string`
   - `timestamp`: `uint256`

3. **Frontend Wagmi Hook Integration**:
   - In `GovernanceSection.tsx` and `TransparencyDashboard.tsx`, replace mock submission with `useSignTypedData()`.
   - Validate connected wallet against `AUDITOR_ROLE` (`0xe8A4Ee352B95A4FC08667Df5d85c167006FE2A2f`).

4. **Backend API (`POST /api/audit/attest`)**:
   - Accept `proposalId`, `auditorName`, `auditorAddress`, `auditOpinion`, `auditNotes`, `auditCertFileName`, `signature`, `messageData`.
   - Verify signature using `verifyTypedData` from Viem.
   - Pin signed report to IPFS.
   - Execute sponsored on-chain settlement/logging via Relayer wallet client.
   - Update `disbursement_proposals` table with `audit_status = 'AUDITED_WTP'`, `audit_opinion`, `audit_report_cid`, `audit_tx_hash`, `audited_at`.

5. **Toast UX & Sonner Feedback**:
   - Track transaction lifecycle with `useTxToast()` and human-readable messages.

---

## Testing Decisions

- **Backend Integration Test**: Test `POST /api/audit/attest` with valid Viem-generated EIP-712 signature (verifying success, IPFS pinning, and DB status update) and with invalid signature (verifying HTTP 401 rejection).
- **Frontend Typecheck & Build**: Verify clean compilation of `GovernanceSection.tsx` and Wagmi `signTypedData` hook with zero TypeScript errors.

---

## Out of Scope

- Automated legal dispute escalation smart contracts (manual governance retains emergency veto).
