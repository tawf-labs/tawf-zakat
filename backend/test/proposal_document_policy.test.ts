import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DISBURSEMENT_POLICY,
  validateProposalForSubmission,
  type ProposalDocumentRecord,
  type ProposalDraftInput,
} from "../src/disbursement";

// ADR-0040: one recipient verification document (berita acara / surat
// keterangan, e.g. from RT/RW) for the whole roster is the default; per-mustahik
// KTP/KK, alternative identity proof and guardian proof are opt-in policy.

const draft = (): ProposalDraftInput => ({
  programId: "prog-1",
  originOfRequest: "Data warga dari RT 03/RW 05",
  purpose: "Santunan dhuafa",
  aidPeriod: { start: "2026-10-01", end: "2026-10-31" },
  personInCharge: "Bendahara",
  beneficiaries: [
    {
      id: "ben-nik",
      name: "Siti",
      identityBasis: { kind: "NIK", value: "3674010101010001" },
      asnaf: "FAKIR",
      addressOrScope: "RT 03/RW 05",
      guardian: null,
      paymentRecipient: null,
    },
    {
      id: "ben-alt",
      name: "Ahmad",
      identityBasis: { kind: "ALTERNATIVE", description: "Belum memiliki KTP" },
      asnaf: "MISKIN",
      addressOrScope: "RT 03/RW 05",
      guardian: { name: "Rahmat", relationship: "Ayah" },
      paymentRecipient: null,
    },
  ],
  aidLines: [
    {
      id: "line-1",
      beneficiaryId: "ben-nik",
      aidType: "Uang tunai",
      period: "2026-10",
      value: { kind: "MONEY", amountRequestedIdr: "500000", amountApprovedIdr: null },
    },
    {
      id: "line-2",
      beneficiaryId: "ben-alt",
      aidType: "Uang tunai",
      period: "2026-10",
      value: { kind: "MONEY", amountRequestedIdr: "500000", amountApprovedIdr: null },
    },
  ],
});

type Doc = Pick<ProposalDocumentRecord, "category" | "beneficiaryId" | "storageStatus">;
const verification: Doc = { category: "RECIPIENT_VERIFICATION", beneficiaryId: null, storageStatus: "STORED" };
const documentFields = (docs: Doc[], policy = DEFAULT_DISBURSEMENT_POLICY("inst")) =>
  validateProposalForSubmission(draft(), docs, policy)
    .filter((issue) => issue.scope === "document")
    .map((issue) => issue.field);

describe("proposal document policy", () => {
  test("the default policy asks only for one recipient verification document", () => {
    const policy = DEFAULT_DISBURSEMENT_POLICY("inst");
    expect(policy.requireRecipientVerification).toBe(true);
    expect(policy.requireProposalLetter).toBe(false);
    expect(policy.requireIdentityDoc).toBe(false);
    expect(policy.requireAlternativeIdProof).toBe(false);
    expect(policy.requireGuardianProof).toBe(false);

    expect(documentFields([])).toEqual(["documents.recipientVerification"]);
  });

  test("one stored verification document completes the whole roster", () => {
    expect(documentFields([verification])).toEqual([]);
  });

  test("a verification document that failed to store does not count", () => {
    expect(documentFields([{ ...verification, storageStatus: "FAILED" }])).toEqual([
      "documents.recipientVerification",
    ]);
  });

  test("a per-mustahik KTP/KK does not stand in for the roster verification", () => {
    expect(
      documentFields([{ category: "BENEFICIARY_IDENTITY", beneficiaryId: "ben-nik", storageStatus: "STORED" }])
    ).toEqual(["documents.recipientVerification"]);
  });

  test("an institution can still require per-mustahik documents through its policy", () => {
    const strict = {
      ...DEFAULT_DISBURSEMENT_POLICY("inst"),
      requireRecipientVerification: false,
      requireIdentityDoc: true,
      requireAlternativeIdProof: true,
      requireGuardianProof: true,
    };
    expect(documentFields([], strict).sort()).toEqual([
      "documents.alternativeProof",
      "documents.guardianProof",
      "documents.identity",
    ]);
  });
});
