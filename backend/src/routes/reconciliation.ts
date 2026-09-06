/**
 * Reconciliation routes (Spec #55) - mounted as its own module under
 * /api/reconciliation, deliberately outside the monolithic route file.
 *
 * The engine speaks `bigint`; JSON does not. Every `Money.amount` therefore
 * crosses the wire as a decimal string, in both directions, so trillion-scale
 * rupiah survives the round trip exactly.
 */

import { Hono } from "hono";
import {
  reconcile,
  ReconciliationInputError,
  type LedgerEntry,
  type LedgerSide,
  type Money,
  type ReconciliationOptions,
  type ReconciliationReport,
  type ReportingPeriod,
} from "../reconciliation";
import {
  buildInternalLedgerSides,
  snapshotFromRows,
  INTERNAL_BUCKETS,
  INTERNAL_UNITS,
} from "../reconciliation-internal";
import { dbService } from "../db/index";

type WireMoney = { amount: string; unit: string };

const PERIOD_KINDS = ["SEMESTER", "AKHIR_TAHUN"] as const;

function fail(message: string): never {
  throw new ReconciliationInputError(message);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${what} harus berupa objek.`);
  }
  return value as Record<string, unknown>;
}

function parseAmount(raw: unknown, where: string): bigint {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) fail(`${where} memiliki jumlah yang bukan bilangan bulat: ${raw}.`);
    return BigInt(raw);
  }
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw.trim())) {
    fail(
      `${where} memiliki jumlah yang bukan bilangan bulat: ${JSON.stringify(raw)}. ` +
        `Tulis rupiah penuh tanpa titik atau desimal, sebagai teks angka.`
    );
  }
  return BigInt(raw.trim());
}

function parseMoney(raw: unknown, where: string): Money {
  const record = asRecord(raw, `${where}: nilai`);
  const unit = record.unit ?? "IDR";
  if (unit !== "IDR" && unit !== "USDC_6DP") {
    fail(`${where} memakai unit tidak dikenal: ${JSON.stringify(unit)}. Gunakan "IDR" atau "USDC_6DP".`);
  }
  return { amount: parseAmount(record.amount, where), unit };
}

function parseEntry(raw: unknown, sideLabel: string, index: number, isTotal: boolean): LedgerEntry {
  const record = asRecord(raw, `${sideLabel}: baris pada index ${index}`);
  const key = typeof record.key === "string" ? record.key : "";
  const what = isTotal ? "total yang dideklarasikan" : "entri";
  const where = `${sideLabel}: ${what} pada index ${index}, key "${key}"`;

  if (key.trim() === "") fail(`${where} tidak memiliki key.`);
  if (typeof record.bucket !== "string" || record.bucket.trim() === "") {
    fail(`${where} tidak memiliki jenis dana.`);
  }

  const balanceSheet = record.balanceSheet ?? "ON";
  if (balanceSheet !== "ON" && balanceSheet !== "OFF") {
    fail(`${where} memakai posisi neraca tidak dikenal: ${JSON.stringify(balanceSheet)}.`);
  }

  return {
    key,
    bucket: record.bucket,
    balanceSheet,
    value: parseMoney(record.value, where),
    ...(typeof record.label === "string" ? { label: record.label } : {}),
  };
}

function parsePeriod(raw: unknown, what: string): ReportingPeriod {
  const record = asRecord(raw, what);
  if (!PERIOD_KINDS.includes(record.kind as (typeof PERIOD_KINDS)[number])) {
    fail(
      `${what} memakai jenis periode pelaporan tidak dikenal: ${JSON.stringify(record.kind)}. ` +
        `Gunakan "SEMESTER" (1 Januari-30 Juni) atau "AKHIR_TAHUN" (1 Januari-31 Desember).`
    );
  }
  const year = record.year;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) {
    fail(`${what} memakai tahun periode pelaporan yang tidak masuk akal: ${JSON.stringify(year)}.`);
  }
  return { kind: record.kind as ReportingPeriod["kind"], year };
}

const describePeriod = (period: ReportingPeriod): string => `${period.kind} ${period.year}`;

/** A ledger side on the wire may declare the period its report came from. */
function parseSide(raw: unknown, role: "claim" | "source"): { side: LedgerSide; period?: ReportingPeriod } {
  const roleName = role === "claim" ? "Sisi klaim" : "Sisi sumber";
  if (raw === undefined || raw === null) {
    fail(`${roleName} (${role}) tidak ada di dalam permintaan.`);
  }
  const record = asRecord(raw, roleName);

  const label = typeof record.label === "string" && record.label.trim() !== "" ? record.label : roleName;
  if (!Array.isArray(record.entries)) {
    fail(`${roleName} "${label}" tidak memiliki daftar entri.`);
  }

  const entries = record.entries.map((item, index) => parseEntry(item, label, index, false));

  const declaredTotalsRaw = record.declaredTotals;
  if (declaredTotalsRaw !== undefined && !Array.isArray(declaredTotalsRaw)) {
    fail(`${roleName} "${label}": declaredTotals harus berupa daftar.`);
  }
  const declaredTotals = Array.isArray(declaredTotalsRaw)
    ? declaredTotalsRaw.map((item, index) => parseEntry(item, label, index, true))
    : undefined;

  return {
    side: { label, entries, ...(declaredTotals ? { declaredTotals } : {}) },
    ...(record.period !== undefined
      ? { period: parsePeriod(record.period, `${roleName} "${label}": periode`) }
      : {}),
  };
}

function parseOptions(raw: unknown): ReconciliationOptions {
  const record = asRecord(raw ?? {}, "options");
  const period = parsePeriod(record.period, "Opsi rekonsiliasi: periode pelaporan");

  const allowedBuckets = record.allowedBuckets;
  if (allowedBuckets !== undefined) {
    if (!Array.isArray(allowedBuckets) || allowedBuckets.some((b) => typeof b !== "string")) {
      fail("Opsi rekonsiliasi: allowedBuckets harus berupa daftar teks.");
    }
    if (allowedBuckets.length === 0) {
      fail("Opsi rekonsiliasi: allowedBuckets tidak boleh kosong.");
    }
  }

  const balanceSheet = record.balanceSheet;
  if (balanceSheet !== undefined && balanceSheet !== "ON" && balanceSheet !== "OFF") {
    fail(
      `Opsi rekonsiliasi: posisi neraca tidak dikenal: ${JSON.stringify(balanceSheet)}. ` +
        `Gunakan "ON" (on balance sheet) atau "OFF" (off balance sheet).`
    );
  }

  return {
    period,
    ...(balanceSheet ? { balanceSheet } : {}),
    ...(record.tolerance !== undefined
      ? { tolerance: parseMoney(record.tolerance, "Opsi rekonsiliasi: toleransi") }
      : {}),
    ...(allowedBuckets ? { allowedBuckets: allowedBuckets as string[] } : {}),
  };
}

const serializeMoney = (value: Money): WireMoney => ({
  amount: value.amount.toString(),
  unit: value.unit,
});

export function serializeReport(report: ReconciliationReport) {
  return {
    ...report,
    netDelta: serializeMoney(report.netDelta),
    absoluteDelta: serializeMoney(report.absoluteDelta),
    discrepancies: report.discrepancies.map((discrepancy) => ({
      ...discrepancy,
      delta: serializeMoney(discrepancy.delta),
      ...(discrepancy.claimValue ? { claimValue: serializeMoney(discrepancy.claimValue) } : {}),
      ...(discrepancy.sourceValue ? { sourceValue: serializeMoney(discrepancy.sourceValue) } : {}),
    })),
  };
}

/** Parses an antar-lembaga request body into engine inputs. */
export function parseInterInstitutionRequest(payload: unknown): {
  claim: LedgerSide;
  source: LedgerSide;
  options: ReconciliationOptions;
} {
  const body = asRecord(payload, "Badan permintaan");
  const options = parseOptions(body.options);
  const claim = parseSide(body.claim, "claim");
  const source = parseSide(body.source, "source");

  // Reconciling reports from different periods compares apples with oranges.
  for (const [role, parsed] of [
    ["klaim", claim],
    ["sumber", source],
  ] as const) {
    if (!parsed.period) continue;
    if (parsed.period.kind === options.period.kind && parsed.period.year === options.period.year) {
      continue;
    }
    fail(
      `Periode pelaporan tidak seragam: sisi ${role} "${parsed.side.label}" berasal dari periode ` +
        `${describePeriod(parsed.period)}, sedangkan rekonsiliasi dijalankan untuk periode ` +
        `${describePeriod(options.period)}.`
    );
  }

  return { claim: claim.side, source: source.side, options };
}

function parseInternalRequest(payload: unknown): {
  period: ReportingPeriod | undefined;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  tolerance: Money | undefined;
} {
  const body = asRecord(payload ?? {}, "Badan permintaan");

  const readBlock = (raw: unknown, what: string): number | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
      fail(`${what} harus berupa nomor blok bulat yang tidak negatif.`);
    }
    return raw;
  };

  const fromBlock = readBlock(body.fromBlock, "fromBlock");
  const toBlock = readBlock(body.toBlock, "toBlock");
  if (fromBlock !== undefined && toBlock !== undefined && fromBlock > toBlock) {
    fail(`Rentang blok terbalik: fromBlock ${fromBlock} lebih besar daripada toBlock ${toBlock}.`);
  }

  return {
    period: body.period !== undefined ? parsePeriod(body.period, "Periode pelaporan") : undefined,
    fromBlock,
    toBlock,
    tolerance:
      body.tolerance !== undefined ? parseMoney(body.tolerance, "Toleransi") : undefined,
  };
}

const reconciliationRoutes = new Hono();

// Mode Antar-Lembaga: stateless, read-only. Claim = Laporan Zakat Wilayah,
// source = the Laporan Kinerja of the kabupaten/kota underneath it.
reconciliationRoutes.post("/antar-lembaga", async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: "Badan permintaan bukan JSON yang sah." },
      400
    );
  }

  try {
    const { claim, source, options } = parseInterInstitutionRequest(payload);
    const report = reconcile(claim, source, options);
    return c.json({ success: true, report: serializeReport(report) });
  } catch (error: any) {
    if (error instanceof ReconciliationInputError) {
      return c.json({ success: false, error: error.message }, 400);
    }
    return c.json(
      { success: false, error: error?.message || "Rekonsiliasi gagal dijalankan." },
      500
    );
  }
});

// Mode Internal: the caller sends no ledger at all. The server builds both sides
// itself - PostgreSQL as the claim, the indexed chain as the source - and runs
// them through the same pure engine, once per currency unit.
reconciliationRoutes.post("/internal", async (c) => {
  let payload: unknown = {};
  try {
    payload = await c.req.text().then((raw) => (raw.trim() === "" ? {} : JSON.parse(raw)));
  } catch {
    return c.json({ success: false, error: "Badan permintaan bukan JSON yang sah." }, 400);
  }

  let request: ReturnType<typeof parseInternalRequest>;
  try {
    request = parseInternalRequest(payload);
  } catch (error: any) {
    if (error instanceof ReconciliationInputError) {
      return c.json({ success: false, error: error.message }, 400);
    }
    throw error;
  }

  try {
    const indexerState = await dbService.getIndexerState();
    const lastIndexedBlock = Number(indexerState.lastIndexedBlock);

    // The chain is only reconcilable as far as the indexer has actually read.
    const fromBlock = request.fromBlock ?? 0;
    const toBlock = Math.min(request.toBlock ?? lastIndexedBlock, lastIndexedBlock);

    const [donationRows, batchRows, proposalRows, eventRows] = await Promise.all([
      dbService.getDonationRows(),
      dbService.getBatches(),
      dbService.getProposalRows(),
      toBlock >= fromBlock
        ? dbService.getOnchainEventsInRange(fromBlock, toBlock)
        : Promise.resolve([]),
    ]);

    const snapshot = snapshotFromRows(
      { donationRows, batchRows, proposalRows, eventRows },
      request.period
    );

    const reports: Record<string, ReturnType<typeof serializeReport>> = {};
    for (const unit of INTERNAL_UNITS) {
      const { claim, source } = buildInternalLedgerSides(snapshot, unit);
      const options: ReconciliationOptions = {
        period: request.period ?? { kind: "AKHIR_TAHUN", year: new Date().getUTCFullYear() },
        allowedBuckets: INTERNAL_BUCKETS,
        ...(request.tolerance && request.tolerance.unit === unit
          ? { tolerance: request.tolerance }
          : {}),
      };
      reports[unit] = serializeReport(reconcile(claim, source, options));
    }

    // Database rows carry no block number, so a narrowed block range bounds the
    // chain side only. Saying so is better than letting the caller read the
    // resulting one-sided gaps as real findings.
    const blockRangeIsNarrowed = fromBlock > 0 || toBlock < lastIndexedBlock;
    const scopeWarning = blockRangeIsNarrowed
      ? `Rentang blok ${fromBlock}-${toBlock} hanya membatasi sisi on-chain; baris basis data ` +
        `tidak menyimpan nomor blok sehingga baris di luar rentang akan tampak sebagai ` +
        `MISSING_IN_SOURCE. Untuk pembatasan yang setara di kedua sisi, gunakan periode pelaporan.`
      : null;

    return c.json({
      success: true,
      lastIndexedBlock,
      blockRange: { fromBlock, toBlock },
      indexerStatus: indexerState.status,
      ...(scopeWarning ? { scopeWarning } : {}),
      reports,
    });
  } catch (error: any) {
    if (error instanceof ReconciliationInputError) {
      return c.json({ success: false, error: error.message }, 400);
    }
    return c.json(
      { success: false, error: error?.message || "Rekonsiliasi internal gagal dijalankan." },
      500
    );
  }
});

export default reconciliationRoutes;
