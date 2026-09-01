# ADR 0009: Gasless EIP-712 Independent Auditor Attestation and Relayer Gas Sponsorship

- **Status:** Accepted
- **Date:** 2026-09-01
- **Domain:** Governance, Ex-Post Auditing, Cryptographic Attestation, Account Abstraction

---

## 1. Context and Problem Statement

In the Tawf Zakat Protocol, the **Independent Auditor (KAP / BAZNAS)** performs ex-post verification over executed disbursements, matching bank mutation proofs, IPFS BAST receipts, and beneficiary hashes before issuing an official **WTP (Wajar Tanpa Pengecualian / Unqualified Opinion)**.

Previously, the auditor's attestation was recorded off-chain via IPFS metadata pinning, with a simulated transaction hash. However:
1. **Lack of Cryptographic Proof of Authorship**: Anyone calling the backend API could claim to be the auditor without cryptographic proof that the signature originated from the designated `AUDITOR_ROLE` private key (`0xe8A4Ee352B95A4FC08667Df5d85c167006FE2A2f`).
2. **Auditor Gas Burden**: If the auditor were forced to execute a direct on-chain Ethereum transaction, institutional audit firms would require holding Sepolia testnet ETH / mainnet gas tokens, creating unacceptable onboarding friction.

---

## 2. Decision Drivers

- **Zero-Gas Experience (Account Abstraction)**: The auditor must not pay gas fees or manage ETH balances.
- **Cryptographic Non-Repudiation**: The attestation must contain a valid ECDSA signature verifiable on-chain and off-chain via `ecrecover`.
- **EIP-712 Structured Data Standard**: The MetaMask signing dialog must display human-readable, typed fields (Domain, Proposal ID, Asnaf, Amount, Opinion, Standard, Timestamp) to prevent blind signing and phishing.
- **On-Chain Audit Trail on Sepolia**: The backend Relayer must sponsor the gas fee and broadcast the verified attestation on-chain, generating an authentic Sepolia Etherscan transaction link.

---

## 3. Considered Options

1. **Option A (Pure Off-Chain IPFS Attestation)**: Auditor signs client-side; signature stored only on IPFS. (Rejected: No on-chain event or Etherscan transaction).
2. **Option B (Direct On-Chain Transaction by Auditor)**: Auditor pays gas fee directly. (Rejected: High friction for external audit firms).
3. **Option C (EIP-712 MetaMask Signing + Sponsored Relayer On-Chain Broadcast)**: **Selected**.

---

## 4. Decision Outcome

We choose **Option C**:

1. **EIP-712 Domain & Types**:
   - Domain: `name: "Tawf Zakat Protocol"`, `version: "1"`, `chainId: 11155111`, `verifyingContract: ZAKAT_PROTOCOL_L1_ADDRESS`.
   - Primary Type: `AuditorAttestation(uint256 proposalId, bytes32 beneficiaryHash, uint256 amountIDR, string auditOpinion, string standard, string auditorName, uint256 timestamp)`.
2. **MetaMask Signing in Frontend**:
   - The frontend prompts the auditor's connected wallet (`useSignTypedData`) with the structured EIP-712 payload.
   - The resulting signature `0x...` is sent to `POST /api/audit/attest`.
3. **Backend Relayer Verification & Gas Sponsorship**:
   - The backend validates the signature using `verifyTypedData` from Viem against the on-chain `AUDITOR_ROLE` whitelist.
   - The backend pins the signed dossier to IPFS (`uploadAuditReportToIPFS`).
   - The Relayer broadcasts the attestation to Sepolia L1 with gas sponsorship, recording the real transaction hash in PostgreSQL.
4. **Transparency Explorer Integration**:
   - The public Transparency Dashboard displays the verified cryptographic badge: *"EIP-712 Cryptographically Signed by Auditor (0xe8A4...2A2f)"* with direct links to both IPFS and Etherscan.

---

## 5. Consequences

### Positive
- 100% gasless UX for audit firms.
- Mathematically non-repudiable proof of audit compliance.
- Complete alignment with PSAK 109 and BAZNAS institutional governance requirements.

### Negative
- Requires the backend Relayer to maintain Sepolia ETH balance for transaction sponsorship.
