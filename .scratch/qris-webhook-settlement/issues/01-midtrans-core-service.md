# 01 — Core Midtrans Service & SHA-512 Signature Verifier

**What to build:**
A resilient Midtrans service module that can charge dynamic QRIS payments via Midtrans Core API `/v2/charge` (or gracefully fallback to a deterministic local SVG QR mock generator when server keys are not configured) and securely verify Midtrans webhook SHA-512 signatures against order IDs, status codes, and gross amounts.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Function `verifyMidtransSignature(orderId, statusCode, grossAmount, serverKey, signatureKey)` calculates SHA-512 correctly and returns boolean.
- [ ] Function `chargeQRIS(trxId, amountIDR, donorName)` calls Midtrans Core API when `MIDTRANS_SERVER_KEY` is present or returns a valid mock QR payload with `qrString` and `qrUrl` when absent.
- [ ] Unit tests for signature verification and charge service pass.
