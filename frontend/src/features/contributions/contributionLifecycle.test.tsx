import { describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrivateRequests } from "../workspace/privateRequests";
import { ContributionDetailModal } from "./ContributionDetailModal";
import { ContributionCorrectionModal } from "./ContributionCorrectionModal";
import { RefundPaymentModal } from "./RefundPaymentModal";
import { DonorContributionSummary } from "../donor/DonorContributionSummary";
import type { ContributionDetailResponse, ContributionRefund } from "./contributionClient";
import { useOperationIds } from "./contributionUi";

const NOW = 1_800_000_000;
const detail: ContributionDetailResponse = {
  success: true, capabilities: { canCorrect: true }, history: [], documents: [], refunds: [], events: [],
  contribution: {
    id: "contrib-review", institutionId: "inst-review", sourceChannel: "BANK_TRANSFER", sourceReference: "BANK-REVIEW",
    currencyUnit: "IDR", amountExact: "400000", fundType: "ZAKAT", purpose: "Bantuan pokok", receivedAt: NOW,
    donorName: "Donatur", donorContact: "donor@example.com", status: "ENDORSED", reconciledAt: NOW,
    reconciledBy: "recorder", reconciliationProofRef: "BANK-REVIEW", reconciliationNotes: null,
    endorsedAt: NOW, endorsedBy: "approver", endorsementMandateId: "mandate-review", endorsementNotes: "Koreksi disahkan",
    unqualifiedReason: null, allocatedAmount: "450000", unallocatedAmount: "0", shortfallAmount: "50000",
    version: 4, createdAt: NOW, updatedAt: NOW, createdBy: "recorder",
    proofValidity: { status: "NOT_AVAILABLE", isCurrent: false, label: "Bukti belum tersedia" },
  },
  corrections: [{ id: "cor-review", institutionId: "inst-review", contributionId: "contrib-review",
    fromVersion: 3, toVersion: 4, correctionType: "AMOUNT", fromAmountExact: "500000", toAmountExact: "400000",
    reason: "Koreksi mutasi bank", sourceProofRef: "PRIVATE-SOURCE", actorAccount: "correction-approver",
    actorOfficerId: "officer-review", createdAt: NOW }],
};
const requests: PrivateRequests = {
  contextId: "test", assertCurrent() {},
  async json() { throw new Error("Rendering must not perform a request"); },
  async blob() { throw new Error("Rendering must not perform a request"); },
};
const noop = () => {};
const refund: ContributionRefund = {
  id: "refund-review", contributionId: "contrib-review", institutionId: "inst-review", amountExact: "100000",
  currencyUnit: "IDR", fundType: "ZAKAT", reason: "Kelebihan transfer", policyBasis: "SOP Lembaga", status: "DECIDED",
  contributionVersion: 4, decidedAt: NOW, decidedBy: "approver", decidedByOfficerId: "officer-review",
  paidAt: null, paidBy: null, paidByOfficerId: null, paymentProofRef: null, paymentNotes: null,
  version: 1, createdAt: NOW, updatedAt: NOW,
};

describe("Contribution lifecycle UI", () => {
  it("renders nested proof status and correction attribution from the shared API contract", () => {
    const html = renderToStaticMarkup(<ContributionDetailModal requests={requests} detail={detail}
      canManage onReload={noop} onClose={noop} onError={noop} />);
    expect(html).toContain("Bukti belum tersedia");
    expect(html).toContain("correction-approver");
    expect(html).toContain(new Date(NOW * 1000).toLocaleString("id-ID"));
    expect(html).not.toContain("Invalid Date");
    expect(html).toContain("Rp 50.000");
    expect(html).not.toMatch(/AC\d+|US-\d+/);
  });
  it("hides corrections from recorders without endorsement authority", () => {
    const html = renderToStaticMarkup(<ContributionDetailModal requests={requests}
      detail={{ ...detail, capabilities: { canCorrect: false } }} canManage onReload={noop} onClose={noop} onError={noop} />);
    expect(html).not.toContain(">Koreksi Kontribusi</button>");
    expect(html).toContain("Koreksi harus disahkan petugas");
  });
  it("shows donor correction amounts and reasons without internal source locators", () => {
    const { fromVersion, toVersion, correctionType, fromAmountExact, toAmountExact, reason, createdAt } = detail.corrections![0];
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><DonorContributionSummary contribution={{ ...detail.contribution,
      donorContactMasked: "d***@example.com", zkProof: { status: "NOT_AVAILABLE" },
      corrections: [{ fromVersion, toVersion, correctionType, fromAmountExact, toAmountExact, reason, createdAt }] }} /></QueryClientProvider>);
    expect(html).toContain("Riwayat Kontribusi");
    expect(html).toContain("Koreksi mutasi bank");
    expect(html).toContain("Rp 500.000");
    expect(html).toContain("Rp 400.000");
    expect(html).not.toContain("PRIVATE-SOURCE");
    expect(html).not.toContain("correction-approver");
  });
  it("requires correction source evidence and provides the actual payment time field", () => {
    const correction = renderToStaticMarkup(<ContributionCorrectionModal requests={requests} target={detail.contribution}
      onDone={noop} onClose={noop} onError={noop} />);
    expect(correction).toContain("Nomor Bukti Sumber Koreksi (Wajib)");
    const payment = renderToStaticMarkup(<RefundPaymentModal requests={requests} contributionId={detail.contribution.id}
      refund={refund} currencyUnit="IDR" onDone={noop} onClose={noop} onError={noop} />);
    expect(payment).toContain('type="datetime-local"');
    expect(payment).not.toMatch(/AC\d+|US-\d+|idempotensi/);
  });
  it("keeps one operation identity for an unchanged intent until success", () => {
    function Probe() {
      const operations = useOperationIds();
      const first = operations.operationFor("refund:1");
      expect(operations.operationFor("refund:1")).toBe(first);
      expect(operations.operationFor("refund:2")).not.toBe(first);
      operations.settle("refund:1");
      expect(operations.operationFor("refund:1")).not.toBe(first);
      return null;
    }
    renderToStaticMarkup(<Probe />);
  });
});
