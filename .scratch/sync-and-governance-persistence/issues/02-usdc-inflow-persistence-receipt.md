# 02 — Web3 USDC Inflow Persistence & Cryptographic Receipt Generation

**GitHub Issue:** [#24](https://github.com/tawf-labs/tawf-zakat/issues/24)
**Parent:** [#22](https://github.com/tawf-labs/tawf-zakat/issues/22)

**What to build:**
Provide a unified donation logging API (`POST /api/donations/usdc`) and connect the frontend USDC donation flow so that upon MetaMask transaction confirmation, the donation is persisted to Neon DB (`donations` table). Support Mode Hamba Allah via Commitment Hash (`Keccak256(wallet + salt + amount)`) and render a Digital Receipt with a Secret Salt and Verifier link.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Backend provides `POST /api/donations/usdc` inserting records into `donations` with `status: PAID` and `paymentMethod: USDC`.
- [ ] Frontend triggers `POST /api/donations/usdc` after `depositUSDC` on-chain confirmation.
- [ ] Mode Hamba Allah generates a Secret Salt and calculates `commitmentHash`, anonymizing the donor name and public profile.
- [ ] Frontend displays the Digital Receipt with Secret Salt and direct link to the Merkle Verifier tab.
- [ ] Unit & integration tests pass for USDC donation recording in database service.
