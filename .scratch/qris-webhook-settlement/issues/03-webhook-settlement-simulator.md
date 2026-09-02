# 03 — Webhook Settlement & Payment Simulator API

**What to build:**
Secure and idempotent Webhook handler `POST /api/webhooks/payment` that validates Midtrans SHA-512 signatures, transitions matching `PENDING` donations to `PAID`, sets `paidAt`, and prevents double-processing. Also provide `POST /api/webhooks/simulator` to trigger instant sandbox payments during hackathon demonstrations.

**Blocked by:** 02 — Fiat Donation Schema & Invoice Generation API

**Status:** ready-for-agent

- [ ] `POST /api/webhooks/payment` validates signature and marks donation `PAID`.
- [ ] Invalid signatures return 401 Unauthorized.
- [ ] Duplicate webhooks return 200 OK without re-processing (idempotency).
- [ ] `POST /api/webhooks/simulator` allows instantaneous payment simulation for a given `trxId`.
