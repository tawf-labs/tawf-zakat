import { describe, expect, it } from "bun:test";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  allocationPercent,
  FUNDING_RECORD_DISCLAIMER,
  getActivityAccountability,
  reallocateAllocation,
} from "./activityClient";

describe("Activity client (Ticket #103, Spec #100)", () => {
  it("states a funding record is not a bank balance or handover, without crowdfunding framing", () => {
    expect(FUNDING_RECORD_DISCLAIMER).toContain("bukan saldo bank terverifikasi");
    expect(FUNDING_RECORD_DISCLAIMER).toContain("bukti serah terima bantuan fisik");
    expect(FUNDING_RECORD_DISCLAIMER).not.toContain("crowdfunding");
  });

  it("computes the allocated percent of a known target exactly", () => {
    expect(allocationPercent({ targetAmount: "1000000", targetIsPartial: false, totalAllocatedAmount: "900000" })).toBe(90);
    expect(allocationPercent({ targetAmount: "9007199254740993", targetIsPartial: false, totalAllocatedAmount: "9007199254740993" })).toBe(100);
  });

  it("gives no percent for a partial or zero target, rather than claiming it is funded", () => {
    expect(allocationPercent({ targetAmount: "0", targetIsPartial: true, totalAllocatedAmount: "0" })).toBeNull();
    expect(allocationPercent({ targetAmount: "500000", targetIsPartial: true, totalAllocatedAmount: "500000" })).toBeNull();
  });

  it("sends a reallocation to the source activity with both versions and the operation id (#107)", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const requests = {
      json: async (path: string, init?: RequestInit) => {
        calls.push({ path, init });
        return { decision: { id: "realloc-1" } };
      },
    } as unknown as PrivateRequests;

    await reallocateAllocation(requests, "act 1/2", {
      targetActivityId: "act-2",
      sourceAllocationId: "alloc-1",
      amountExact: "50000",
      reason: "Sisa kegiatan selesai dialihkan ke bantuan pangan darurat.",
      expectedVersion: 3,
      expectedTargetActivityVersion: 7,
      operationId: "op-1",
    });

    expect(calls).toHaveLength(1);
    // The id is escaped, so a slash in it cannot reach another route.
    expect(calls[0].path).toBe("/api/workspace/activities/act%201%2F2/reallocate");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      targetActivityId: "act-2",
      sourceAllocationId: "alloc-1",
      amountExact: "50000",
      reason: "Sisa kegiatan selesai dialihkan ke bantuan pangan darurat.",
      expectedVersion: 3,
      expectedTargetActivityVersion: 7,
      operationId: "op-1",
    });
  });

  it("reads the accountability of one activity from its own endpoint (#107)", async () => {
    const accountability = { activityId: "act-1", availabilityStatus: "NONE" };
    const requests = {
      json: async (path: string) => {
        expect(path).toBe("/api/workspace/activities/act-1/accountability");
        return { accountability };
      },
    } as unknown as PrivateRequests;

    expect(await getActivityAccountability(requests, "act-1")).toBe(accountability);
  });
});

