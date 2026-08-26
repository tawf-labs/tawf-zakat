# 02 — Fiat Donation Schema & Invoice Generation API

**What to build:**
Schema enhancement for the `donations` table in PostgreSQL / Drizzle ORM to track payment statuses (`PENDING`, `PAID`, `BATCHED`), payment method (`QRIS`), QR code payload/URL, and paid timestamp. Update `POST /api/donations/fiat` to initialize invoices as `PENDING` with dynamic QRIS, and implement `GET /api/donations/status/:trxId` to allow clients to query invoice status.

**Blocked by:** 01 — Core Midtrans Service & SHA-512 Signature Verifier

**Status:** ready-for-agent

- [ ] Schema `donations` updated with `status`, `paymentMethod`, `qrString`, `qrUrl`, and `paidAt`.
- [ ] `POST /api/donations/fiat` returns status `PENDING`, `trxId`, `salt`, `amountIDR`, `qrUrl`, and `qrString`.
- [ ] `GET /api/donations/status/:trxId` returns current donation state.
