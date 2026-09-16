import { describe, expect, it, mock } from "bun:test";
import {
  downloadSourceTemplate,
  previewTabularSource,
  listEvidenceDrafts,
  getEvidenceDraft,
  saveEvidenceDraft,
  deleteEvidenceDraft,
  freezeEvidenceDraft,
  sourceTemplateFileName,
  type TabularPreviewResult,
} from "./evidenceClient";
import type { PrivateRequests } from "./privateRequests";

describe("Tabular Source Import & Drafts Client (Ticket #88)", () => {
  const blobCalls: string[] = [];
  const fakeRequests: PrivateRequests = {
    json: mock(async (url: string, init?: RequestInit) => {
      if (url === "/api/evidence/preview") {
        const body = JSON.parse(String(init?.body));
        return {
          success: true,
          fileName: body.fileName,
          format: "xlsx",
          totalRows: 100,
          validCount: 93,
          invalidCount: 7,
          isPartial: true,
          calculableTotal: "1500000000",
          allRowsPreview: [
            {
              rowNumber: 2,
              isValid: true,
              row: { key: "TX-01", amount: "1000000", bucket: "ZAKAT", balanceSheet: "ON", unit: "IDR" },
              rawCells: { key: "TX-01" },
              issues: [],
            },
            {
              rowNumber: 11,
              isValid: false,
              row: null,
              rawCells: { key: "TX-10" },
              issues: [{ field: "amount", message: "Format angka tidak sah" }],
            },
          ],
          issues: [{ field: "amount", message: "Baris 11: Format angka tidak sah", rowIndex: 10 }],
        } as TabularPreviewResult;
      }
      if (url === "/api/evidence/drafts" && init?.method === "GET") {
        return {
          drafts: [
            {
              id: "draft-1",
              label: "Draf Q1",
              periodKind: "SEMESTER",
              periodYear: 2024,
              currencyUnit: "IDR",
              balanceSheetScope: "ON",
              issueCount: 7,
              version: 1,
              updatedAt: 1800000000,
            },
          ],
        };
      }
      if (url === "/api/evidence/drafts" && init?.method === "POST") {
        const body = JSON.parse(String(init?.body));
        return {
          draft: {
            id: body.id || "draft-generated",
            ...body,
            version: 1,
            updatedAt: 1800000000,
          },
        };
      }
      if (url === "/api/evidence/drafts/draft-1" && init?.method === "GET") {
        return {
          draft: {
            id: "draft-1",
            label: "Draf Q1",
            periodKind: "SEMESTER",
            periodYear: 2024,
            currencyUnit: "IDR",
            balanceSheetScope: "ON",
            tolerance: "0",
            claimData: { status: "READ", rows: [] },
            sourceData: {
              tabular: {
                role: "SOURCE",
                fileName: "audit.xlsx",
                mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                sizeBytes: 4,
                contentSha256: `0x${"ab".repeat(32)}`,
              },
            },
            files: [],
            issues: [],
            version: 1,
            createdAt: 1800000000,
            updatedAt: 1800000000,
          },
          sourcePreview: { totalRows: 2, invalidCount: 1 },
          previewUnavailable: null,
        };
      }
      if (url === "/api/evidence/drafts/draft-1" && init?.method === "DELETE") {
        return { success: true };
      }
      if (url === "/api/evidence/drafts/draft-1/freeze" && init?.method === "POST") {
        return {
          preparation: {
            id: "prep-frozen",
            label: "Draf Q1",
            outcome: "RECONCILED",
            commitment: "hmac-123",
          },
        };
      }
      throw new Error(`Unhandled mock request: ${url}`);
    }),
    blob: mock(async (url: string) => {
      blobCalls.push(url);
      return new Blob(["test"]);
    }),
    text: mock(async () => "test"),
  };

  const scope = {
    period: { kind: "SEMESTER", year: 2024 },
    currencyUnit: "IDR",
    balanceSheetScope: "ON",
  };

  it("sends the preparation's own scope with the file, and handles partial totals", async () => {
    const result = await previewTabularSource(fakeRequests, "audit.xlsx", "dGVzdA==", scope);
    expect(result.success).toBe(true);
    expect(result.totalRows).toBe(100);
    expect(result.validCount).toBe(93);
    expect(result.invalidCount).toBe(7);
    expect(result.isPartial).toBe(true);
    expect(result.allRowsPreview).toHaveLength(2);
    expect(result.allRowsPreview[1].isValid).toBe(false);

    // The server is never left to guess the period a preview is checked against.
    const sent = JSON.parse(
      String((fakeRequests.json as any).mock.calls.at(-1)[1].body)
    );
    expect(sent.period).toEqual(scope.period);
    expect(sent.currencyUnit).toBe("IDR");
    expect(sent.balanceSheetScope).toBe("ON");
  });

  it("lists, gets, saves, and deletes evidence drafts", async () => {
    // List
    const { drafts } = await listEvidenceDrafts(fakeRequests);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe("draft-1");
    expect(drafts[0].issueCount).toBe(7);

    // Get
    const { draft, sourcePreview } = await getEvidenceDraft("draft-1", fakeRequests);
    expect(draft.id).toBe("draft-1");
    expect(draft.sourceData!.tabular!.fileName).toBe("audit.xlsx");
    // Name and hash reach the browser; the workbook's bytes do not.
    expect(draft.sourceData!.tabular).not.toHaveProperty("contentBase64");
    expect(sourcePreview!.totalRows).toBe(2);

    // Save
    const saved = await saveEvidenceDraft(fakeRequests, {
      label: "Draf Baru",
      period: { kind: "AKHIR_TAHUN", year: 2024 },
      currencyUnit: "IDR",
      balanceSheetScope: "ON",
    });
    expect(saved.draft.label).toBe("Draf Baru");

    // Delete
    const delRes = await deleteEvidenceDraft("draft-1", fakeRequests);
    expect(delRes.success).toBe(true);

    // Freeze
    const frozen = await freezeEvidenceDraft("draft-1", fakeRequests);
    expect(frozen.preparation.id).toBe("prep-frozen");
    expect(frozen.preparation.outcome).toBe("RECONCILED");
  });

  it("downloads source templates through the authorized request, not a bare URL", async () => {
    // A plain `fetch` carries no Authorization header, so a template fetched that way
    // would either be refused or, worse, prove the route needs no session at all.
    const xlsxBlob = await downloadSourceTemplate(fakeRequests, "xlsx");
    expect(xlsxBlob.size).toBe(4);
    expect(blobCalls[0]).toContain("/api/evidence/template?format=xlsx");

    const csvBlob = await downloadSourceTemplate(fakeRequests, "csv");
    expect(csvBlob.size).toBe(4);
    expect(blobCalls[1]).toContain("/api/evidence/template?format=csv");
  });

  it("names the template file after the template version", () => {
    expect(sourceTemplateFileName("xlsx")).toBe("tawf.source.template.v1.xlsx");
    expect(sourceTemplateFileName("csv")).toBe("tawf.source.template.v1.csv");
  });
});
