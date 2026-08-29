# 04 — Public Transparency Audit Trail & Verifiable Proof Explorer

**GitHub Issue:** [#30](https://github.com/tawf-labs/tawf-zakat/issues/30)
**Parent Issue:** [#26](https://github.com/tawf-labs/tawf-zakat/issues/26)

**What to build:** A public-facing transparency and verification interface allowing muzakki (donors), auditors, and the public to inspect all executed zakat disbursements. The portal visualizes the distribution breakdown across the 8 Asnaf categories, displays the exact invariant compliance (Amil <= 12.5%, Mustahik >= 87.5%), provides one-click verification of IPFS BAST receipts, and links directly to Sepolia Etherscan transaction receipts.

**Blocked by:** 03 — Disbursement Execution, Multi-Unit Settlement & BAST Pipeline ([#29](https://github.com/tawf-labs/tawf-zakat/issues/29))

**Status:** ready-for-agent

- [ ] Public transparency dashboard lists all executed zakat programs with program title, Asnaf category badge, disbursed amount (IDR / USDC), timestamp, and execution transaction link.
- [ ] Interactive 8-Asnaf allocation chart shows percentage and nominal totals disbursed per Sharia category (Fakir, Miskin, Fisabilillah, etc.).
- [ ] Users can click to inspect the IPFS BAST receipt dossier (viewing the masked beneficiary proof, signed receipt, and timestamp).
- [ ] Protocol invariant summary dynamically displays cumulative collected, disbursed, and remaining mustahik vs amil funds.
- [ ] Full end-to-end frontend typecheck and build validation passes without warnings or errors.
