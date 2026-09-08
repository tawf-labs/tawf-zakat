/**
 * The protocol's own USDC deposits, as a source a package can be frozen against
 * (Spec #68, ticket #79).
 *
 * Two representations of one population: the indexed `USDCDeposited` events, and
 * the internal PostgreSQL ledger's USDC donation rows. Reconciling them per
 * deposit is only honest if both sides carry the *native* amount and the *event
 * identity*, which is what #67 owns. This module therefore does two things and
 * refuses a third:
 *
 * 1. **Reads amounts exactly.** USDC minor units arrive as decimal text and stay
 *    decimal text on the way to `bigint`. Nothing here divides, multiplies, or
 *    decides what a number means from how large it is - a rule that costs
 *    nothing until the day someone deposits 0,5 USDC, at which point a
 *    magnitude heuristic silently reports 500.000 USDC.
 * 2. **Binds identity.** A deposit's key is chain, contract, transaction hash and
 *    log index together, so several deposits in one transaction stay several
 *    deposits, and the same event read twice stays one.
 * 3. **Never substitutes.** A ledger row with no provable on-chain pair is
 *    reported as *belum terverifikasi* with its reason. The estimated rupiah on
 *    that row, the exchange rate that produced it, and the row's own timestamp
 *    are not amounts and are never used as one.
 *
 * Where #67 has not landed - the ledger has no native amount column and no event
 * identity - the claim side is `MISSING` naming that, and every USDC row it
 * would have covered is listed as unverified. The chain side is still read, so
 * the package says exactly what was examined and what was not, rather than
 * comparing a real population against an empty one and calling it balanced.
 *
 * Pure: no database, no clock, no network. It takes rows and a scope and returns
 * sides, so every mapping rule above is testable without a connection.
 */

import type {
  NormalizedRow,
  RowOrigin,
  SourceManifest,
  SourceRole,
  SubmittedSide,
  UnverifiedRecord,
} from "./evidence-source";
import type { SourceRead } from "./source-read";

/** The stream this module maps. Named, so a request cannot ask for another one. */
export const USDC_DEPOSIT_STREAM = "USDC_DEPOSITS" as const;

/**
 * The bucket both sides are expressed in.
 *
 * Deliberately not one of the five jenis dana: an on-chain deposit event carries
 * no fund type, and picking one here would be this module deciding a
 * classification the chain never recorded.
 */
export const USDC_DEPOSIT_BUCKET = "DEPOSIT_USDC" as const;

/** The event the deposit stream is read from. */
export const USDC_DEPOSIT_EVENT = "USDCDeposited" as const;

export const USDC_DEPOSIT_MAPPING_VERSION = "internal-usdc-deposits-1" as const;

/**
 * Which chain, which contract, and how far the indexer had actually read.
 *
 * Frozen into the manifest, because "we compared the ledger against the chain"
 * means nothing without the checkpoint that says how much of the chain had been
 * read at the time.
 */
export type ChainScope = {
  chainId: number;
  /** Lowercased hex. Comparisons are case-insensitive; the record is not. */
  contract: string;
  indexerKey: string;
  fromBlock: number;
  /** The last block examined - never beyond the checkpoint below. */
  toBlock: number;
  checkpoint: {
    lastIndexedBlock: number;
    status: string;
    /** ISO 8601, or null when the deployment has never recorded a sync. */
    lastSyncAt: string | null;
  };
  /** Blocks the matched events actually spanned. `null` when none matched. */
  observed: { firstBlock: number; lastBlock: number; eventCount: number } | null;
  /**
   * Whether the mirror kept the block hash of each event.
   *
   * The indexed event table records chain, contract, transaction hash, log index
   * and block number, and no block hash. Saying so is the difference between a
   * known limit and a package that appears to pin a canonical block it never saw.
   */
  blockHashes: "RETAINED" | "NOT_RETAINED";
};

/** One indexed event row, as the mirror hands it over. */
export type DepositEventRow = {
  eventName: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash?: string | null;
  contractAddress: string;
  argsJson: string;
  createdAt?: Date | string | null;
};

/**
 * One internal ledger row for a USDC deposit.
 *
 * The native fields are the ones #67 owns. They are optional here on purpose:
 * this module has to work both before and after that ticket lands, and the
 * difference has to be visible in the package rather than assumed.
 */
export type LedgerDepositRow = {
  trxId: string;
  /** Native USDC minor units, as stored. Absent until #67 lands. */
  amountUsdc?: string | number | null;
  depositChainId?: number | null;
  depositContract?: string | null;
  depositTxHash?: string | null;
  depositLogIndex?: number | null;
  /** Estimated rupiah. Read only to say it is not an amount; never converted. */
  amountIDR?: string | number | null;
  createdAt?: Date | string | null;
};

/**
 * What the internal ledger answered, and whether it can answer at all.
 *
 * `nativeIdentityAvailable` is a fact about the deployment's schema, established
 * before the read rather than inferred from the rows: a period with no deposits
 * and a ledger that cannot record one are not the same thing.
 */
export type LedgerDepositRead = {
  nativeIdentityAvailable: boolean;
  read: SourceRead<LedgerDepositRow>;
};

/** What the evidence routes need from the deployment to build an internal side. */
export type InternalLedgerReader = {
  /** Chain, contract and indexer key this deployment reconciles against. */
  scope: () => { chainId: number; contract: string; indexerKey: string };
  checkpoint: () => Promise<ChainScope["checkpoint"]>;
  depositEvents: (fromBlock: number, toBlock: number) => Promise<SourceRead<DepositEventRow>>;
  ledgerDeposits: () => Promise<LedgerDepositRead>;
};

/**
 * Hex of an exact byte length, or of any length when none is given.
 *
 * The `0x` prefix is matched case-insensitively: an address that arrived through
 * an upper-cased string is still that address, and refusing it would drop a
 * deposit over a keystroke.
 */
export const isHex = (value: unknown, bytes?: number): value is string =>
  typeof value === "string" &&
  new RegExp(`^0[xX][0-9a-fA-F]{${bytes ? bytes * 2 : "1,"}}$`).test(value.trim());

/**
 * USDC minor units, exactly as recorded, or the reason they cannot be read.
 *
 * Decimal text is the only lossless form: `Number` stops being exact at
 * 9.007.199.254.740.991 minor units, which is a real amount long before it is a
 * large one. A value that arrives as a number is accepted only while it is still
 * provably a whole safe integer, and is never rescaled by magnitude - 500000 is
 * 0,5 USDC and 1500000 is 1,5 USDC, and neither is a hint about which unit the
 * writer meant.
 */
export function readMinorUnits(raw: unknown): { amount: bigint } | { error: string } {
  if (typeof raw === "bigint") {
    return raw < 0n ? { error: "Jumlah USDC negatif." } : { amount: raw };
  }
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) {
      return {
        error:
          `Jumlah USDC ${raw} bukan bilangan bulat aman dalam JSON, sehingga presisinya tidak dapat ` +
          `dipastikan. Simpan satuan minor USDC sebagai teks angka desimal.`,
      };
    }
    if (raw < 0) return { error: "Jumlah USDC negatif." };
    return { amount: BigInt(raw) };
  }
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(value)) {
    return {
      error:
        `Jumlah USDC harus berupa satuan minor (6 desimal) sebagai bilangan bulat desimal. ` +
        `Diterima: ${JSON.stringify(raw)}. Nilai tidak ditebak dari besar angkanya.`,
    };
  }
  return { amount: BigInt(value) };
}

/**
 * One deposit's **reconciliation key**: chain, contract, transaction, log.
 *
 * The log index is part of it, so two deposits in the same transaction are two
 * rows on both sides rather than one row that quietly wins.
 *
 * Distinct from `depositTrxId` in `usdc-deposit-intake`, which names the ledger
 * *row* from the same four facts. This one is what the engine matches on and
 * what a reader sees in a finding, so it stays readable as an identity.
 */
export const depositKeyOf = (identity: {
  chainId: number;
  contract: string;
  txHash: string;
  logIndex: number;
}): string =>
  `eip155:${identity.chainId}/${identity.contract.toLowerCase()}/` +
  `${identity.txHash.toLowerCase()}#${identity.logIndex}`;

const sameAddress = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

export type MappedRows = {
  rows: NormalizedRow[];
  unverified: UnverifiedRecord[];
};

const depositRow = (key: string, amount: bigint, origin: RowOrigin, label: string): NormalizedRow => ({
  key,
  bucket: USDC_DEPOSIT_BUCKET,
  balanceSheet: "ON",
  amount: amount.toString(),
  unit: "USDC_6DP",
  amilAmount: null,
  label,
  isDeclaredTotal: false,
  origin,
});

const parseArgs = (event: DepositEventRow): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(event.argsJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * The chain side: indexed `USDCDeposited` events for the scoped contract.
 *
 * Events outside the scoped contract are not this population and are skipped
 * silently. Events *inside* it that cannot be read - unparseable args, a missing
 * amount, an amount whose precision cannot be vouched for - are never skipped:
 * they become unverified records, because a deposit this module could not read
 * is a gap in coverage, not an absence of deposits.
 */
export function mapDepositEvents(
  events: readonly DepositEventRow[],
  scope: Pick<ChainScope, "chainId" | "contract">
): MappedRows & { observed: ChainScope["observed"] } {
  const rows: NormalizedRow[] = [];
  const unverified: UnverifiedRecord[] = [];
  const blocks: number[] = [];

  for (const event of events) {
    if (event.eventName !== USDC_DEPOSIT_EVENT) continue;
    if (!sameAddress(event.contractAddress ?? "", scope.contract)) continue;

    const logIndex = Number(event.logIndex ?? 0);
    const reference = `${String(event.txHash ?? "").toLowerCase()}#${logIndex}`;
    const flag = (reason: string) =>
      unverified.push({ side: "SOURCE", reference, reason });

    if (!isHex(event.txHash) || !Number.isInteger(logIndex) || logIndex < 0) {
      flag(
        "Event terindeks tidak memiliki transaction hash atau log index yang sah, sehingga " +
          "identitas depositnya tidak dapat dibentuk."
      );
      continue;
    }

    const args = parseArgs(event);
    if (!args) {
      flag("Argumen event terindeks tidak dapat dibaca sebagai JSON objek.");
      continue;
    }

    const read = readMinorUnits(args.amountUSDC);
    if ("error" in read) {
      flag(read.error);
      continue;
    }

    const blockNumber = Number(event.blockNumber);
    if (!Number.isInteger(blockNumber) || blockNumber < 0) {
      flag("Event terindeks tidak menyebut nomor blok yang sah.");
      continue;
    }
    blocks.push(blockNumber);

    const identity = {
      chainId: scope.chainId,
      contract: scope.contract,
      txHash: event.txHash,
      logIndex,
    };
    rows.push(
      depositRow(
        depositKeyOf(identity),
        read.amount,
        {
          chainId: scope.chainId,
          contract: scope.contract.toLowerCase(),
          txHash: event.txHash.toLowerCase(),
          logIndex,
          blockNumber,
          blockHash: isHex(event.blockHash, 32) ? event.blockHash!.toLowerCase() : null,
        },
        `${USDC_DEPOSIT_EVENT} blok ${blockNumber}`
      )
    );
  }

  return {
    rows,
    unverified,
    observed:
      blocks.length === 0
        ? null
        : {
            firstBlock: Math.min(...blocks),
            lastBlock: Math.max(...blocks),
            eventCount: rows.length,
          },
  };
}

/**
 * The ledger side: internal USDC donation rows that carry a provable pair.
 *
 * A row qualifies only when it names the chain, contract, transaction and log it
 * came from *and* holds the native amount. Anything else is unverified with the
 * field that is missing - never repaired from `amountIDR`, an exchange rate, or
 * the row's own timestamp, none of which can prove which deposit a row is.
 */
export function mapLedgerDeposits(
  rows: readonly LedgerDepositRow[],
  scope: Pick<ChainScope, "chainId" | "contract">
): MappedRows {
  const mapped: NormalizedRow[] = [];
  const unverified: UnverifiedRecord[] = [];

  for (const row of rows) {
    const reference = row.trxId;
    const flag = (reason: string) => unverified.push({ side: "CLAIM", reference, reason });

    const txHash = typeof row.depositTxHash === "string" ? row.depositTxHash : "";
    const logIndex = Number(row.depositLogIndex ?? Number.NaN);
    if (!isHex(txHash) || !Number.isInteger(logIndex) || logIndex < 0) {
      flag(
        "Baris ledger tidak menyimpan transaction hash dan log index depositnya, sehingga tidak " +
          "dapat dipasangkan dengan event on-chain. Estimasi rupiah pada baris ini bukan pengganti " +
          "jumlah asli."
      );
      continue;
    }

    const chainId = Number(row.depositChainId ?? Number.NaN);
    const contract = typeof row.depositContract === "string" ? row.depositContract : "";
    if (chainId !== scope.chainId || !sameAddress(contract, scope.contract)) {
      flag(
        `Baris ledger menyebut chain atau kontrak lain (${JSON.stringify(row.depositChainId)}, ` +
          `${JSON.stringify(row.depositContract)}) daripada sumber yang diperiksa. Identitas deposit ` +
          `tidak dipindahkan antar kontrak.`
      );
      continue;
    }

    const read = readMinorUnits(row.amountUsdc);
    if ("error" in read) {
      flag(read.error);
      continue;
    }

    const identity = { chainId, contract, txHash, logIndex };
    mapped.push(
      depositRow(
        depositKeyOf(identity),
        read.amount,
        {
          chainId,
          contract: contract.toLowerCase(),
          txHash: txHash.toLowerCase(),
          logIndex,
          // The ledger row records which event it came from, not which block the
          // mirror saw it in. That is the chain side's fact, not this one's.
          blockNumber: null,
          blockHash: null,
        },
        row.trxId
      )
    );
  }

  return { rows: mapped, unverified };
}

/** Identity every internal manifest shares, so both sides agree by construction. */
export type InternalManifestBase = {
  institutionId: string;
  scopeUnit: string;
  scopeLevel: string;
  period: SourceManifest["period"];
  /** ISO 8601 instant the sources were cut at. */
  cutOff: string;
};

const manifestFor = (
  role: SourceRole,
  base: InternalManifestBase,
  chainScope: ChainScope,
  label: string,
  note: string | null
): SourceManifest => ({
  role,
  label,
  origin: "INTERNAL_LEDGER",
  institutionId: base.institutionId,
  scopeUnit: base.scopeUnit,
  scopeLevel: base.scopeLevel,
  fundTypes: [USDC_DEPOSIT_BUCKET],
  balanceSheet: "ON",
  currencyUnit: "USDC_6DP",
  period: base.period,
  cutOff: base.cutOff,
  format: "onchain-usdc-deposits",
  mappingVersion: USDC_DEPOSIT_MAPPING_VERSION,
  transactionDetail: "PRESENT",
  note,
  chainScope,
});

export const SOURCE_SIDE_LABEL = "Deposit USDC terindeks on-chain";
export const CLAIM_SIDE_LABEL = "Ledger internal deposit USDC";

/** The chain side, built from indexed events. */
export function usdcDepositSourceSide(
  base: InternalManifestBase,
  chainScope: ChainScope,
  events: SourceRead<DepositEventRow>
): SubmittedSide {
  const manifest = manifestFor(
    "SOURCE",
    base,
    chainScope,
    SOURCE_SIDE_LABEL,
    `Event ${USDC_DEPOSIT_EVENT} pada blok ${chainScope.fromBlock}-${chainScope.toBlock}.`
  );

  if (events.status !== "READ") {
    return { manifest, status: events.status, detail: events.detail };
  }

  const mapped = mapDepositEvents(events.rows, chainScope);
  return {
    manifest: { ...manifest, chainScope: { ...chainScope, observed: mapped.observed } },
    status: "READ",
    rows: mapped.rows,
    ...(mapped.unverified.length > 0 ? { unverified: mapped.unverified } : {}),
  };
}

/**
 * The ledger side, or the reason there is not one yet.
 *
 * Without #67's native amount and event identity the side is `MISSING`, and the
 * rows it would have covered travel with it as unverified records. That is a
 * deliberately louder outcome than an empty side: it says a real population
 * exists and has not been examined, rather than that nothing was deposited.
 */
export function usdcDepositClaimSide(
  base: InternalManifestBase,
  chainScope: ChainScope,
  ledger: LedgerDepositRead
): SubmittedSide {
  const manifest = manifestFor(
    "CLAIM",
    base,
    chainScope,
    CLAIM_SIDE_LABEL,
    "Baris donasi USDC pada cermin PostgreSQL."
  );

  if (ledger.read.status !== "READ") {
    return { manifest, status: ledger.read.status, detail: ledger.read.detail };
  }

  const mapped = mapLedgerDeposits(ledger.read.rows, chainScope);

  if (!ledger.nativeIdentityAvailable) {
    return {
      manifest,
      status: "MISSING",
      detail:
        `Ledger internal pada deployment ini belum menyimpan jumlah native USDC dan identitas ` +
        `event depositnya (#67), sehingga sisi klaim USDC belum didukung. ` +
        `${ledger.read.rows.length} baris donasi USDC dicatat sebagai belum terverifikasi dan ` +
        `tidak ditaksir dari estimasi rupiah.`,
      ...(mapped.unverified.length > 0 ? { unverified: mapped.unverified } : {}),
    };
  }

  return {
    manifest,
    status: "READ",
    rows: mapped.rows,
    ...(mapped.unverified.length > 0 ? { unverified: mapped.unverified } : {}),
  };
}

/**
 * What a reader has to be told about the limits of an internal deposit source.
 *
 * Every line is a bound on what the package proves, so it is produced next to
 * the mapping that creates the bound rather than written once in a UI.
 */
export function depositCoverageNotes(
  chainScope: ChainScope,
  sides: readonly SubmittedSide[]
): string[] {
  const notes: string[] = [
    `Sumber deposit USDC dibatasi pada kontrak ${chainScope.contract} di chain ` +
      `eip155:${chainScope.chainId}, blok ${chainScope.fromBlock}-${chainScope.toBlock}, ` +
      `terhadap checkpoint indexer "${chainScope.indexerKey}" pada blok ` +
      `${chainScope.checkpoint.lastIndexedBlock} (status ${chainScope.checkpoint.status}). ` +
      `Deposit setelah blok tersebut belum terperiksa.`,
  ];

  if (chainScope.blockHashes === "NOT_RETAINED") {
    notes.push(
      "Cermin event terindeks menyimpan nomor blok tanpa block hash, sehingga paket ini mengikat " +
        "nomor blok dan tidak mengklaim telah memverifikasi kanonisitas blok tersebut."
    );
  }

  for (const side of sides) {
    const unverified = side.unverified ?? [];
    if (unverified.length === 0) continue;
    notes.push(
      `${unverified.length} catatan pada sisi ${side.manifest.role === "CLAIM" ? "klaim" : "sumber"} ` +
        `berstatus belum terverifikasi dan tidak masuk perbandingan. Jumlahnya tidak diperkirakan ` +
        `dari kurs, estimasi rupiah, atau tanggal.`
    );
  }

  notes.push(
    "Deposit USDC yang diperiksa di sini bukan seluruh ledger internal: jenis dana, penyaluran, " +
      "dan arus rupiah berada di luar cakupan sumber ini."
  );

  return notes;
}
