/**
 * A source read is three outcomes, never two (Spec #68, ticket #70).
 *
 * The old readers answered every question with a list, so a database that was
 * down, a deployment with no ledger at all, and a period that genuinely held no
 * rows were all indistinguishable - and all three became a zero report that
 * called itself a success. These tests pin the vocabulary that separates them.
 */

import { describe, expect, it } from "bun:test";
import {
  attemptRead,
  coverageIsComplete,
  coverageOf,
  rowsOf,
  sourceFailed,
  sourceMissing,
  sourceRead,
  unreadSources,
} from "../src/source-read";

describe("source read outcomes", () => {
  it("keeps a successfully read empty period apart from a failure", () => {
    const empty = sourceRead<number>([]);
    const broken = sourceFailed<number>("koneksi terputus");

    expect(empty.status).toBe("READ");
    expect(rowsOf(empty)).toEqual([]);

    expect(broken.status).toBe("FAILED");
    expect(rowsOf(broken)).toBeNull();
  });

  it("keeps a source that was never configured apart from one that failed", () => {
    const absent = sourceMissing<number>("DATABASE_URL belum disetel");
    expect(absent.status).toBe("MISSING");
    expect(rowsOf(absent)).toBeNull();
  });

  it("turns a thrown read into FAILED carrying the reason, never into an empty list", async () => {
    const read = await attemptRead<number>(async () => {
      throw new Error("relation \"donations\" does not exist");
    });

    expect(read.status).toBe("FAILED");
    expect(rowsOf(read)).toBeNull();
    if (read.status === "FAILED") expect(read.detail).toContain("does not exist");
  });

  it("passes rows through when the read succeeds", async () => {
    const read = await attemptRead(async () => [1, 2, 3]);
    expect(rowsOf(read)).toEqual([1, 2, 3]);
  });

  it("reports coverage per source, with a row count only where one was actually read", () => {
    const coverage = [
      coverageOf("donasi", sourceRead([1, 2])),
      coverageOf("proposal", sourceMissing("tidak ada ledger internal")),
      coverageOf("event", sourceFailed("timeout")),
    ];

    expect(coverage).toEqual([
      { name: "donasi", status: "READ", detail: null, rowCount: 2 },
      { name: "proposal", status: "MISSING", detail: "tidak ada ledger internal", rowCount: null },
      { name: "event", status: "FAILED", detail: "timeout", rowCount: null },
    ]);
  });

  it("calls coverage complete only when every source was read, empty ones included", () => {
    expect(coverageIsComplete([coverageOf("donasi", sourceRead([]))])).toBe(true);
    expect(coverageIsComplete([coverageOf("donasi", sourceFailed("x"))])).toBe(false);
    expect(coverageIsComplete([coverageOf("donasi", sourceMissing("x"))])).toBe(false);
  });

  it("names the sources that were not read, so a caller can say which scope is unproven", () => {
    const coverage = [
      coverageOf("donasi", sourceRead([1])),
      coverageOf("proposal", sourceFailed("timeout")),
    ];
    expect(unreadSources(coverage).map((entry) => entry.name)).toEqual(["proposal"]);
  });
});
