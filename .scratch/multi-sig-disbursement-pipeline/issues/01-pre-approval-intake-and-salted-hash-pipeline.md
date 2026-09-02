# 01 — Pre-Approval Intake & Salted Hash Dossier Pipeline

**GitHub Issue:** [#27](https://github.com/tawf-labs/tawf-zakat/issues/27)
**Parent Issue:** [#26](https://github.com/tawf-labs/tawf-zakat/issues/26)

**What to build:** Provide Amil officers with a complete workflow to submit new zakat assistance proposals. The system validates the 8-Asnaf classification, computes a cryptographic salted hash of the mustahik's identity (`Keccak256(NIK + Nama + Salt)`) to preserve privacy, uploads structured proposal metadata and verification documents to IPFS (`proposalMetadataCID`), persists the record to Neon DB, and prepares/executes the on-chain `proposeDisbursement` transaction on Sepolia L1.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Amil can fill a proposal intake form specifying program title, Asnaf category (1-8), amount, currency (IDR / USDC), recipient identifier/address, and upload supporting survey documents.
- [ ] Backend generates a collision-resistant `beneficiaryHash = keccak256(abi.encodePacked(nik, fullName, secretSalt))` where `secretSalt` remains protected in the backend.
- [ ] Backend pins structured `Proposal Metadata JSON` (containing masked name, city, Asnaf rationale, and survey doc links) to IPFS, returning `proposalMetadataCID`.
- [ ] Proposal record is stored in Neon PostgreSQL `disbursement_proposals` table.
- [ ] Amil wallet successfully submits `proposeDisbursement(...)` to `ZakatProtocolL1.sol` on Sepolia L1 and updates the record with `proposalIdOnChain`.
- [ ] Automated integration tests verify API endpoint validation, hash generation, and on-chain proposal creation.
