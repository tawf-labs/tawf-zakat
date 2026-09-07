import { describe, expect, it } from "bun:test";
import {
  describeCommitment,
  describeFileStatus,
  describeOutcome,
  describeSourceStatus,
  formatInstant,
  originLabel,
  positionLabel,
  transactionDetailLabel,
} from "./evidenceText";

describe("what the package as a whole says", () => {
  it("keeps a found discrepancy apart from a failed examination", () => {
    const found = describeOutcome("RECONCILED", 3);
    const unread = describeOutcome("INCOMPLETE", 0);

    expect(found.label).toContain("Selisih ditemukan");
    expect(found.tone).toBe("finding");
    expect(found.detail).toMatch(/bukti pemeriksaan/i);

    expect(unread.label).toMatch(/belum dapat direkonsiliasi/i);
    expect(unread.tone).toBe("unproven");
  });

  it("never calls a matching reconciliation an endorsement or a verdict", () => {
    const matched = describeOutcome("RECONCILED", 0);
    expect(matched.tone).toBe("neutral");
    expect(matched.detail).toMatch(/bukan pengesahan/i);
    expect(matched.label).not.toMatch(/lolos|sah|terverifikasi/i);
  });
});

describe("what one source says about itself", () => {
  it("says an empty period was read, not that it was unavailable", () => {
    const empty = describeSourceStatus("READ", 0, null);
    expect(empty.tone).toBe("neutral");
    expect(empty.detail).toMatch(/berhasil dibaca/i);
  });

  it("says a missing or failed source leaves its scope unexamined", () => {
    for (const status of ["MISSING", "FAILED"] as const) {
      const described = describeSourceStatus(status, null, "koneksi mitra gagal");
      expect(described.tone).toBe("unproven");
      expect(described.detail).toContain("koneksi mitra gagal");
      expect(described.detail).toMatch(/belum terperiksa/i);
    }
  });

  it("counts the rows it actually read", () => {
    expect(describeSourceStatus("READ", 12, null).label).toContain("12");
  });
});

describe("what happened to an attached document", () => {
  it("shows a failure as a failure, with the server's own reason", () => {
    const failed = describeFileStatus("FAILED", "disk penuh");
    expect(failed.label).toMatch(/gagal/i);
    expect(failed.detail).toContain("disk penuh");
    expect(failed.detail).toMatch(/tidak ada pengenal pengganti/i);
  });

  it("says a stored file is restricted, not public", () => {
    expect(describeFileStatus("STORED", null).detail).toMatch(/pembaca berwenang/i);
  });
});

describe("labels and instants", () => {
  it("names each origin without claiming SiMBA compatibility", () => {
    expect(originLabel("PARTNER_EXPORT")).toBe("Ekspor lembaga mitra");
    expect(originLabel("PASTE")).toBe("Tempel tabel");
    expect(originLabel("SIMBA")).toBe("SIMBA");
  });

  it("keeps the two balance-sheet positions distinct", () => {
    expect(positionLabel("ON")).not.toBe(positionLabel("OFF"));
    expect(positionLabel("BOTH")).toMatch(/dan/);
  });

  it("says outright when a source is a recap", () => {
    expect(transactionDetailLabel("NOT_AVAILABLE")).toMatch(/tanpa rincian transaksi/i);
  });

  it("renders a cut-off as an instant, and leaves an unparseable one alone", () => {
    expect(formatInstant("2025-02-11T00:00:00.000Z")).toBe("2025-02-11 00:00:00 UTC");
    expect(formatInstant("11 Februari 2025")).toBe("11 Februari 2025");
  });
});

describe("the commitment check", () => {
  it("names a mismatch rather than hiding the package", () => {
    const broken = describeCommitment(false);
    expect(broken.tone).toBe("unproven");
    expect(broken.detail).toMatch(/berbeda/i);
    expect(describeCommitment(true).tone).toBe("neutral");
  });
});
