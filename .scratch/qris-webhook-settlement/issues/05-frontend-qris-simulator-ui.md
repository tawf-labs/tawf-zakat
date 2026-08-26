# 05 — Frontend Two-Stage Dynamic QRIS & Simulator UI

**What to build:**
Enhance `DonateSection.tsx` in the frontend application to support a seamless two-stage state machine:
- Stage 1 (Pending Invoice): Display dynamic QR Code, amount IDR, countdown timer, status badge `PENDING`, one-click sandbox payment simulator button, and smart polling to detect payment status.
- Stage 2 (Paid Receipt): Automatically transition upon payment to the Digital Receipt view displaying `PAID (Antrian Batch L1)` badge, the cryptographic *Secret Salt*, transaction details, and a direct CTA link to test Merkle inclusion verification.

**Blocked by:** 03 — Webhook Settlement & Payment Simulator API, 04 — Merkle Batch Settlement Queue for PAID Donations

**Status:** ready-for-agent

- [ ] Stage 1 renders QR Code and "Simulasikan Pembayaran QRIS" button.
- [ ] Clicking simulation triggers backend simulator endpoint.
- [ ] Smart polling detects `PAID` state and smoothly transitions to Stage 2.
- [ ] Stage 2 displays Receipt, Secret Salt with copy button, and link to verification.
