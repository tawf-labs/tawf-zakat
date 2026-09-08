import { keccak256, toHex, zeroAddress } from "viem";
import { computeDonationLeaf, MerkleTree, type DonationRecord } from "../merkle";

export const DEMO_SEED_ID = "DEMO-20260909-v1";
export const DEMO_BATCH_ID = 20260909;
export const DEMO_TOKEN_AMOUNT = 100_000_000n; // 100 MockUSDC, six decimals.
export const DEMO_GAS_BUDGET = 3_000_000_000_000_000n; // 0.003 testnet ETH upper bound.
export const demoDonations: DonationRecord[] = [2500000, 1000000, 5000000, 750000,
  3000000, 15000000, 2000000, 500000].map((amountIDR, index) => ({
  trxId: `${DEMO_SEED_ID}-${index + 1}`, donorName: `DEMO sintetis — Muzakki ${index + 1}`,
  isAnonymous: index % 2 === 1, salt: `${DEMO_SEED_ID}-synthetic-salt-${index + 1}`,
  amountIDR, status: "BATCHED", paymentMethod: "QRIS", timestamp: "2026-09-09T00:00:00.000Z",
}));
export const demoTotalIDR = demoDonations.reduce((sum, d) => sum + d.amountIDR, 0);
export const demoMerkleRoot = new MerkleTree(demoDonations.map(d => computeDonationLeaf(d.trxId, d.salt, d.amountIDR))).getRoot();
export const demoProposals = [
  { key: "pangan", label: "DEMO sintetis — Bantuan pangan", amount: 2500000n, asnaf: 0, cancel: false },
  { key: "usaha", label: "DEMO sintetis — Modal usaha", amount: 5000000n, asnaf: 1, cancel: false },
  { key: "batal", label: "DEMO sintetis — Pengajuan dibatalkan", amount: 1000000n, asnaf: 1, cancel: true },
].map(p => ({ ...p, beneficiaryHash: keccak256(toHex(`${DEMO_SEED_ID}-${p.key}`)),
  currencyType: 0 as const, periodId: 202609n, recipient: zeroAddress }));
