import { describe, expect, it } from "bun:test";
import type { Beneficiary } from "./disbursementClient";
import { requiredDocuments } from "./ProposalRequiredDocuments";

const beneficiary = (id: string): Beneficiary => ({
  id, name: `Penerima ${id}`, identityBasis: { kind: "NIK", value: "3674010101010001" },
  asnaf: "FAKIR", addressOrScope: "RT 03/RW 05", guardian: null, paymentRecipient: null,
});
const roster = [beneficiary("a"), beneficiary("b"), beneficiary("c")];
const lightPolicy = {
  requireProposalLetter: false, requireRecipientVerification: true,
  requireIdentityDoc: false, requireAlternativeIdProof: false, requireGuardianProof: false,
};

describe("requiredDocuments", () => {
  it("asks for one verification document for the whole roster, not one KTP/KK per mustahik", () => {
    const items = requiredDocuments(lightPolicy, roster, []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "verification", beneficiaryId: null, done: false });
  });

  it("is complete once the verification document is attached", () => {
    const items = requiredDocuments(lightPolicy, roster, [{ category: "RECIPIENT_VERIFICATION", beneficiaryId: null }]);
    expect(items).toEqual([expect.objectContaining({ key: "verification", done: true })]);
  });

  it("still lists per-mustahik KTP/KK when the institution's policy requires it", () => {
    const items = requiredDocuments({ ...lightPolicy, requireRecipientVerification: false, requireIdentityDoc: true }, roster, []);
    expect(items.map((item) => item.key)).toEqual(["id:a", "id:b", "id:c"]);
  });
});
