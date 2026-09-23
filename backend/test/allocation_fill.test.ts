import { describe, expect, it } from "bun:test";
import {
  ANONYMITY_WITHHELD_NOTE,
  ASNAF_FILL_PRIORITY,
  MIN_ANONYMITY_SET,
  applyAnonymityGuard,
  beneficiaryPseudonyms,
  fillAllocation,
  fillTargetsFrom,
  isFundTypeEligible,
  type FillTarget,
} from "../src/allocation-fill";
import { activityTarget } from "../src/activity";
import { VALID_ASNAF } from "../src/beneficiary-tabular-schema";
import type { AidLine } from "../src/disbursement";

const target = (overrides: Partial<FillTarget> & { aidLineId: string }): FillTarget => ({
  beneficiaryId: `ben-${overrides.aidLineId}`,
  asnaf: "FAKIR",
  approvedExact: "800000",
  allocatedExact: "0",
  ...overrides,
});

const moneyLine = (id: string, beneficiaryId: string, approved: string | null): AidLine => ({
  id,
  beneficiaryId,
  aidType: "Bantuan tunai",
  period: "2026-09",
  value: { kind: "MONEY", amountRequestedIdr: approved ?? "800000", amountApprovedIdr: approved },
});

describe("Pengisian alokasi per mustahik", () => {
  it("membagi satu kontribusi ke mustahik berurutan: satu penuh, satu sebagian", () => {
    const result = fillAllocation(
      "1000000",
      [
        target({ aidLineId: "line-a", beneficiaryId: "ben-07", asnaf: "FAKIR" }),
        target({ aidLineId: "line-b", beneficiaryId: "ben-23", asnaf: "MISKIN" }),
      ],
      { fundType: "ZAKAT" }
    );

    expect(result.shares).toEqual([
      {
        aidLineId: "line-a",
        beneficiaryId: "ben-07",
        asnaf: "FAKIR",
        shareExact: "800000",
        approvedExact: "800000",
        allocatedAfter: "800000",
        remainingAfter: "0",
        isFull: true,
        fillSequence: 1,
      },
      {
        aidLineId: "line-b",
        beneficiaryId: "ben-23",
        asnaf: "MISKIN",
        shareExact: "200000",
        approvedExact: "800000",
        allocatedAfter: "200000",
        remainingAfter: "600000",
        isFull: false,
        fillSequence: 2,
      },
    ]);
    expect(result.unassignedExact).toBe("0");
    expect(result.exclusions).toEqual([]);
  });

  it("mengikuti urutan prioritas asnaf Q9:60, bukan urutan masukan", () => {
    const result = fillAllocation(
      "100000",
      [
        target({ aidLineId: "line-z", asnaf: "IBNU_SABIL", approvedExact: "100000" }),
        target({ aidLineId: "line-y", asnaf: "GHARIM", approvedExact: "100000" }),
        target({ aidLineId: "line-x", asnaf: "FAKIR", approvedExact: "100000" }),
      ],
      { fundType: "ZAKAT" }
    );

    expect(result.shares.map((share) => share.aidLineId)).toEqual(["line-x"]);
  });

  it("memecah seri pada asnaf yang sama secara deterministik lewat id baris", () => {
    const targets = [
      target({ aidLineId: "line-b", approvedExact: "100000" }),
      target({ aidLineId: "line-a", approvedExact: "100000" }),
    ];

    const forward = fillAllocation("150000", targets, { fundType: "ZAKAT" });
    const reversed = fillAllocation("150000", [...targets].reverse(), { fundType: "ZAKAT" });

    expect(forward.shares.map((share) => share.aidLineId)).toEqual(["line-a", "line-b"]);
    expect(reversed.shares).toEqual(forward.shares);
  });

  it("melanjutkan dari kursor: baris yang sudah penuh dilewati tanpa dikunjungi ulang", () => {
    const result = fillAllocation(
      "300000",
      [
        target({ aidLineId: "line-a", approvedExact: "800000", allocatedExact: "800000" }),
        target({ aidLineId: "line-b", asnaf: "MISKIN", approvedExact: "800000", allocatedExact: "500000" }),
      ],
      { fundType: "ZAKAT" }
    );

    expect(result.shares).toHaveLength(1);
    expect(result.shares[0]).toMatchObject({
      aidLineId: "line-b",
      shareExact: "300000",
      allocatedAfter: "800000",
      remainingAfter: "0",
      isFull: true,
    });
  });

  it("mengeluarkan baris tanpa nilai dari pengisian, tidak memperlakukannya sebagai nol", () => {
    const result = fillAllocation(
      "500000",
      [
        target({ aidLineId: "line-barang", approvedExact: null }),
        target({ aidLineId: "line-uang", asnaf: "MISKIN", approvedExact: "800000" }),
      ],
      { fundType: "ZAKAT" }
    );

    expect(result.shares.map((share) => share.aidLineId)).toEqual(["line-uang"]);
    expect(result.exclusions).toEqual([
      { aidLineId: "line-barang", beneficiaryId: "ben-line-barang", asnaf: "FAKIR", reason: "UNVALUED" },
    ]);
  });

  it("tidak pernah mengisi baris hak amil; hak amil berjalan di jalurnya sendiri", () => {
    const result = fillAllocation(
      "1000000",
      [
        target({ aidLineId: "line-amil", asnaf: "AMIL", approvedExact: "400000" }),
        target({ aidLineId: "line-fakir", asnaf: "FAKIR", approvedExact: "400000" }),
      ],
      { fundType: "ZAKAT" }
    );

    expect(result.shares.map((share) => share.aidLineId)).toEqual(["line-fakir"]);
    expect(result.exclusions).toEqual([
      { aidLineId: "line-amil", beneficiaryId: "ben-line-amil", asnaf: "AMIL", reason: "AMIL_HELD_SEPARATELY" },
    ]);
    expect(result.unassignedExact).toBe("600000");
  });

  it("menahan zakat dari baris yang asnaf-nya tidak sah menerima zakat", () => {
    const targets = [target({ aidLineId: "line-nonasnaf", asnaf: "UMUM", approvedExact: "500000" })];

    const zakat = fillAllocation("500000", targets, { fundType: "ZAKAT" });
    expect(zakat.shares).toEqual([]);
    expect(zakat.exclusions[0]?.reason).toBe("FUND_TYPE_INELIGIBLE");
    expect(zakat.unassignedExact).toBe("500000");

    const infak = fillAllocation("500000", targets, { fundType: "INFAK_SEDEKAH" });
    expect(infak.shares).toHaveLength(1);
    expect(infak.unassignedExact).toBe("0");
  });

  it("menampilkan sisa yang melebihi kebutuhan kegiatan, bukan menolaknya", () => {
    const result = fillAllocation("1000000", [target({ aidLineId: "line-a", approvedExact: "300000" })], {
      fundType: "ZAKAT",
    });

    expect(result.shares[0]?.shareExact).toBe("300000");
    expect(result.unassignedExact).toBe("700000");
  });

  it("menolak nominal yang tidak bulat, agar tidak ada pecahan yang masuk diam-diam", () => {
    expect(() => fillAllocation("1000.50", [target({ aidLineId: "line-a" })], { fundType: "ZAKAT" })).toThrow();
    expect(() =>
      fillAllocation("1000", [target({ aidLineId: "line-a", approvedExact: "80,000" })], { fundType: "ZAKAT" })
    ).toThrow();
  });

  it("menjaga besaran rupiah besar tetap eksak", () => {
    const result = fillAllocation(
      "9007199254740993",
      [target({ aidLineId: "line-a", approvedExact: "9007199254740993" })],
      { fundType: "ZAKAT" }
    );

    expect(result.shares[0]?.shareExact).toBe("9007199254740993");
  });

  it("memakai urutan prioritas yang sama dengan daftar asnaf sah lembaga", () => {
    expect(new Set<string>(ASNAF_FILL_PRIORITY)).toEqual(VALID_ASNAF);
    expect(ASNAF_FILL_PRIORITY[0]).toBe("FAKIR");
    expect(ASNAF_FILL_PRIORITY[1]).toBe("MISKIN");
  });

  it("mengenali jenis dana mana yang terikat delapan asnaf", () => {
    expect(isFundTypeEligible("ZAKAT", "FAKIR")).toBe(true);
    expect(isFundTypeEligible("FITRAH", "UMUM")).toBe(false);
    expect(isFundTypeEligible("KURBAN", "UMUM")).toBe(true);
  });
});

describe("Target pengisian dari rincian bantuan", () => {
  it("memakai nominal disetujui dan menandai baris barang tanpa valuasi sebagai tak bernilai", () => {
    const lines: AidLine[] = [
      moneyLine("line-a", "ben-1", "800000"),
      {
        id: "line-b",
        beneficiaryId: "ben-2",
        aidType: "Beras",
        period: "2026-09",
        value: { kind: "GOODS", unit: "kg", quantityRequested: "10", quantityApproved: "10", valuedAmountIdr: null },
      },
    ];

    const targets = fillTargetsFrom(lines, { asnafOf: () => "FAKIR", allocatedByAidLine: new Map([["line-a", "100000"]]) });

    expect(targets).toEqual([
      { aidLineId: "line-a", beneficiaryId: "ben-1", asnaf: "FAKIR", approvedExact: "800000", allocatedExact: "100000" },
      { aidLineId: "line-b", beneficiaryId: "ben-2", asnaf: "FAKIR", approvedExact: null, allocatedExact: "0" },
    ]);
  });

  it("membaca nilai baris dengan aturan yang sama seperti target kegiatan", () => {
    const lines = [moneyLine("line-a", "ben-1", null)];
    const targets = fillTargetsFrom(lines, { asnafOf: () => "FAKIR", allocatedByAidLine: new Map() });

    // `activityTarget` memakai nominal diajukan ketika nominal disetujui belum ada;
    // penyebut yang dilihat donatur harus angka yang sama, bukan angka kedua.
    expect(targets[0]?.approvedExact).toBe(activityTarget(lines).targetAmount);
  });
});

describe("Pseudonim penerima", () => {
  it("menurunkan pseudonim dari posisi penerima pada daftar pengajuan", () => {
    const pseudonyms = beneficiaryPseudonyms(["ben-c", "ben-a", "ben-b"]);

    expect(pseudonyms.get("ben-c")).toBe("Mustahik #01");
    expect(pseudonyms.get("ben-a")).toBe("Mustahik #02");
    expect(pseudonyms.get("ben-b")).toBe("Mustahik #03");
  });

  it("tidak bergeser ketika penerima berikutnya ditambahkan ke daftar", () => {
    const before = beneficiaryPseudonyms(["ben-c", "ben-a"]);
    const after = beneficiaryPseudonyms(["ben-c", "ben-a", "ben-baru"]);

    expect(after.get("ben-c")).toBe(before.get("ben-c"));
    expect(after.get("ben-a")).toBe(before.get("ben-a"));
  });

  it("memakai lebar nomor yang cukup untuk daftar besar", () => {
    const ids = Array.from({ length: 120 }, (_, index) => `ben-${index}`);

    expect(beneficiaryPseudonyms(ids).get("ben-0")).toBe("Mustahik #001");
  });
});

describe("Ambang k-anonimitas", () => {
  it("menahan rincian ketika kegiatan menjangkau terlalu sedikit penerima", () => {
    const guarded = applyAnonymityGuard([{ beneficiaryPseudonym: "Mustahik #01" }], MIN_ANONYMITY_SET - 1);

    expect(guarded.shares).toEqual([]);
    expect(guarded.withheldReason).toBe(ANONYMITY_WITHHELD_NOTE);
  });

  it("melepas rincian tepat pada ambang", () => {
    const shares = [{ beneficiaryPseudonym: "Mustahik #01" }];
    const guarded = applyAnonymityGuard(shares, MIN_ANONYMITY_SET);

    expect(guarded.shares).toEqual(shares);
    expect(guarded.withheldReason).toBeNull();
  });
});
