# 01 — Live On-Chain Balance Sync & Hybrid Metrics in Transparency Dashboard

**GitHub Issue:** [#23](https://github.com/tawf-labs/tawf-zakat/issues/23)
**Parent:** [#22](https://github.com/tawf-labs/tawf-zakat/issues/22)

**What to build:**
Make the Transparency Dashboard (`#transparency`) dynamically read live vault and treasury balances directly from the deployed Ethereum Sepolia smart contract (`0x72b60a0C37a78dF62295F88294E790083089f665`) using Viem Public Client. Display hybrid metrics combining on-chain final settlements with real-time pending fiat batch queue indicators from Neon DB.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Viem Public Client reads `totalCollectedIDR`, `mustahikVaultIDR`, `amilTreasuryIDR`, `totalDisbursedIDR`, `totalCollectedUSDC`, `mustahikVaultUSDC`, `amilTreasuryUSDC`, and `totalDisbursedUSDC` directly from Sepolia smart contract.
- [ ] Dashboard displays live locked funds for Mustahik (>= 87.5%) and Amil Treasury (<= 12.5%) in real-time.
- [ ] Dashboard shows active indicators for pending fiat donations waiting in the daily batch queue.
- [ ] Auto-refreshes data gracefully without freezing UI or spamming RPC rate limits.
