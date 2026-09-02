# 03 — Zakat Donation Flow & BAZNAS Calculator

## Parent
Parent issue: #39

## What to build
Build a dedicated, distraction-free zakat and infaq checkout flow at `/donasi` (`src/features/donation/` and `routes/donasi.tsx`).

The module must include an interactive BAZNAS Sharia Zakat Calculator (supporting Zakat Penghasilan based on monthly income minus living expenses vs. gold nisab, and Zakat Maal based on total savings vs. 85g gold nisab), automated pre-fill into the payment form, Arabic/Latin/Indonesian Zakat Niat (intention) cards, dual payment selection (QRIS & Bank Virtual Account via Midtrans, and on-chain USDC transfer via Wagmi/ConnectKit), and instant digital receipt generation.

## Acceptance criteria
- [x] Create `src/features/donation/` domain slice with subcomponents: `ZakatCalculator.tsx`, `DonationForm.tsx`, `PaymentMethodSelector.tsx`, `NiatCard.tsx`, and `PaymentSuccessModal.tsx`.
- [x] Implement BAZNAS sharia calculation logic with accurate nisab comparisons and dynamic 2.5% calculation.
- [x] Provide "Salurkan Sekarang" button in calculator that seamlessly populates the donation form's nominal and category fields.
- [x] Implement dual-payment handling: fiat Midtrans QRIS/VA intake and direct Sepolia USDC deposit (`depositUSDC`) with 2-step allowance handling.
- [x] Display digital intention (*niat*) text dynamically corresponding to chosen zakat category.
- [x] Route `/donasi.tsx` composes the donation feature with responsive mobile layout.

## Blocked by
- Ticket 01 — Core UI Primitives, Layout Shell & Multi-Route Navigation Bar
