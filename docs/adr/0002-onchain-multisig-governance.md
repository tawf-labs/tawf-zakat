# ADR-0002: On-Chain Multi-Sig 2-of-3 Proposal Governance for Zakat Disbursement

- **Status**: Accepted
- **Date**: 2026-08-24
- **Deciders**: User, Agent

## Context and Problem Statement

Zakat funds earmarked for mustahik (87.5% of total inflow) require strict authorization before disbursement to prevent unilateral embezzlement or fictitious beneficiaries. The protocol specifies a 2-of-3 approval quorum among:
1. Operational Amil (`AMIL_ROLE` / `DEFAULT_ADMIN_ROLE`)
2. Sharia Supervisory Board (`SHARIA_SUPERVISOR_ROLE` / DPS)
3. Independent Auditor (`AUDITOR_ROLE`)

We needed to decide between an on-chain proposal state machine vs off-chain EIP-712 signature batching.

## Decision Drivers

- Complete transparency: Donors and the public must see pending disbursement proposals and their approval status in real-time.
- Immutability and auditability: Every approval and rejection should be an on-chain event.
- Anti-double claim protection before fund release.

## Considered Options

1. **On-Chain Proposal State Machine**: `proposeDisbursement` creates proposal, `approveDisbursement` collects on-chain approvals, `executeDisbursement` releases funds once quorum >= 2.
2. **Off-Chain EIP-712 Signature Aggregation**: Relayer collects off-chain signatures and calls `recordDisbursementWithSignatures` in a single transaction.

## Decision Outcome

Chosen Option: **Option 1 (On-Chain Proposal State Machine)**.

### Positive Consequences

- Public dashboard can display pending proposals, who approved them, and proof attachments (IPFS CIDs) before execution.
- Clear separation of duty between proposing, approving, and executing.
- Straightforward contract state verification without off-chain signature relay failure risks.

## Pros and Cons of the Options

### Option 1 (Chosen)
- **Pro**: Real-time transparency of pending proposals.
- **Pro**: Immutable audit trail for each stakeholder's vote.
- **Con**: Requires multiple on-chain transactions (Propose, Approve, Execute) paid by Relayer/Amil gas.
