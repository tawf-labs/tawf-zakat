/**
 * Operational mandates and institutional endorsement accounts (Spec #86, ticket #90).
 *
 * A pure module: no database, no network, no clock.
 *
 * Operational functions are distinct from the general workspace roles
 * (ADMIN/OFFICER/READER). An ADMIN manages members, profiles, and mandates,
 * but does not automatically hold operational authority (e.g. approving
 * disbursements or managing programs). Operational mandates explicitly bind:
 * - officerId (stable officer identity across multiple work accounts)
 * - operational function
 * - program scope (ALL_PROGRAMS or SPECIFIC_PROGRAM)
 * - validity window (validFrom, validUntil)
 * - assignment reference (SK / Surat Tugas)
 * - optional nominal limit (e.g. maximum IDR amount)
 *
 * Institutional endorsement accounts represent the institution's signing context
 * and are strictly separated from the personal work account (operator).
 */

export const OPERATIONAL_FUNCTIONS = [
  "MANAGE_PROGRAMS",
  "PREPARE_PROPOSALS",
  "EXAMINE_PROPOSALS",
  "APPROVE_DECISIONS",
  "RECORD_REALIZATION",
  "HANDLE_REPORT_EXAMINATION",
] as const;

export type OperationalFunction = (typeof OPERATIONAL_FUNCTIONS)[number];

export const isOperationalFunction = (value: unknown): value is OperationalFunction =>
  typeof value === "string" && (OPERATIONAL_FUNCTIONS as readonly string[]).includes(value);

export const OPERATIONAL_FUNCTION_LABELS: Record<OperationalFunction, string> = {
  MANAGE_PROGRAMS: "Mengelola program bantuan",
  PREPARE_PROPOSALS: "Menyiapkan pengajuan penyaluran",
  EXAMINE_PROPOSALS: "Memeriksa kelayakan pengajuan",
  APPROVE_DECISIONS: "Mengesahkan keputusan penyaluran",
  RECORD_REALIZATION: "Mencatat realisasi penyaluran",
  HANDLE_REPORT_EXAMINATION: "Menangani pemeriksaan laporan",
};

export type MandateScopeType = "ALL_PROGRAMS" | "SPECIFIC_PROGRAM";

export type OperationalMandate = {
  id: string;
  institutionId: string;
  officerId: string;
  accountAddress: string | null;
  function: OperationalFunction;
  scopeType: MandateScopeType;
  programId: string | null;
  validFrom: number;
  validUntil: number;
  assignmentRef: string;
  nominalLimit: string | null; // Minor unit / integer string or null for unlimited
  version: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

export type InstitutionalEndorsementAccount = {
  id: string;
  institutionId: string;
  accountAddress: string;
  label: string;
  authorizedOfficerIds: string[];
  version: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

export type MandateInput = {
  officerId: string;
  accountAddress?: string | null;
  function: OperationalFunction;
  scopeType: MandateScopeType;
  programId?: string | null;
  validFrom: number;
  validUntil: number;
  assignmentRef: string;
  nominalLimit?: string | null;
};

export type EndorsementAccountInput = {
  accountAddress: string;
  label: string;
  authorizedOfficerIds?: string[];
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function validateMandateInput(input: unknown): { ok: true; value: MandateInput } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Data mandat bukan objek yang sah." };
  }
  const raw = input as Record<string, unknown>;

  const officerId = typeof raw.officerId === "string" ? raw.officerId.trim() : "";
  if (!officerId) {
    return { ok: false, error: "Petugas penerima mandat wajib ditentukan." };
  }

  const fn = raw.function ?? raw.operationalFunction;
  if (!isOperationalFunction(fn)) {
    return { ok: false, error: `Fungsi operasional tidak dikenal: ${String(fn)}.` };
  }

  const scopeType = raw.scopeType;
  if (scopeType !== "ALL_PROGRAMS" && scopeType !== "SPECIFIC_PROGRAM") {
    return { ok: false, error: "Cakupan mandat harus 'ALL_PROGRAMS' atau 'SPECIFIC_PROGRAM'." };
  }

  let programId: string | null = null;
  if (scopeType === "SPECIFIC_PROGRAM") {
    programId = typeof raw.programId === "string" ? raw.programId.trim() : "";
    if (!programId) {
      return { ok: false, error: "Cakupan program khusus mewajibkan pemilihan program." };
    }
  }

  const validFrom =
    raw.validFrom !== undefined && raw.validFrom !== null
      ? typeof raw.validFrom === "number" ? Math.floor(raw.validFrom) : NaN
      : 0;
  const validUntil =
    raw.validUntil !== undefined && raw.validUntil !== null
      ? typeof raw.validUntil === "number" ? Math.floor(raw.validUntil) : NaN
      : 2147483647;

  if (!Number.isSafeInteger(validFrom) || !Number.isSafeInteger(validUntil)) {
    return { ok: false, error: "Masa berlaku mandat (validFrom dan validUntil) harus berupa angka detik yang sah." };
  }
  if (validUntil <= validFrom) {
    return { ok: false, error: "Batas akhir masa berlaku mandat harus lebih besar dari batas awal." };
  }

  const assignmentRef = typeof raw.assignmentRef === "string" ? raw.assignmentRef.trim() : "";
  if (!assignmentRef) {
    return { ok: false, error: "Rujukan penugasan (SK/Surat Tugas) wajib diisi." };
  }

  let nominalLimit: string | null = null;
  if (raw.nominalLimit !== undefined && raw.nominalLimit !== null && raw.nominalLimit !== "") {
    const limStr = String(raw.nominalLimit).trim();
    if (!/^\d+$/.test(limStr)) {
      return { ok: false, error: "Batas nominal mandat harus berupa angka positif dalam satuan rupiah." };
    }
    nominalLimit = limStr;
  }

  let accountAddress: string | null = null;
  if (raw.accountAddress && typeof raw.accountAddress === "string" && raw.accountAddress.trim() !== "") {
    const acc = raw.accountAddress.trim();
    if (!ADDRESS_PATTERN.test(acc)) {
      return { ok: false, error: "Alamat akun tertaut pada mandat tidak sah." };
    }
    accountAddress = acc.toLowerCase();
  }

  return {
    ok: true,
    value: {
      officerId,
      accountAddress,
      function: fn,
      scopeType,
      programId,
      validFrom,
      validUntil,
      assignmentRef,
      nominalLimit,
    },
  };
}

export function validateEndorsementAccountInput(
  input: unknown
): { ok: true; value: EndorsementAccountInput } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Data akun pengesahan bukan objek yang sah." };
  }
  const raw = input as Record<string, unknown>;

  const accountAddress = typeof raw.accountAddress === "string" ? raw.accountAddress.trim() : "";
  if (!ADDRESS_PATTERN.test(accountAddress)) {
    return { ok: false, error: "Alamat akun pengesahan institusi tidak sah." };
  }

  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label) {
    return { ok: false, error: "Label akun pengesahan tidak boleh kosong." };
  }

  const authorizedOfficerIds = Array.isArray(raw.authorizedOfficerIds)
    ? (raw.authorizedOfficerIds.filter((id) => typeof id === "string" && id.trim() !== "") as string[])
    : [];

  return {
    ok: true,
    value: {
      accountAddress: accountAddress.toLowerCase(),
      label,
      authorizedOfficerIds,
    },
  };
}

export type MandateCheckResult =
  | { allowed: true; mandate: OperationalMandate }
  | {
      allowed: false;
      reason: string;
      code:
        | "NO_ACTIVE_MANDATE"
        | "MANDATE_EXPIRED"
        | "MANDATE_NOT_YET_VALID"
        | "SCOPE_MISMATCH"
        | "NOMINAL_LIMIT_EXCEEDED"
        | "ACCOUNT_MISMATCH";
    };

export function checkOperationalMandate(
  mandates: OperationalMandate[],
  options: {
    fn: OperationalFunction;
    programId?: string | null;
    nominalAmount?: string | bigint | null;
    now: number;
    account?: string;
  }
): MandateCheckResult {
  const matchingFn = mandates.filter((m) => m.function === options.fn && m.isActive);
  if (matchingFn.length === 0) {
    const label = OPERATIONAL_FUNCTION_LABELS[options.fn] || options.fn;
    return {
      allowed: false,
      code: "NO_ACTIVE_MANDATE",
      reason: `Petugas tidak memiliki mandat operasional aktif untuk: ${label}. Hubungi administrator lembaga.`,
    };
  }

  let lastFailure: MandateCheckResult | null = null;

  for (const m of matchingFn) {
    // Check account restriction
    if (m.accountAddress && options.account) {
      if (m.accountAddress.toLowerCase() !== options.account.toLowerCase()) {
        lastFailure = {
          allowed: false,
          code: "ACCOUNT_MISMATCH",
          reason: `Mandat ${m.assignmentRef} hanya berlaku untuk akun kerja ${m.accountAddress}.`,
        };
        continue;
      }
    }

    // Check validity window
    if (options.now < m.validFrom) {
      lastFailure = {
        allowed: false,
        code: "MANDATE_NOT_YET_VALID",
        reason: `Mandat ${m.assignmentRef} belum mulai berlaku (berlaku mulai ${new Date(m.validFrom * 1000).toISOString()}).`,
      };
      continue;
    }
    if (options.now > m.validUntil) {
      lastFailure = {
        allowed: false,
        code: "MANDATE_EXPIRED",
        reason: `Mandat ${m.assignmentRef} telah berakhir pada ${new Date(m.validUntil * 1000).toISOString()}.`,
      };
      continue;
    }

    // Check scope
    if (m.scopeType === "SPECIFIC_PROGRAM") {
      if (!options.programId || options.programId !== m.programId) {
        lastFailure = {
          allowed: false,
          code: "SCOPE_MISMATCH",
          reason: `Mandat ${m.assignmentRef} hanya berlaku untuk program spesifik (${m.programId}).`,
        };
        continue;
      }
    }

    // Check nominal limit
    if (m.nominalLimit !== null && options.nominalAmount !== undefined && options.nominalAmount !== null) {
      const requested = BigInt(options.nominalAmount);
      const limit = BigInt(m.nominalLimit);
      if (requested > limit) {
        lastFailure = {
          allowed: false,
          code: "NOMINAL_LIMIT_EXCEEDED",
          reason: `Nilai pengajuan (${requested.toLocaleString("id-ID")}) melampaui batas nominal mandat ${m.assignmentRef} (maksimal Rp ${limit.toLocaleString("id-ID")}).`,
        };
        continue;
      }
    }

    return { allowed: true, mandate: m };
  }

  return (
    lastFailure ?? {
      allowed: false,
      code: "NO_ACTIVE_MANDATE",
      reason: `Tidak ada mandat ${OPERATIONAL_FUNCTION_LABELS[options.fn]} yang memenuhi kriteria pengajuan ini.`,
    }
  );
}

/**
 * Enforces separation of duties (Scenario 10, US-31, US-33):
 * A proposal creator cannot approve their own proposal, even if using
 * a secondary work account or institutional endorsement wallet.
 */
export function assertCanApproveProposal(input: {
  creatorOfficerId: string | null;
  creatorAccount: string;
  approverOfficerId: string | null;
  approverAccount: string;
}): { allowed: true } | { allowed: false; reason: string } {
  if (
    input.creatorOfficerId &&
    input.approverOfficerId &&
    input.creatorOfficerId === input.approverOfficerId
  ) {
    return {
      allowed: false,
      reason: "Penyusun pengajuan tidak boleh mengesahkan keputusannya sendiri, meskipun menggunakan akun kerja berbeda.",
    };
  }
  if (input.creatorAccount.toLowerCase() === input.approverAccount.toLowerCase()) {
    return {
      allowed: false,
      reason: "Penyusun pengajuan tidak boleh mengesahkan keputusannya sendiri.",
    };
  }
  return { allowed: true };
}
