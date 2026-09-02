# Issue 03: Transparency Dashboard Cryptographic Attestation Badge & Dual Links

## Description
Update `TransparencyDashboard.tsx` and public audit trail views to display the verified cryptographic attestation badge with the auditor's address (`0xe8A4Ee352B95A4FC08667Df5d85c167006FE2A2f`), direct links to the IPFS WTP report, and the Sepolia Etherscan transaction link.

## Blocked by
- 01 — Backend EIP-712 Signature Verification & Relayer On-Chain Sponsorship
- 02 — Frontend MetaMask EIP-712 Signing & Strict Auditor Role Enforcement

## Acceptance criteria
- [x] Displays *"Cryptographically Signed by Auditor (EIP-712)"* badge in the 3rd Receipt card.
- [x] Renders direct link to Sepolia Etherscan (`https://sepolia.etherscan.io/tx/...`).
- [x] Renders direct link to IPFS gateway (`https://ipfs.io/ipfs/...`).
- [x] Truncated signature preview with one-click copy button.
- [x] Full end-to-end flow verified.
