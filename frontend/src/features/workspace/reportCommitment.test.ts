import { expect, it } from "bun:test";
import vectors from "../../../../shared/fixtures/report-serialization-v1.json";
import { verifyReportCommitment } from "./reportCommitment";
import { canonicalJson } from "../../../../shared/canonical-json";

it("verifies the shared version-one vectors with browser WebCrypto", async () => {
  for (const vector of vectors) {
    expect(canonicalJson(vector.value)).toBe(vector.canonical);
    expect(await verifyReportCommitment(vector.value, vector.salt, vector.digest)).toBe(true);
    expect(await verifyReportCommitment({ ...vector.value, predecessor: "altered" }, vector.salt, vector.digest)).toBe(false);
    expect(await verifyReportCommitment({ ...vector.value, claims: [...vector.value.claims].reverse() }, vector.salt, vector.digest)).toBe(false);
  }
});
