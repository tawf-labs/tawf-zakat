/**
 * Pure domain logic for Alokasi per mustahik pada penelusuran donatur (Spec #100, ADR-0037).
 *
 * ADR-0006: aliran dana dan kelayakan terbuka; identitas donatur dan penerima tertutup.
 * Seorang muzakki melihat rupiahnya turun ke mustahik tertentu lewat **pseudonim**
 * (`Mustahik #07`) dan asnaf, tidak pernah lewat nama, NIK, alamat atau kontak.
 *
 * ADR-0032/0033: pendanaan tetap bersama (pooled), dan pembagian di sini adalah
 * atribusi akuntansi - bukan earmark fisik. Baris yang nilainya belum diketahui
 * tidak pernah dihitung nol, dan sisa yang belum teralokasi tetap terlihat.
 *
 * Hak amil tidak pernah diisi oleh pengisian ini: ia berjalan lewat jalur hak amil
 * sendiri, sehingga penelusuran seorang donatur tidak pernah berbunyi "dana Anda
 * masuk ke bagian amil lebih dulu".
 *
 * A pure module: no database, no network, no clock.
 */

import { aidLineValueIdr } from "./activity";
import type { JenisDana } from "./contribution";
import type { AidLine } from "./disbursement";

/**
 * Urutan pengisian, mengikuti urutan Q9:60 - dan urutan `VALID_ASNAF` pada
 * `beneficiary-tabular-schema.ts`, yang diuji tetap sama.
 */
export const ASNAF_FILL_PRIORITY = [
  "FAKIR",
  "MISKIN",
  "AMIL",
  "MUALAF",
  "RIQAB",
  "GHARIM",
  "FISABILILLAH",
  "IBNU_SABIL",
] as const;

export const AMIL_ASNAF = "AMIL";

/** Jenis dana yang penerimanya wajib salah satu dari delapan asnaf. */
const ASNAF_BOUND_FUND_TYPES: readonly JenisDana[] = ["ZAKAT", "FITRAH"];

/**
 * Di bawah jumlah penerima ini, pseudonim + asnaf + nominal praktis membongkar
 * identitas bagi siapa pun yang mengenal programnya, jadi rincian ditahan.
 */
export const MIN_ANONYMITY_SET = 3;

export const ANONYMITY_WITHHELD_NOTE =
  `Rincian per penerima ditahan demi privasi penerima: kegiatan ini menjangkau kurang dari ${MIN_ANONYMITY_SET} ` +
  "penerima, sehingga menampilkannya dapat membuka identitas mereka. Pendanaan gabungan kegiatan tetap ditampilkan apa adanya.";

/**
 * Pembagian ke mustahik adalah atribusi pencatatan, bukan pemisahan rupiah fisik
 * di rekening lembaga. Dipakai berdampingan dengan `FUNDING_RECORD_DISCLAIMER`.
 */
export const SHARE_ATTRIBUTION_DISCLAIMER =
  "Pembagian per penerima merupakan atribusi pencatatan atas dana yang dikelola bersama, bukan pemisahan fisik rupiah kontribusi Anda.";

/** Satu kebutuhan mustahik yang bisa diisi, sudah dibaca dari rincian bantuan. */
export type FillTarget = {
  aidLineId: string;
  beneficiaryId: string;
  asnaf: string;
  /** Penyebut baris; `null` ketika nilainya belum diketahui (baris barang tanpa valuasi). */
  approvedExact: string | null;
  /** Yang sudah diisi alokasi sebelumnya pada baris ini. */
  allocatedExact: string;
};

export type FillShare = {
  aidLineId: string;
  beneficiaryId: string;
  asnaf: string;
  /** Rupiah dari kontribusi ini ke mustahik ini. */
  shareExact: string;
  /** Penyebut pada saat pengisian dijalankan. */
  approvedExact: string;
  allocatedAfter: string;
  remainingAfter: string;
  isFull: boolean;
  /** Urutan deterministik dalam satu pengisian, memudahkan replay dan audit. */
  fillSequence: number;
};

export type FillExclusionReason =
  /** Nilainya belum diketahui; dilaporkan apa adanya, tidak diisi sebagai nol (ADR-0033). */
  | "UNVALUED"
  /** Hak amil ditangani jalurnya sendiri, di luar penelusuran donatur. */
  | "AMIL_HELD_SEPARATELY"
  /** Asnaf baris ini tidak sah menerima jenis dana kontribusi tersebut. */
  | "FUND_TYPE_INELIGIBLE";

export type FillExclusion = {
  aidLineId: string;
  beneficiaryId: string;
  asnaf: string;
  reason: FillExclusionReason;
};

export type FillResult = {
  shares: FillShare[];
  /**
   * Dana donatur yang melebihi kebutuhan tersisa di kegiatan itu. Keadaan sah
   * yang harus terlihat, bukan kesalahan.
   */
  unassignedExact: string;
  /** Baris yang tidak pernah boleh diisi, dengan alasannya. Baris penuh tidak masuk sini. */
  exclusions: FillExclusion[];
};

export class AllocationFillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationFillError";
  }
}

const PRIORITY_INDEX = new Map<string, number>(ASNAF_FILL_PRIORITY.map((asnaf, index) => [asnaf, index]));

const normalizeAsnaf = (raw: string): string => raw.trim().toUpperCase();

/** Apakah asnaf ini sah menerima jenis dana tersebut (§3.2). */
export function isFundTypeEligible(fundType: JenisDana, asnaf: string): boolean {
  if (!ASNAF_BOUND_FUND_TYPES.includes(fundType)) return true;
  return PRIORITY_INDEX.has(normalizeAsnaf(asnaf));
}

function exactAmount(value: string, what: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new AllocationFillError(`${what} wajib berupa angka bulat rupiah tanpa desimal atau karakter pemisah.`);
  }
  return BigInt(value.trim());
}

/**
 * Greedy sequential fill dengan kursor: baris pertama yang belum penuh, urut
 * prioritas asnaf lalu id baris. Tiap baris diselesaikan tepat sekali sepanjang
 * umur kegiatan, jadi total kerjanya linear terhadap jumlah mustahik.
 */
export function fillAllocation(
  amountExact: string,
  targets: readonly FillTarget[],
  options: { fundType: JenisDana }
): FillResult {
  let remaining = exactAmount(amountExact, "Nominal alokasi");
  const exclusions: FillExclusion[] = [];
  const eligible: Array<FillTarget & { approvedExact: string }> = [];

  for (const target of targets) {
    const asnaf = normalizeAsnaf(target.asnaf);
    const note = (reason: FillExclusionReason) =>
      exclusions.push({
        aidLineId: target.aidLineId,
        beneficiaryId: target.beneficiaryId,
        asnaf: target.asnaf,
        reason,
      });

    if (asnaf === AMIL_ASNAF) {
      note("AMIL_HELD_SEPARATELY");
      continue;
    }
    if (!isFundTypeEligible(options.fundType, asnaf)) {
      note("FUND_TYPE_INELIGIBLE");
      continue;
    }
    if (target.approvedExact === null) {
      note("UNVALUED");
      continue;
    }
    eligible.push({ ...target, approvedExact: target.approvedExact });
  }

  eligible.sort((left, right) => {
    const byAsnaf = asnafRank(left.asnaf) - asnafRank(right.asnaf);
    if (byAsnaf !== 0) return byAsnaf;
    return left.aidLineId < right.aidLineId ? -1 : left.aidLineId > right.aidLineId ? 1 : 0;
  });

  const shares: FillShare[] = [];
  for (const target of eligible) {
    if (remaining === 0n) break;
    const approved = exactAmount(target.approvedExact, `Nominal disetujui baris "${target.aidLineId}"`);
    const allocated = exactAmount(target.allocatedExact, `Nominal teralokasi baris "${target.aidLineId}"`);
    const room = approved - allocated;
    if (room <= 0n) continue;

    const share = remaining < room ? remaining : room;
    const allocatedAfter = allocated + share;
    shares.push({
      aidLineId: target.aidLineId,
      beneficiaryId: target.beneficiaryId,
      asnaf: target.asnaf,
      shareExact: share.toString(),
      approvedExact: approved.toString(),
      allocatedAfter: allocatedAfter.toString(),
      remainingAfter: (approved - allocatedAfter).toString(),
      isFull: share === room,
      fillSequence: shares.length + 1,
    });
    remaining -= share;
  }

  return { shares, unassignedExact: remaining.toString(), exclusions };
}

const asnafRank = (asnaf: string): number =>
  PRIORITY_INDEX.get(normalizeAsnaf(asnaf)) ?? ASNAF_FILL_PRIORITY.length;

/**
 * Rincian bantuan menjadi target pengisian. Nilai tiap baris dibaca dengan aturan
 * yang sama seperti `activityTarget`, supaya penyebut yang dilihat donatur adalah
 * angka yang sama dengan target kegiatan, bukan angka kedua.
 */
export function fillTargetsFrom(
  aidLines: readonly AidLine[],
  context: { asnafOf: (beneficiaryId: string) => string; allocatedByAidLine: ReadonlyMap<string, string> }
): FillTarget[] {
  return aidLines.map((line) => ({
    aidLineId: line.id,
    beneficiaryId: line.beneficiaryId,
    asnaf: context.asnafOf(line.beneficiaryId),
    approvedExact: aidLineValueIdr(line),
    allocatedExact: context.allocatedByAidLine.get(line.id) ?? "0",
  }));
}

/**
 * Pseudonim tiap penerima, diturunkan dari posisinya pada daftar pengajuan - bukan
 * dari urutan pengisian, supaya nomornya tidak membocorkan peringkat prioritas.
 * Nomor disimpan bersama baris share agar tidak bergeser saat pengajuan direvisi.
 */
export function beneficiaryPseudonyms(beneficiaryIdsInRosterOrder: readonly string[]): Map<string, string> {
  const width = Math.max(2, String(beneficiaryIdsInRosterOrder.length).length);
  const pseudonyms = new Map<string, string>();
  for (const beneficiaryId of beneficiaryIdsInRosterOrder) {
    if (pseudonyms.has(beneficiaryId)) continue;
    pseudonyms.set(beneficiaryId, `Mustahik #${String(pseudonyms.size + 1).padStart(width, "0")}`);
  }
  return pseudonyms;
}

/**
 * Guard k-anonimitas, diterapkan satu kali di jalur baca donatur - tidak di UI.
 * `anonymitySetSize` adalah jumlah penerima berbeda yang dijangkau kegiatan itu,
 * bukan jumlah penerima yang tersentuh satu donatur.
 */
export function applyAnonymityGuard<T>(
  shares: readonly T[],
  anonymitySetSize: number
): { shares: T[]; withheldReason: string | null } {
  if (anonymitySetSize < MIN_ANONYMITY_SET) return { shares: [], withheldReason: ANONYMITY_WITHHELD_NOTE };
  return { shares: [...shares], withheldReason: null };
}
