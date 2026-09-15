import { describe, expect, it } from "bun:test";
import {
  fetchOfficers,
  createOfficer,
  updateOfficer,
  linkOfficerAccount,
  unlinkOfficerAccount,
} from "./workspaceClient";
import type { PrivateRequests } from "./privateRequests";

describe("workspaceClient officer methods", () => {
  it("fetches officers list via PrivateRequests", async () => {
    const mockRequests: PrivateRequests = {
      contextId: "ctx-1",
      json: async (path: string) => {
        expect(path).toBe("/api/workspace/officers");
        return {
          success: true,
          officers: [
            {
              id: "off-1",
              displayName: "Ahmad Amil",
              isActive: true,
              accounts: [{ account: "0x1111", role: "OFFICER", isActive: true }],
            },
          ],
        };
      },
      download: async () => ({ kind: "EXPIRED" as const }),
    };

    const officers = await fetchOfficers(mockRequests);
    expect(officers).toHaveLength(1);
    expect(officers[0].displayName).toBe("Ahmad Amil");
    expect(officers[0].accounts[0].account).toBe("0x1111");
  });

  it("creates officer profile via POST /api/workspace/officers", async () => {
    let capturedPath = "";
    let capturedInit: RequestInit | undefined;

    const mockRequests: PrivateRequests = {
      contextId: "ctx-1",
      json: async (path: string, init?: RequestInit) => {
        capturedPath = path;
        capturedInit = init;
        return {
          success: true,
          officer: {
            id: "off-custom",
            displayName: "Budi Amil",
            isActive: true,
          },
        };
      },
      download: async () => ({ kind: "EXPIRED" as const }),
    };

    const created = await createOfficer(mockRequests, {
      displayName: "Budi Amil",
      id: "off-custom",
      account: "0x2222",
      role: "OFFICER",
    });

    expect(capturedPath).toBe("/api/workspace/officers");
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      displayName: "Budi Amil",
      id: "off-custom",
      account: "0x2222",
      role: "OFFICER",
    });
    expect(created.id).toBe("off-custom");
    expect(created.displayName).toBe("Budi Amil");
  });

  it("updates officer profile via PATCH /api/workspace/officers/:id", async () => {
    let capturedPath = "";
    let capturedInit: RequestInit | undefined;

    const mockRequests: PrivateRequests = {
      contextId: "ctx-1",
      json: async (path: string, init?: RequestInit) => {
        capturedPath = path;
        capturedInit = init;
        return {
          success: true,
          officer: {
            id: "off-1",
            displayName: "Nama Baru",
            isActive: false,
          },
        };
      },
      download: async () => ({ kind: "EXPIRED" as const }),
    };

    const updated = await updateOfficer(mockRequests, "off-1", {
      displayName: "Nama Baru",
      isActive: false,
    });

    expect(capturedPath).toBe("/api/workspace/officers/off-1");
    expect(capturedInit?.method).toBe("PATCH");
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      displayName: "Nama Baru",
      isActive: false,
    });
    expect(updated.displayName).toBe("Nama Baru");
    expect(updated.isActive).toBe(false);
  });

  it("links officer account via POST /api/workspace/officers/:id/accounts", async () => {
    let capturedPath = "";
    let capturedInit: RequestInit | undefined;

    const mockRequests: PrivateRequests = {
      contextId: "ctx-1",
      json: async (path: string, init?: RequestInit) => {
        capturedPath = path;
        capturedInit = init;
        return { success: true };
      },
      download: async () => ({ kind: "EXPIRED" as const }),
    };

    await linkOfficerAccount(mockRequests, "off-1", {
      account: "0x3333",
      role: "OFFICER",
    });

    expect(capturedPath).toBe("/api/workspace/officers/off-1/accounts");
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      account: "0x3333",
      role: "OFFICER",
    });
  });

  it("unlinks officer account via DELETE /api/workspace/officers/:id/accounts/:account", async () => {
    let capturedPath = "";
    let capturedInit: RequestInit | undefined;

    const mockRequests: PrivateRequests = {
      contextId: "ctx-1",
      json: async (path: string, init?: RequestInit) => {
        capturedPath = path;
        capturedInit = init;
        return { success: true };
      },
      download: async () => ({ kind: "EXPIRED" as const }),
    };

    await unlinkOfficerAccount(mockRequests, "off-1", "0x3333");

    expect(capturedPath).toBe("/api/workspace/officers/off-1/accounts/0x3333");
    expect(capturedInit?.method).toBe("DELETE");
  });
});
