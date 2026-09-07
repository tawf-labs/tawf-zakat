/**
 * How long a disbursement actually took (Spec #61, ticket #65).
 *
 * A lembaga can claim its penyaluran is fast; until now it could not show the
 * number. This module produces it - stage by stage, from the timestamps and
 * block numbers this system already stores.
 *
 * What is measured is the duration of the process *inside this system*: from
 * the proposal being recorded to the auditor's attestation being written. It is
 * emphatically not the hours a lembaga spends drafting its report. The two are
 * different, and equating them would mislead every reader of the figure.
 *
 * Pure on purpose - no database, no `store`, no `viem`, no network, no clock -
 * so the whole of its behaviour is testable offline and deterministic.
 *
 * The honesty rule that shapes every type here: **a stage with no usable
 * timestamp yields no duration at all.** Four states, kept apart because they
 * mean different things to a reader:
 *
 * - `SELESAI` - both ends dated, so there is a real duration.
 * - `BELUM_SELESAI` - the stage has not been passed yet. Reporting this as zero
 *   hours would read as instant, which is the opposite of the truth.
 * - `TIDAK_TERCATAT` - the stage was passed, but this system holds no readable
 *   wall-clock for it. Persetujuan DPS is the standing case: it happens on
 *   chain and is indexed with its block number, but no approval timestamp
 *   column exists and this ticket adds no migration. A block number fixes the
 *   order of events; it is not a clock, and inventing one from it would be the
 *   very fabrication this whole feature exists to catch.
 * - `URUTAN_TERBALIK` - both ends are dated, but the later stage is stamped
 *   earlier than the one before it. That is a contradictory record, not a
 *   missing clock, and filing it under the previous state would hide a data
 *   integrity fault behind a benign label.
 */

import { isAttested, readableTime } from "./ledger-rows";

/** The four stages of ADR-0006, in the order authority passes through them. */
export const DISBURSEMENT_STAGES = [
  "PENGAJUAN",
  "PERSETUJUAN_DPS",
  "EKSEKUSI",
  "ATESTASI",
] as const;

export type DisbursementStage = (typeof DISBURSEMENT_STAGES)[number];

export const STAGE_LABELS: Record<DisbursementStage, string> = {
  PENGAJUAN: "Pengajuan Amil",
  PERSETUJUAN_DPS: "Persetujuan Dewan Pengawas Syariah",
  EKSEKUSI: "Eksekusi penyaluran",
  ATESTASI: "Atestasi Auditor Independen",
};

/** One stage as this system can actually evidence it. */
export type StageMark = {
  stage: DisbursementStage;
  label: string;
  /** Whether the disbursement has passed this stage at all. */
  reached: boolean;
  /** ISO wall-clock, or null when this system holds no readable one. */
  at: string | null;
  /** The block that fixed this stage on chain, or null when none was indexed. */
  blockNumber: number | null;
};

export const INTERVAL_STATES = [
  "SELESAI",
  "BELUM_SELESAI",
  "TIDAK_TERCATAT",
  "URUTAN_TERBALIK",
] as const;

export type IntervalState = (typeof INTERVAL_STATES)[number];

export type StageInterval = {
  /** Stable machine name, the same one the period figures are published under. */
  name: IntervalName;
  label: string;
  from: DisbursementStage;
  to: DisbursementStage;
  state: IntervalState;
  /**
   * The exact span, kept so the period average can be taken before any
   * rounding. Not published: the hour count below is the figure a draft may
   * claim, and two published numbers for one span would invite a mismatch.
   */
  elapsedMs: bigint | null;
  /** Whole hours, floored. Present only when `state` is `SELESAI`. */
  hours: bigint | null;
  /** Why there is no duration, said in the open. Null when there is one. */
  reason: string | null;
};

export type DisbursementTrail = {
  proposalId: number;
  marks: StageMark[];
  intervals: StageInterval[];
};

/** The intervals reported, in the order a reader walks them. */
const INTERVAL_DEFINITIONS = [
  {
    name: "pengajuan_ke_persetujuan",
    label: "Pengajuan sampai persetujuan DPS",
    from: "PENGAJUAN",
    to: "PERSETUJUAN_DPS",
  },
  {
    name: "persetujuan_ke_eksekusi",
    label: "Persetujuan DPS sampai eksekusi penyaluran",
    from: "PERSETUJUAN_DPS",
    to: "EKSEKUSI",
  },
  {
    // The whole pre-disbursement stretch, DPS review included. Coarser than the
    // two spans above and measurable today, which is what lets the report say
    // anything at all about where time goes before the money moves.
    name: "pengajuan_ke_eksekusi",
    label: "Pengajuan sampai eksekusi penyaluran",
    from: "PENGAJUAN",
    to: "EKSEKUSI",
  },
  {
    name: "eksekusi_ke_atestasi",
    label: "Eksekusi penyaluran sampai atestasi auditor",
    from: "EKSEKUSI",
    to: "ATESTASI",
  },
  {
    name: "pengajuan_ke_atestasi",
    label: "Pengajuan sampai atestasi auditor",
    from: "PENGAJUAN",
    to: "ATESTASI",
  },
] as const satisfies readonly {
  name: string;
  label: string;
  from: DisbursementStage;
  to: DisbursementStage;
}[];

export type IntervalName = (typeof INTERVAL_DEFINITIONS)[number]["name"];

export const INTERVAL_NAMES = INTERVAL_DEFINITIONS.map((definition) => definition.name);

/**
 * The end-to-end span. Named once, because it is the one interval that contains
 * the others and therefore has to be excluded wherever they are compared.
 */
export const TOTAL_INTERVAL: IntervalName = "pengajuan_ke_atestasi";

/**
 * Ways of cutting the timeline into spans that do not overlap, finest first.
 *
 * "Which stage loses the most time" is only a fair question between spans that
 * partition the same stretch. Comparing `pengajuan_ke_eksekusi` against the two
 * spans it contains would let one stage beat its own halves, so the comparison
 * picks a single partition and stays inside it.
 *
 * The fine cut needs a persetujuan DPS timestamp, which this system does not
 * store; the coarse cut needs only the columns that exist. So the report
 * answers the question at the granularity its data actually supports, and says
 * which granularity that was.
 */
const PARTITIONS = [
  {
    granularity: "per tahap",
    intervals: [
      "pengajuan_ke_persetujuan",
      "persetujuan_ke_eksekusi",
      "eksekusi_ke_atestasi",
    ],
  },
  {
    granularity: "sebelum dan sesudah dana keluar",
    intervals: ["pengajuan_ke_eksekusi", "eksekusi_ke_atestasi"],
  },
] as const satisfies readonly { granularity: string; intervals: readonly IntervalName[] }[];

const MS_PER_HOUR = 3_600_000;

/** A proposal row, read only for what its stages left behind. */
export type TrailRow = {
  proposalIdOnChain: number;
  status: string; // 'Pending' | 'Approved' | 'Executed' | 'Cancelled'
  createdAt?: Date | string | null;
  executedAt?: Date | string | null;
  auditStatus?: string | null;
  auditedAt?: Date | string | null;
};

/** Block numbers a stage was fixed at, for the stages that leave an event. */
export type StageBlocks = Partial<Record<DisbursementStage, number>>;

/**
 * Whether each stage has been passed, read from the status the row carries.
 *
 * A stored proposal row exists because it was submitted, so PENGAJUAN is always
 * behind it. The rest follow the lifecycle: an executed disbursement has by
 * definition cleared the DPS, and an attestation is what marks the last stage.
 */
function stageReached(row: TrailRow, blocks: StageBlocks): Record<DisbursementStage, boolean> {
  const status = String(row.status ?? "").toUpperCase();
  const executed = status === "EXECUTED" || readableTime(row.executedAt) !== null;
  return {
    PENGAJUAN: true,
    PERSETUJUAN_DPS:
      executed || status === "APPROVED" || blocks.PERSETUJUAN_DPS !== undefined,
    EKSEKUSI: executed,
    ATESTASI: isAttested(row),
  };
}

/**
 * The wall-clock each stage left in this system, or null where it left none.
 *
 * `PERSETUJUAN_DPS` is null by construction: the approval is an on-chain event
 * and no column stores when it happened. Stated here rather than approximated.
 */
function stageTime(row: TrailRow): Record<DisbursementStage, Date | null> {
  return {
    PENGAJUAN: readableTime(row.createdAt),
    PERSETUJUAN_DPS: null,
    EKSEKUSI: readableTime(row.executedAt),
    ATESTASI: readableTime(row.auditedAt),
  };
}

const NO_TIMESTAMP: Record<DisbursementStage, string> = {
  PENGAJUAN: "Baris penyaluran ini tidak menyimpan tanggal pengajuan yang dapat dibaca.",
  PERSETUJUAN_DPS:
    "Persetujuan DPS tercatat sebagai event on-chain beserta nomor bloknya, tetapi sistem ini " +
    "tidak menyimpan stempel waktunya, sehingga durasinya tidak dihitung.",
  EKSEKUSI: "Baris penyaluran ini tidak menyimpan tanggal eksekusi yang dapat dibaca.",
  ATESTASI: "Atestasi ini tidak menyimpan tanggal yang dapat dibaca.",
};

/**
 * Turns one proposal row into its stage-by-stage trail.
 *
 * `blocks` carries the block numbers already indexed for this proposal; without
 * them the trail still stands, with its on-chain markers absent rather than
 * guessed.
 */
export function disbursementTrail(row: TrailRow, blocks: StageBlocks = {}): DisbursementTrail {
  const reached = stageReached(row, blocks);
  const times = stageTime(row);

  const marks: StageMark[] = DISBURSEMENT_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    reached: reached[stage],
    at: reached[stage] ? (times[stage]?.toISOString() ?? null) : null,
    blockNumber: blocks[stage] ?? null,
  }));

  const intervals = INTERVAL_DEFINITIONS.map((definition) =>
    measure(definition, reached, times)
  );

  return { proposalId: row.proposalIdOnChain, marks, intervals };
}

function measure(
  definition: (typeof INTERVAL_DEFINITIONS)[number],
  reached: Record<DisbursementStage, boolean>,
  times: Record<DisbursementStage, Date | null>
): StageInterval {
  const base = {
    name: definition.name,
    label: definition.label,
    from: definition.from,
    to: definition.to,
  };
  const unmeasured = (state: IntervalState, reason: string): StageInterval => ({
    ...base,
    state,
    elapsedMs: null,
    hours: null,
    reason,
  });

  // Not yet passed outranks not recorded: a reader must never read "we have no
  // clock for this" when the truth is "this has not happened".
  for (const stage of [definition.to, definition.from]) {
    if (!reached[stage]) {
      return unmeasured(
        "BELUM_SELESAI",
        `Tahap "${STAGE_LABELS[stage]}" belum terlewati, sehingga durasinya belum ada.`
      );
    }
  }

  for (const stage of [definition.from, definition.to]) {
    if (times[stage] === null) return unmeasured("TIDAK_TERCATAT", NO_TIMESTAMP[stage]);
  }

  const from = times[definition.from]!;
  const to = times[definition.to]!;
  const elapsed = to.getTime() - from.getTime();

  // A record that contradicts itself, kept apart from a record that is merely
  // silent. Both yield no duration, but only one of them is a fault somebody
  // should go and fix.
  if (elapsed < 0) {
    return unmeasured(
      "URUTAN_TERBALIK",
      `Stempel waktu "${STAGE_LABELS[definition.to]}" mendahului "${STAGE_LABELS[definition.from]}", ` +
        `sehingga baris ini bertentangan dengan dirinya sendiri dan durasinya tidak dilaporkan.`
    );
  }

  // Floored to whole hours, never rounded: a duration reported longer than it
  // was is still a duration nobody can trace back to the ledger. The exact span
  // is carried alongside so the period average is floored once, not twice.
  return {
    ...base,
    state: "SELESAI",
    elapsedMs: BigInt(elapsed),
    hours: BigInt(Math.floor(elapsed / MS_PER_HOUR)),
    reason: null,
  };
}

// --- Block numbers from indexed events ---------------------------------------

/** An indexed on-chain event, as `onchain_events` stores it. */
export type StageEventRow = { eventName: string; blockNumber: number; argsJson: string };

/**
 * Which event marks which stage. Attestation is absent on purpose: it is
 * relayed gasless (ADR-0009) and is not among the indexed event ABIs, so no
 * block number exists for it and none is invented.
 */
const STAGE_BY_EVENT: Record<string, DisbursementStage> = {
  DisbursementProposed: "PENGAJUAN",
  DisbursementApproved: "PERSETUJUAN_DPS",
  DisbursementExecuted: "EKSEKUSI",
};

/**
 * The event names a caller must read to fill `stageBlocksByProposal`. Derived
 * from the map above rather than written out again, so a stage added there
 * cannot be silently dropped by the query that feeds it.
 */
export const STAGE_EVENT_NAMES = Object.keys(STAGE_BY_EVENT);

/**
 * Which block to keep when a stage carries several events.
 *
 * The DPS approval is a collegial quorum, so the stage is passed at the *last*
 * signature, not the first. Everything else keeps the earliest block, so an
 * event seen twice by the indexer cannot push a stage later than it happened.
 */
const keepBlock = (stage: DisbursementStage, existing: number, candidate: number): number =>
  stage === "PERSETUJUAN_DPS"
    ? Math.max(existing, candidate)
    : Math.min(existing, candidate);

/** Reads a proposal id out of an event's stored args, or null if it has none. */
function proposalIdOf(argsJson: string, stage: DisbursementStage): number | null {
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return null;
  }
  if (typeof args !== "object" || args === null) return null;
  const fields = args as Record<string, unknown>;
  // The contract emits count=1 for the Amil at submission; quorum is 2.
  if (stage === "PERSETUJUAN_DPS") {
    const count = Number(fields.currentApprovals);
    if (!Number.isInteger(count) || count < 2) return null;
  }
  const raw = fields.proposalId;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

/** Groups indexed events into the block number each stage was fixed at. */
export function stageBlocksByProposal(events: StageEventRow[]): Map<number, StageBlocks> {
  const byProposal = new Map<number, StageBlocks>();

  for (const event of events) {
    const stage = STAGE_BY_EVENT[event.eventName];
    if (!stage) continue;
    const proposalId = proposalIdOf(event.argsJson, stage);
    if (proposalId === null) continue;

    const blocks = byProposal.get(proposalId) ?? {};
    const existing = blocks[stage];
    blocks[stage] =
      existing === undefined ? event.blockNumber : keepBlock(stage, existing, event.blockNumber);
    byProposal.set(proposalId, blocks);
  }

  return byProposal;
}

// --- Period aggregate ---------------------------------------------------------

export type IntervalAggregate = {
  name: IntervalName;
  label: string;
  from: DisbursementStage;
  to: DisbursementStage;
  /**
   * Mean of the measured samples, floored once - taken from the exact spans
   * rather than from the already-floored hour counts, so the rounding happens
   * at the end and not twice.
   */
  averageHours: bigint | null;
  /** How many disbursements this average rests on. */
  sampleCount: number;
  /** What was left out, and why - so an average of one cannot read as a trend. */
  unmeasured: { belumSelesai: number; tidakTercatat: number; urutanTerbalik: number };
};

export type PeriodDurations = {
  intervals: IntervalAggregate[];
  /**
   * Where the most time is lost - null unless at least two stages are actually
   * measurable, because naming the slowest of one stage is not a comparison.
   */
  slowest: { name: IntervalName; label: string; averageHours: bigint; sampleCount: number } | null;
  /** Every disbursement's trail, so one can be opened and read stage by stage. */
  trails: DisbursementTrail[];
  notes: string[];
};

/**
 * Aggregates the trails of one period.
 *
 * Only `SELESAI` intervals feed an average. The rest are counted, by reason,
 * beside it: an average drawn from one disbursement out of forty is not a
 * duration a lembaga may quote as its own, and the sample count is what stops
 * it being read that way.
 */
export function periodDurations(trails: DisbursementTrail[]): PeriodDurations {
  const ordered = [...trails].sort((a, b) => a.proposalId - b.proposalId);

  const intervals: IntervalAggregate[] = INTERVAL_DEFINITIONS.map((definition) => {
    let totalMs = 0n;
    let sampleCount = 0;
    let belumSelesai = 0;
    let tidakTercatat = 0;
    let urutanTerbalik = 0;

    for (const trail of ordered) {
      const interval = trail.intervals.find((candidate) => candidate.name === definition.name);
      if (!interval) continue;
      if (interval.state === "SELESAI" && interval.elapsedMs !== null) {
        totalMs += interval.elapsedMs;
        sampleCount += 1;
      } else if (interval.state === "BELUM_SELESAI") {
        belumSelesai += 1;
      } else if (interval.state === "URUTAN_TERBALIK") {
        urutanTerbalik += 1;
      } else {
        tidakTercatat += 1;
      }
    }

    return {
      name: definition.name,
      label: definition.label,
      from: definition.from,
      to: definition.to,
      // Divided in milliseconds and floored once, so an average is never
      // dragged down by rounding each sample before adding it.
      averageHours:
        sampleCount === 0 ? null : totalMs / BigInt(sampleCount) / BigInt(MS_PER_HOUR),
      sampleCount,
      unmeasured: { belumSelesai, tidakTercatat, urutanTerbalik },
    };
  });

  return {
    intervals,
    slowest: slowestOf(intervals, ordered),
    trails: ordered,
    notes: [
      "Durasi yang diukur adalah lamanya proses di dalam sistem ini, dari pengajuan sampai atestasi - bukan jam kerja penyusunan laporan di lembaga.",
      "Rata-rata hanya dihitung dari tahap yang kedua ujungnya bertanggal; tahap yang belum terlewati tidak dihitung sebagai nol.",
      NO_TIMESTAMP.PERSETUJUAN_DPS,
      "Setiap rata-rata disertai jumlah penyaluran yang mendasarinya, sehingga rata-rata dari satu kejadian tidak terbaca sebagai tren.",
      "Atestasi yang terbit setelah periode berakhir tetap dihitung sebagai ujung durasi penyaluran periode ini, sehingga angka durasi dapat bertambah bila laporan disusun ulang setelah atestasi yang tertunda menyusul.",
      "Tahap paling lambat hanya dibandingkan pada rentang yang tidak saling tumpang tindih dan berasal dari penyaluran yang sama. Tanpa waktu persetujuan DPS, perbandingannya adalah sebelum dan sesudah dana keluar.",
    ],
  };
}

/** Compare a non-overlapping partition only when its samples are the same rows. */
function slowestOf(
  intervals: IntervalAggregate[],
  trails: DisbursementTrail[]
): PeriodDurations["slowest"] {
  const partition = PARTITIONS.find(({ intervals: names }) => {
    if (!names.every((name) => intervals.some((i) => i.name === name && i.sampleCount > 0))) {
      return false;
    }
    return trails.every((trail) => {
      const measured = names.map((name) =>
        trail.intervals.some((i) => i.name === name && i.state === "SELESAI")
      );
      return measured.every((value) => value === measured[0]);
    });
  });
  if (!partition) return null;
  const candidates = partition.intervals.map((name) => intervals.find((i) => i.name === name)!);

  const totalMs = (name: IntervalName) => trails.reduce(
    (sum, trail) => sum + (trail.intervals.find((i) => i.name === name)?.elapsedMs ?? 0n), 0n
  );
  let slowest = candidates[0]!;
  let longest = totalMs(slowest.name);
  let tied = false;
  for (const interval of candidates.slice(1)) {
    const elapsed = totalMs(interval.name);
    if (elapsed > longest) {
      slowest = interval;
      longest = elapsed;
      tied = false;
    } else if (elapsed === longest) {
      tied = true;
    }
  }
  if (tied) return null;

  return {
    name: slowest.name,
    label: slowest.label,
    averageHours: slowest.averageHours!,
    sampleCount: slowest.sampleCount,
  };
}
