/**
 * Column definitions for the roster grid, in the order of the XLSX import
 * template so the screen reads like the file the institution filled in.
 * `validate` mirrors the row rules of backend `validateBeneficiary` /
 * `validateAidLine`, so a fixed cell clears at once instead of waiting for a save.
 */
import { isExactNonNegativeDecimal } from "../../../../shared/exact-decimal";
import type { AidLine, Beneficiary } from "./disbursementClient";
import type { GridColumn } from "./SpreadsheetGrid";
import { ASNAF_OPTIONS } from "./BeneficiaryCard";
import {
  beneficiaryLabel,
  matchBeneficiary,
  normalizeChoice,
  normalizeNik,
  normalizeQuantity,
  normalizeRupiah,
  parseAidKind,
  parseIdentityKind,
} from "./spreadsheet";

const isRupiah = (value: string) => /^\d+$/.test(value);
const required = (value: string, message: string) => (value.trim() === "" ? message : null);

/** Row fields a column validates; server issues on these are superseded by the live check. */
export const CLIENT_VALIDATED_FIELDS = new Set([
  "name", "asnaf", "addressOrScope", "identityBasis",
  "beneficiaryId", "aidType", "period",
  "value.amountRequestedIdr", "value.unit", "value.quantityRequested", "value.valuedAmountIdr", "value.valuationBasis",
]);

const pair = <K extends string>(a: K, b: K, name: string, relation: string) =>
  name.trim() === "" && relation.trim() === "" ? null : ({ [a]: name, [b]: relation } as Record<K, string>);

const contactOf = (b: Beneficiary) => ({ phone: b.contact?.phone ?? "", email: b.contact?.email ?? "", relation: b.contact?.relation ?? "" });
const withContact = (b: Beneficiary, patch: Partial<ReturnType<typeof contactOf>>): Beneficiary => {
  const next = { ...contactOf(b), ...patch };
  const empty = !next.phone.trim() && !next.email.trim() && !next.relation.trim();
  return { ...b, contact: empty ? null : next };
};

export const beneficiaryColumns: GridColumn<Beneficiary>[] = [
  {
    id: "name", header: "Nama", width: 200, hint: "Wajib",
    value: (b) => b.name,
    apply: (b, text) => ({ ...b, name: text }),
    validate: (b) => required(b.name, "Nama penerima tidak boleh kosong."),
  },
  {
    id: "identityKind", header: "Dasar identitas", width: 130, hint: "NIK atau ALTERNATIF",
    options: ["NIK", "ALTERNATIF"],
    value: (b) => (b.identityBasis.kind === "NIK" ? "NIK" : "ALTERNATIF"),
    apply: (b, text) => {
      const kind = parseIdentityKind(text);
      if (!kind) return null;
      if (kind === b.identityBasis.kind) return b;
      return { ...b, identityBasis: kind === "NIK" ? { kind, value: "" } : { kind, description: "" } };
    },
  },
  {
    id: "nik", header: "NIK", width: 170, mono: true, hint: "16 digit, bila dasar identitas NIK",
    enabled: (b) => b.identityBasis.kind === "NIK",
    value: (b) => (b.identityBasis.kind === "NIK" ? b.identityBasis.value : ""),
    normalize: normalizeNik,
    apply: (b, text) => (b.identityBasis.kind === "NIK" ? { ...b, identityBasis: { kind: "NIK", value: text } } : null),
    validate: (b) =>
      b.identityBasis.kind === "NIK" && !/^\d{16}$/.test(b.identityBasis.value) ? "NIK harus 16 digit angka." : null,
  },
  {
    id: "identityDescription", header: "Keterangan identitas", width: 220, hint: "Wajib bila tanpa NIK",
    enabled: (b) => b.identityBasis.kind === "ALTERNATIVE",
    value: (b) => (b.identityBasis.kind === "ALTERNATIVE" ? b.identityBasis.description : ""),
    apply: (b, text) =>
      b.identityBasis.kind === "ALTERNATIVE" ? { ...b, identityBasis: { kind: "ALTERNATIVE", description: text } } : null,
    validate: (b) =>
      b.identityBasis.kind === "ALTERNATIVE" && b.identityBasis.description.trim() === ""
        ? "Jelaskan dasar identitas alternatif (mis. anak tanpa KTP); jangan mengarang NIK."
        : null,
  },
  {
    id: "guardianName", header: "Nama perwakilan", width: 170,
    value: (b) => b.guardian?.name ?? "",
    apply: (b, text) => ({ ...b, guardian: pair("name", "relationship", text, b.guardian?.relationship ?? "") }),
  },
  {
    id: "guardianRelation", header: "Hubungan perwakilan", width: 150,
    value: (b) => b.guardian?.relationship ?? "",
    apply: (b, text) => ({ ...b, guardian: pair("name", "relationship", b.guardian?.name ?? "", text) }),
  },
  {
    id: "addressOrScope", header: "Alamat/cakupan", width: 240, hint: "Wajib",
    value: (b) => b.addressOrScope,
    apply: (b, text) => ({ ...b, addressOrScope: text }),
    validate: (b) => required(b.addressOrScope, "Alamat/cakupan penerima tidak boleh kosong."),
  },
  {
    id: "asnaf", header: "Asnaf", width: 130, hint: "Wajib",
    options: ASNAF_OPTIONS,
    normalize: (text) => normalizeChoice(text, ASNAF_OPTIONS),
    value: (b) => b.asnaf,
    apply: (b, text) => ({ ...b, asnaf: text }),
    validate: (b) => required(b.asnaf, "Kategori asnaf tidak boleh kosong."),
  },
  {
    id: "paymentRecipientName", header: "Penerima pembayaran", width: 190,
    value: (b) => b.paymentRecipient?.name ?? "",
    apply: (b, text) => ({ ...b, paymentRecipient: pair("name", "relation", text, b.paymentRecipient?.relation ?? "") }),
  },
  {
    id: "paymentRecipientRelation", header: "Hubungan penerima pembayaran", width: 200,
    value: (b) => b.paymentRecipient?.relation ?? "",
    apply: (b, text) => ({ ...b, paymentRecipient: pair("name", "relation", b.paymentRecipient?.name ?? "", text) }),
  },
  {
    id: "contactPhone", header: "Kontak telepon", width: 150, mono: true,
    value: (b) => b.contact?.phone ?? "",
    apply: (b, text) => withContact(b, { phone: text }),
  },
  {
    id: "contactEmail", header: "Kontak email", width: 190,
    value: (b) => b.contact?.email ?? "",
    apply: (b, text) => withContact(b, { email: text }),
  },
  {
    id: "contactRelation", header: "Relasi kontak", width: 150,
    value: (b) => b.contact?.relation ?? "",
    apply: (b, text) => withContact(b, { relation: text }),
  },
];

const money = (line: AidLine) => (line.value.kind === "MONEY" ? line.value : null);
const goods = (line: AidLine) => (line.value.kind === "GOODS" ? line.value : null);
const withGoods = (line: AidLine, patch: Partial<Extract<AidLine["value"], { kind: "GOODS" }>>): AidLine | null => {
  const value = goods(line);
  return value ? { ...line, value: { ...value, ...patch } } : null;
};

export function aidLineColumns(beneficiaries: Beneficiary[]): GridColumn<AidLine>[] {
  const labels = new Map(beneficiaries.map((b, i) => [b.id, beneficiaryLabel(b, i)]));
  return [
    {
      id: "beneficiaryId", header: "Penerima", width: 230, hint: "Nama, label, atau NIK penerima",
      options: [...labels.values()],
      value: (line) => labels.get(line.beneficiaryId) ?? line.beneficiaryId,
      // Unmatched text is kept so the cell shows what was pasted and is flagged.
      apply: (line, text) => ({ ...line, beneficiaryId: matchBeneficiary(text, beneficiaries) ?? text.trim() }),
      validate: (line) => (labels.has(line.beneficiaryId)
        ? null
        : line.beneficiaryId ? "Penerima tidak ditemukan pada tab Penerima (atau namanya dipakai lebih dari satu orang)." : "Pilih penerima rincian ini."),
    },
    {
      id: "aidType", header: "Nama bantuan", width: 190, hint: "Wajib",
      value: (line) => line.aidType,
      apply: (line, text) => ({ ...line, aidType: text }),
      validate: (line) => required(line.aidType, "Jenis bantuan tidak boleh kosong."),
    },
    {
      id: "period", header: "Periode", width: 120, hint: "Wajib, mis. 2026-Q1",
      value: (line) => line.period,
      apply: (line, text) => ({ ...line, period: text }),
      validate: (line) => required(line.period, "Periode bantuan harus diisi."),
    },
    {
      id: "kind", header: "Bentuk", width: 100, hint: "UANG atau BARANG",
      options: ["UANG", "BARANG"],
      value: (line) => (line.value.kind === "MONEY" ? "UANG" : "BARANG"),
      apply: (line, text) => {
        const kind = parseAidKind(text);
        if (!kind) return null;
        if (kind === line.value.kind) return line;
        return {
          ...line,
          value: kind === "GOODS"
            ? { kind, unit: "", quantityRequested: "", quantityApproved: null, valuedAmountIdr: null }
            : { kind, amountRequestedIdr: "", amountApprovedIdr: null },
        };
      },
    },
    {
      id: "amountRequestedIdr", header: "Nilai IDR", width: 140, mono: true, align: "right", hint: "Bila UANG; rupiah bulat",
      enabled: (line) => line.value.kind === "MONEY",
      value: (line) => money(line)?.amountRequestedIdr ?? "",
      normalize: normalizeRupiah,
      apply: (line, text) => {
        const value = money(line);
        return value ? { ...line, value: { ...value, amountRequestedIdr: text } } : null;
      },
      validate: (line) => {
        const value = money(line);
        return value && !isRupiah(value.amountRequestedIdr) ? "Jumlah IDR harus bilangan bulat rupiah, tanpa desimal." : null;
      },
    },
    {
      id: "quantityRequested", header: "Jumlah barang", width: 120, mono: true, align: "right", hint: "Bila BARANG",
      enabled: (line) => line.value.kind === "GOODS",
      value: (line) => goods(line)?.quantityRequested ?? "",
      normalize: normalizeQuantity,
      apply: (line, text) => withGoods(line, { quantityRequested: text }),
      validate: (line) => {
        const value = goods(line);
        return value && !isExactNonNegativeDecimal(value.quantityRequested) ? "Jumlah barang harus angka eksak (mis. 2 atau 2.5)." : null;
      },
    },
    {
      id: "unit", header: "Satuan", width: 110, hint: "Bila BARANG",
      enabled: (line) => line.value.kind === "GOODS",
      value: (line) => goods(line)?.unit ?? "",
      apply: (line, text) => withGoods(line, { unit: text }),
      validate: (line) => (goods(line) ? required(goods(line)!.unit, "Satuan barang harus dinyatakan.") : null),
    },
    {
      id: "valuedAmountIdr", header: "Nilai IDR barang", width: 150, mono: true, align: "right", hint: "Opsional",
      enabled: (line) => line.value.kind === "GOODS",
      value: (line) => goods(line)?.valuedAmountIdr ?? "",
      normalize: normalizeRupiah,
      apply: (line, text) => withGoods(line, { valuedAmountIdr: text.trim() === "" ? null : text }),
      validate: (line) => {
        const value = goods(line);
        return value && value.valuedAmountIdr !== null && !isRupiah(value.valuedAmountIdr)
          ? "Nilai IDR barang harus bilangan bulat rupiah."
          : null;
      },
    },
    {
      id: "valuationBasis", header: "Dasar valuasi barang", width: 240, hint: "Wajib bila nilai IDR barang diisi",
      enabled: (line) => line.value.kind === "GOODS",
      value: (line) => goods(line)?.valuationBasis ?? "",
      apply: (line, text) => withGoods(line, { valuationBasis: text.trim() === "" ? null : text }),
      validate: (line) => {
        const value = goods(line);
        return value && value.valuedAmountIdr !== null && !value.valuationBasis?.trim()
          ? "Nyatakan sumber dan perhitungan estimasi nilai barang, atau kosongkan nilai IDR."
          : null;
      },
    },
    {
      id: "evidenceReference", header: "Referensi bukti", width: 220,
      value: (line) => line.evidenceReference ?? "",
      apply: (line, text) => ({ ...line, evidenceReference: text.trim() === "" ? null : text }),
    },
  ];
}
