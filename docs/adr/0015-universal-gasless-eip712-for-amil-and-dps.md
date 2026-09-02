# ADR 0015: Universal Gasless EIP-712 Governance for Amil and Dewan Pengawas Syariah (DPS)

- **Status:** Accepted
- **Date:** 2026-09-02
- **Domain:** Governance, Account Abstraction, Relayer Engine, EIP-712 Meta-Transactions, Syariah Compliance

---

## 1. Context and Problem Statement

In the Tawf Zakat Protocol, the lifecycle of aid distribution involves three institutional actors:
1. **Amil Operasional** (`DEFAULT_ADMIN_ROLE`): Prepares and submits proposals (`proposeDisbursement`), executes fund disbursement (`executeDisbursement`), and handles cancellations (`cancelProposal`).
2. **Dewan Pengawas Syariah (DPS)** (`SHARIA_SUPERVISOR_ROLE`): Evaluates sharia compliance across 8 Asnaf categories and approves (`approveDisbursement`) or rejects proposals (`cancelProposal`).
3. **Independent Auditor** (`AUDITOR_ROLE`): Performs ex-post auditing and issues WTP attestations.

Previously, only the **Auditor** enjoyed a gasless experience (ADR 0009). Amil staff and DPS scholars were required to maintain ETH balances in their wallets to pay gas fees for proposal creation, approval, execution, and cancellation. This created operational friction, risk of transaction stalling due to empty gas balances, and unnecessary complexity for non-technical religious scholars on the sharia board.

Meanwhile, **Muzakki** transactions follow their intended dual-gate: Fiat donors use gasless Web2 rails (QRIS/VA batch-settled by the Relayer), while Web3 crypto donors execute standard on-chain ERC-20 deposits directly.

---

## 2. Decision Drivers

- **Zero-Gas Burden for Amil and DPS**: Neither Amil officers nor DPS scholars should ever be required to buy, bridge, or hold ETH for gas fees to execute daily governance workflows.
- **Cryptographic Non-Repudiation (EIP-712)**: Every governance decision must remain cryptographically verifiable through structured typed signatures, preventing unauthorized spoofing or blind signing.
- **Clean & Professional Typography**: Action buttons and status prompts must use clean, uncluttered terminology (e.g., *"Ajukan Proposal"*, *"Setujui Penyaluran"*, *"Eksekusi Penyaluran"*) without distracting *"0 Gas / Gasless Sponsored"* labels.
- **Strict Role Verification at Relayer**: The backend Relayer must cryptographically verify signatures and assert role membership before broadcasting transactions on-chain.
- **Immutable On-Chain & IPFS Trail**: Verified signatures, transaction hashes, and dossier CIDs must be broadcast to the blockchain ledger and synced across PostgreSQL and the real-time WebSocket bus.

---

## 3. Considered Options

1. **Option A (Direct On-Chain Gas Payment by Amil & DPS)**: Require Amil and DPS wallets to fund gas fees directly. *(Rejected: High operational friction and UX complexity).*
2. **Option B (ERC-4337 Smart Contract Wallet Infrastructure)**: Implement full ERC-4337 Account Abstraction Paymasters. *(Rejected: Excessive architectural overhead for the current L1/L2 scope).*
3. **Option C (Universal EIP-712 Typed Signatures + Relayer Sponsorship Engine)**: **Selected**. Extends the proven ADR 0009 EIP-712 pattern to all governance actions of Amil and DPS.

---

## 4. Decision Outcome

We choose **Option C**:

### 1. EIP-712 Domain & Typed Message Definitions
- **EIP-712 Domain**:
  ```ts
  {
    name: "Tawf Zakat Protocol",
    version: "1",
    chainId: 421614, // Arbitrum Sepolia
    verifyingContract: ZAKAT_PROTOCOL_L1_ADDRESS,
  }
  ```
- **Typed Schemas**:
  1. `AmilProposal`:
     - Fields: `currencyType (uint8)`, `amount (uint256)`, `asnafCategory (uint8)`, `beneficiaryHash (bytes32)`, `ipfsProofCID (string)`, `periodId (uint256)`, `usdcRecipient (address)`, `timestamp (uint256)`
  2. `DpsApproval`:
     - Fields: `proposalId (uint256)`, `decision (string)`, `notes (string)`, `timestamp (uint256)`
  3. `AmilExecution`:
     - Fields: `proposalId (uint256)`, `disbursementReceiptCID (string)`, `timestamp (uint256)`
  4. `ProposalCancellation`:
     - Fields: `proposalId (uint256)`, `reason (string)`, `timestamp (uint256)`

### 2. Backend Relayer Endpoints
The backend introduces dedicated gasless governance routes:
- `POST /api/governance/gasless-propose`
- `POST /api/governance/gasless-approve`
- `POST /api/governance/gasless-execute`
- `POST /api/governance/gasless-cancel`

Each endpoint:
1. Reconstructs and verifies the EIP-712 signature using Viem's `verifyTypedData`.
2. Validates that the recovered signer has the authorized role (`DEFAULT_ADMIN_ROLE` or `SHARIA_SUPERVISOR_ROLE`).
3. Uses the backend Relayer account (`RELAYER_ROLE` / `PRIVATE_KEY`) to submit and pay the gas for the on-chain transaction.
4. Updates PostgreSQL state via Drizzle ORM and emits real-time WebSocket events (`eventBus.broadcast`).

### 3. Clean UX & Seamless Client Integration
- Frontend components (`CreateProposalModal`, `DpsSafeApprovalCard`, `DisbursementActionModal`, `AuditorAttestationPanel`) use `useSignTypedData()` to collect signatures with zero gas prompt in MetaMask/Rabby.
- Clean typography across all UI controls without noisy gasless tags.

---

## 5. Consequences

### Positive
- Amil and DPS experience seamless, instant 1-click digital signing without gas management.
- All governance actions are cryptographically authenticated and non-repudiable.
- Fully backwards-compatible with existing on-chain contracts on Sepolia/Arbitrum Sepolia.

### Negative
- Relayer wallet must maintain adequate native gas balance to sponsor transaction fees.
