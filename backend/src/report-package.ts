/** Application boundary for report packages. Only committed snapshot bytes supply facts. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson, commitmentFor, parseSnapshot, verifyCommitment } from "./evidence-snapshot";
import type { EvidenceSnapshot } from "./evidence-snapshot";
import type { EvidenceStore, PreparationRecord } from "./evidence-store";
import { entriesFrom } from "./evidence-source";
import { reconcile } from "./reconciliation";
import { computeSnapshotFigures, FIGURE_UNITS } from "./period-report";
import { draftReport, toReportDraft } from "./report-drafter";
import { validateDraft } from "./report-validator";
import type { PrivateFileStore } from "./evidence-files";
import { sha256Hex } from "./evidence-snapshot";

export const REPORT_POLICY = {
  id: "reconciliation-snapshot-v1",
  scope: "RECONCILIATION",
  mandatorySources: ["CLAIM", "SOURCE"],
  claims: "ALL_SUPPORTED_FIGURES_EXACT",
  narrative: "RUPIAH_SCAN_ONLY_NOT_SEMANTIC_CERTIFICATION",
  amil: "NOT_EXAMINED_WITHOUT_INSTITUTION_POLICY",
} as const;

export const AmilRulesSchema = z.array(z.object({
  institutionId: z.string().min(1), version: z.string().min(1), basis: z.literal("SOURCE_COLLECTION_ROWS"),
  fundType: z.enum(["ZAKAT", "FITRAH", "INFAK_SEDEKAH", "KURBAN", "DSKL"]), ceilingBps: z.number().int().min(0).max(10000),
}).strict());
export type AmilRule = z.infer<typeof AmilRulesSchema>[number];
export class PackageError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}
export const wire = <T>(value: T): any => JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
const text = z.string().trim().min(1).max(500);
const DraftInput = z.object({
  narrative: z.string().min(1).max(50000),
  claims: z.array(z.object({ name: text, amount: z.string().max(200), unit: z.enum(FIGURE_UNITS) }).strict()).max(2000),
}).strict();
const Input = z.object({
  reportId: text, version: text, mode: z.enum(["HUMAN", "AI"]),
  predecessor: z.string().uuid().nullable().default(null), correctionReason: text.nullable().default(null),
  draft: DraftInput.optional(), disclosure: z.unknown().optional(),
}).strict();

function snapshotOf(record: PreparationRecord): EvidenceSnapshot {
  if (!verifyCommitment(new TextEncoder().encode(record.canonicalSnapshot), record.commitmentSalt, record.commitment)) {
    throw new PackageError("Commitment snapshot tidak cocok; sumber harus diperiksa kembali.", 409);
  }
  return parseSnapshot(record.canonicalSnapshot);
}

export function reviewSnapshot(record: PreparationRecord, configuredRules: AmilRule[] = []) {
  const snapshot = snapshotOf(record);
  const blockers: string[] = [];
  const sides = snapshot.sides;
  for (const role of REPORT_POLICY.mandatorySources) {
    const side = sides.find(s => s.manifest.role === role);
    if (!side || side.status !== "READ") blockers.push(`Sumber wajib ${role} tidak tersedia.`);
  }
  for (const side of sides) {
    const m = side.manifest;
    if (m.institutionId !== snapshot.institutionId || canonicalJson(m.period) !== canonicalJson(snapshot.period)
      || m.currencyUnit !== snapshot.currencyUnit || !m.cutOff || !m.scopeUnit || !m.scopeLevel) {
      blockers.push("Identitas, periode, cut-off, cakupan, atau unit manifest tidak cocok.");
    }
  }
  if (sides.length !== 2) blockers.push("Dua sisi sumber wajib diperlukan.");
  if (sides[0] && sides[1] && (sides[0].manifest.cutOff !== sides[1].manifest.cutOff
    || sides[0].manifest.scopeUnit !== sides[1].manifest.scopeUnit
    || sides[0].manifest.scopeLevel !== sides[1].manifest.scopeLevel)) blockers.push("Cakupan atau cut-off kedua sisi berbeda.");
  let result: ReturnType<typeof reconcile> | null = null;
  if (blockers.length === 0) {
    const ledger = (role: "CLAIM" | "SOURCE") => {
      const s = sides.find(s => s.manifest.role === role)!;
      return { label: s.manifest.label, ...entriesFrom({ manifest: s.manifest, status: "READ", rows: s.rows }) };
    };
    result = reconcile(ledger("CLAIM"), ledger("SOURCE"), {
      period: snapshot.period, allowedBuckets: snapshot.allowedBuckets,
      tolerance: { amount: BigInt(snapshot.tolerance.amount), unit: snapshot.currencyUnit },
      ...(snapshot.balanceSheetScope === "BOTH" ? {} : { balanceSheet: snapshot.balanceSheetScope }),
    });
    if (result.discrepancies.some(d => ["DUPLICATE_KEY", "BUCKET_TOTAL_MISMATCH", "GRAND_TOTAL_MISMATCH"].includes(d.kind))) {
      blockers.push("Integritas baris atau total sumber tidak terpenuhi.");
    }
  }
  const figures = computeSnapshotFigures(snapshot, result);
  const rules = configuredRules.filter(r => r.institutionId === snapshot.institutionId);
  const amilChecks = rules.map(rule => {
    if (!rule.version || !rule.basis || !Number.isInteger(rule.ceilingBps) || rule.ceilingBps < 0 || rule.ceilingBps > 10000) {
      throw new PackageError("Konfigurasi kebijakan hak amil tidak sah.", 409);
    }
    const source = sides.find(s => s.manifest.role === "SOURCE");
    const rows = source?.rows.filter(r => !r.isDeclaredTotal && r.bucket === rule.fundType && (snapshot.balanceSheetScope === "BOTH" || r.balanceSheet === snapshot.balanceSheetScope)) ?? [];
    const available = source?.status === "READ" && source.manifest.fundTypes.includes(rule.fundType) && rows.every(r => r.amilAmount !== null);
    const basis = rows.reduce((sum, r) => sum + BigInt(r.amount), 0n);
    const actual = rows.reduce((sum, r) => sum + BigInt(r.amilAmount ?? "0"), 0n);
    const passed = available && actual * 10000n <= basis * BigInt(rule.ceilingBps);
    if (!passed) blockers.push(`Kebijakan hak amil ${rule.version}: dasar tidak tersedia atau plafon terlampaui.`);
    return { rule, available, basis: available ? basis.toString() : null, actual: available ? actual.toString() : null, passed };
  });
  const limitations = [
    "Penyaluran per asnaf dan durasi tidak tersedia dari baris ledger ini.",
    "Jenis dana di luar manifest tidak diperiksa; angka rekap bukan bukti pembayaran individual.",
    "Pemindai narasi memeriksa angka rupiah; makna kalimat dan angka nonmoneter belum diperiksa.",
    ...(rules.length ? [] : ["Hak amil belum diperiksa: kebijakan lembaga dan dasar dana belum dikonfigurasi."]),
    ...snapshot.coverageNotes,
  ];
  const disclosure = {
    scope: REPORT_POLICY.scope,
    sources: sides.map(s => ({ role: s.manifest.role, status: s.status, cutOff: s.manifest.cutOff, transactionDetail: s.manifest.transactionDetail })),
    limitations, findings: wire(result?.discrepancies ?? []),
  };
  const reconciliation = result ? { ...result, amilAssessment: { scope: "INSTITUTION_POLICY", checks: amilChecks } } : null;
  return { snapshot, figures, reconciliation, blockers, limitations, disclosure, policy: { ...REPORT_POLICY, amilChecks } };
}

export function createReportPackages(store: EvidenceStore, files?: PrivateFileStore, rules: AmilRule[] = []) {
  async function preparation(institutionId: string, id: string) {
    const record = await store.getPreparation(institutionId, id);
    if (!record) throw new PackageError("Snapshot tidak ditemukan.", 404);
    return record;
  }
  async function read(institutionId: string, preparationId: string, id: string) {
    const saved = await store.getReportPackage(institutionId, preparationId, id);
    if (!saved) throw new PackageError("Paket tidak ditemukan.", 404);
    const record = await preparation(institutionId, preparationId);
    if (!verifyCommitment(new TextEncoder().encode(saved.canonical), record.commitmentSalt, saved.digest)) throw new PackageError("Digest paket tidak cocok.", 409);
    return { ...JSON.parse(saved.canonical), digest: saved.digest };
  }
  async function persist(record: PreparationRecord, body: Record<string, unknown>) {
    const canonical = canonicalJson(wire(body));
    const digest = commitmentFor(new TextEncoder().encode(canonical), record.commitmentSalt);
    await store.saveReportPackage(record.institutionId, record.id, String(body.id), canonical, digest);
    return { ...JSON.parse(canonical), digest };
  }
  return {
    read,
    list: (institutionId: string, preparationId: string) => store.listReportPackages(institutionId, preparationId),
    async review(institutionId: string, id: string) { return wire(reviewSnapshot(await preparation(institutionId, id), rules)); },
    async prepare(institutionId: string, id: string, raw: unknown) {
      const parsed = Input.safeParse(raw);
      if (!parsed.success) throw new PackageError("Identitas laporan, draf, atau bentuk permintaan tidak sah.");
      const input = parsed.data;
      if ((input.predecessor === null) !== (input.correctionReason === null)) throw new PackageError("Koreksi memerlukan predecessor dan alasan.");
      const record = await preparation(institutionId, id);
      if (input.predecessor) {
        const previous = await store.findReportPackage(institutionId, input.predecessor);
        if (!previous) throw new PackageError("Pendahulu tidak ditemukan dalam lembaga ini.");
        const body = JSON.parse(previous.canonical);
        if (body.reportId !== input.reportId || body.version === input.version || body.status !== "FROZEN") throw new PackageError("Pendahulu harus versi beku lain dari laporan yang sama.");
      }
      const review = reviewSnapshot(record, rules);
      let draft = input.draft ? toReportDraft(input.draft) : null;
      let aiUnavailable: string | null = null;
      if (input.mode === "AI") {
        const attempt = await draftReport({ period: review.snapshot.period, figures: review.figures, notes: [
          ...review.limitations, "Semua angka wajib tercantum dalam claims. Laporkan selisih tanpa menyatakan sumber seimbang.",
        ] });
        draft = attempt.draft;
        aiUnavailable = attempt.unavailable ? "Layanan AI tidak tersedia. Angka dan temuan tetap tersimpan; masukkan draf manusia." : null;
      }
      if (input.mode === "HUMAN" && !draft) throw new PackageError("Draf manusia wajib diisi.");
      const checked = draft ? validateDraft({ figures: review.figures, amilShare: null }, draft) : null;
      const prerequisites = [...review.blockers];
      if (!draft) prerequisites.push("Draf belum tersedia.");
      for (const figure of review.figures) if (!draft?.claims.some(c => c.name === figure.name)) prerequisites.push(`Klaim wajib ${figure.name} belum diisi.`);
      if (review.figures.length === 0) prerequisites.push("Angka bersumber belum tersedia.");
      if (canonicalJson(input.disclosure ?? null) !== canonicalJson(review.disclosure)) prerequisites.push("Pernyataan cakupan, keterbatasan, dan temuan harus sesuai manifest.");
      const verdict = { outcome: prerequisites.length || checked?.outcome !== "LOLOS" ? "DITOLAK" : "LOLOS", findings: checked?.findings ?? [], prerequisites };
      return persist(record, {
        format: "tawf.report.package", serializationVersion: 1, id: randomUUID(), status: "DRAFT",
        institutionId, preparationId: id, reportId: input.reportId, version: input.version,
        predecessor: input.predecessor, correctionReason: input.correctionReason,
        snapshot: review.snapshot, snapshotCommitment: record.commitment,
        figures: review.figures, reconciliation: review.reconciliation, policy: review.policy,
        draft, verdict, limitations: review.limitations, disclosure: input.disclosure ?? null, aiUnavailable,
        publicSummary: { institutionId, period: review.snapshot.period, reportId: input.reportId, version: input.version,
          verdict: verdict.outcome, findingCount: review.reconciliation?.discrepancies.length ?? null,
          netDelta: review.reconciliation?.netDelta ?? null, scope: REPORT_POLICY.scope,
          limitations: ["ASNAF_UNAVAILABLE", "DURATION_UNAVAILABLE", "NARRATIVE_SEMANTICS_UNEXAMINED", ...(review.policy.amilChecks.length ? [] : ["AMIL_UNEXAMINED"])],
          tolerance: review.snapshot.tolerance, examination: "RECONCILIATION_ONLY", publication: "NOT_PUBLISHED" },
      });
    },
    async freeze(institutionId: string, preparationId: string, id: string) {
      const saved = await read(institutionId, preparationId, id);
      if (saved.status === "FROZEN") return saved;
      const hex = sha256Hex(new TextEncoder().encode(`tawf.report.freeze.v1:${id}`)).slice(2, 34);
      const frozenId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
      if (await store.getReportPackage(institutionId, preparationId, frozenId)) return read(institutionId, preparationId, frozenId);
      const record = await preparation(institutionId, preparationId);
      snapshotOf(record);
      for (const file of record.files) {
        if (!files || !file.storageRef || file.storageStatus !== "STORED") throw new PackageError("Berkas wajib tidak tersedia.", 409);
        let bytes: Uint8Array | null;
        try { bytes = await files.get(file.storageRef); } catch { throw new PackageError("Berkas wajib tidak dapat dibaca.", 409); }
        if (!bytes || sha256Hex(bytes) !== file.contentSha256) throw new PackageError("Berkas sumber tidak cocok dengan commitment.", 409);
      }
      const { digest, ...body } = saved;
      // A distinct content identity: previously inspected drafts remain readable.
      return persist(record, { ...body, id: frozenId, status: "FROZEN", frozenFrom: id });
    },
  };
}
