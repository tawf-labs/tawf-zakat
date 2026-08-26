# 04 — Merkle Batch Settlement Queue for PAID Donations

**What to build:**
Update the Relayer batch settlement service and endpoint `POST /api/relayer/settle-batch` so it exclusively aggregates donations with `status = 'PAID'` (and `batch_id IS NULL`), hashes their leaves into the Merkle tree, submits the batch root on-chain to Ethereum Sepolia L1, and updates their status to `BATCHED`.

**Blocked by:** 03 — Webhook Settlement & Payment Simulator API

**Status:** ready-for-agent

- [ ] Relayer queries only `PAID` unbatched donations.
- [ ] Non-paid or already batched donations are ignored.
- [ ] Successfully settled donations transition to `BATCHED` and link to the new `batch_id`.
- [ ] Merkle verification proof endpoint works for `BATCHED` donations.
