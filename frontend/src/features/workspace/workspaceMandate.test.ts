import { describe, expect, it } from "bun:test";
import {
  fetchMandates,
  grantMandate,
  updateMandate,
  revokeMandate,
  fetchEndorsementAccounts,
  registerEndorsementAccount,
  updateEndorsementAccount,
  revokeEndorsementAccount,
} from "./workspaceClient";
import type { PrivateRequests } from "./privateRequests";

function mockRequests(handler: (path: string, init?: RequestInit) => Promise<any>): PrivateRequests {
  return {
    contextId: "test-context",
    assertCurrent: () => {},
    json: async <T>(path: string, init?: RequestInit): Promise<T> => handler(path, init),
    blob: async () => new Blob([]),
  };
}

describe("workspaceClient operational mandate & endorsement account methods (Ticket #90)", () => {
  it("fetches mandates list with query parameters", async () => {
    let capturedUrl = "";
    const requests = mockRequests(async (path) => {
      capturedUrl = path;
      return {
        success: true,
        mandates: [
          {
            id: "man-1",
            officerId: "off-1",
            function: "MANAGE_PROGRAMS",
            scopeType: "ALL_PROGRAMS",
            assignmentRef: "SK/01",
            isActive: true,
          },
        ],
      };
    });

    const result = await fetchMandates(requests, { officerId: "off-1", activeOnly: true });
    expect(capturedUrl).toBe("/api/workspace/mandates?officerId=off-1&activeOnly=true");
    expect(result.length).toBe(1);
    expect(result[0].function).toBe("MANAGE_PROGRAMS");
  });

  it("grants operational mandate via POST /api/workspace/mandates", async () => {
    let capturedBody: any = null;
    const requests = mockRequests(async (path, init) => {
      expect(path).toBe("/api/workspace/mandates");
      expect(init?.method).toBe("POST");
      capturedBody = JSON.parse(init?.body as string);
      return {
        success: true,
        mandate: {
          id: "man-new",
          ...capturedBody,
          isActive: true,
        },
      };
    });

    const input = {
      id: "mandate-retry-id",
      officerId: "off-1",
      function: "PREPARE_PROPOSALS" as const,
      scopeType: "ALL_PROGRAMS" as const,
      assignmentRef: "SK/2026/001",
      validFrom: 1800000000,
      validUntil: 1800086400,
      nominalLimit: "50000000",
    };

    const created = await grantMandate(requests, input);
    expect(capturedBody.officerId).toBe("off-1");
    expect(capturedBody.function).toBe("PREPARE_PROPOSALS");
    expect(created.id).toBe("mandate-retry-id");
  });

  it("updates operational mandate via PATCH /api/workspace/mandates/:id", async () => {
    let capturedBody: any = null;
    const requests = mockRequests(async (path, init) => {
      expect(path).toBe("/api/workspace/mandates/man-123");
      expect(init?.method).toBe("PATCH");
      capturedBody = JSON.parse(init?.body as string);
      return {
        success: true,
        mandate: {
          id: "man-123",
          assignmentRef: capturedBody.assignmentRef,
        },
      };
    });

    const updated = await updateMandate(requests, "man-123", {
      expectedVersion: 7,
      assignmentRef: "SK/2026/REV2",
      nominalLimit: "100000000",
    });
    expect(capturedBody.expectedVersion).toBe(7);
    expect(capturedBody.assignmentRef).toBe("SK/2026/REV2");
    expect(updated.assignmentRef).toBe("SK/2026/REV2");
  });

  it("revokes operational mandate via DELETE /api/workspace/mandates/:id", async () => {
    let deletedPath = "";
    const requests = mockRequests(async (path, init) => {
      deletedPath = path;
      expect(init?.method).toBe("DELETE");
      return { success: true, revoked: true };
    });

    await revokeMandate(requests, "man-123", 8);
    expect(deletedPath).toBe("/api/workspace/mandates/man-123");
  });

  it("manages institutional endorsement accounts", async () => {
    const listRequests = mockRequests(async (path) => {
      expect(path).toBe("/api/workspace/endorsement-accounts?includeInactive=true");
      return {
        success: true,
        endorsementAccounts: [
          {
            id: "ea-1",
            accountAddress: "0x1234567890123456789012345678901234567890",
            label: "Rekening Operasional",
            authorizedOfficerIds: ["off-1"],
            isActive: true,
          },
        ],
      };
    });

    const accounts = await fetchEndorsementAccounts(listRequests, true);
    expect(accounts.length).toBe(1);
    expect(accounts[0].label).toBe("Rekening Operasional");

    const regRequests = mockRequests(async (path, init) => {
      expect(path).toBe("/api/workspace/endorsement-accounts");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      return {
        success: true,
        endorsementAccount: {
          id: "ea-2",
          ...body,
          isActive: true,
        },
      };
    });

    const created = await registerEndorsementAccount(regRequests, {
      id: "endorsement-retry-id",
      accountAddress: "0x9876543210987654321098765432109876543210",
      label: "Rekening Pengesahan",
      authorizedOfficerIds: [],
    });
    expect(created.id).toBe("endorsement-retry-id");
    expect(created.label).toBe("Rekening Pengesahan");

    const updateRequests = mockRequests(async (path, init) => {
      expect(path).toBe("/api/workspace/endorsement-accounts/ea-2");
      expect(init?.method).toBe("PATCH");
      return { success: true, endorsementAccount: { id: "ea-2", label: "Rekening Baru" } };
    });

    const updated = await updateEndorsementAccount(updateRequests, "ea-2", { expectedVersion: 1, label: "Rekening Baru" });
    expect(updated.label).toBe("Rekening Baru");

    const revokeRequests = mockRequests(async (path, init) => {
      expect(path).toBe("/api/workspace/endorsement-accounts/ea-2");
      expect(init?.method).toBe("DELETE");
      return { success: true, revoked: true };
    });

    await revokeEndorsementAccount(revokeRequests, "ea-2", 2);
  });
});
