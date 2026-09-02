/**
 * Syariah Contract Error Decoder & Human-Readable Translator (ADR-0008)
 * Translates EVM reverts and Viem execution errors into clear, empathetic Indonesian.
 */

export const SYARIAH_ERROR_DICTIONARY: Record<string, string> = {
  // Smart Contract Custom Errors (ZakatProtocolL1.sol)
  DoubleClaimDetected:
    "Mustahik ini sudah tercatat menerima hak zakat pada periode berjalan (Pencegahan Double-Claim Aktif).",
  InsufficientVaultBalance:
    "Saldo kas mustahik tidak mencukupi untuk nominal pengeluaran ini.",
  InsufficientAmilTreasury:
    "Saldo hak operasional amil tidak mencukupi untuk penarikan ini.",
  QuorumNotMet:
    "Penyaluran memerlukan minimal 2 persetujuan resmi dari Dewan Pengawas Syariah (DPS) & Auditor.",
  ProposalNotFound:
    "Data proposal penyaluran tidak ditemukan di smart contract Sepolia.",
  ProposalNotPending:
    "Status proposal sudah tidak lagi dalam tahap pending verifikasi.",
  AlreadyApproved:
    "Dompet Anda sudah pernah memberikan persetujuan untuk proposal ini.",
  AlreadyExecuted:
    "Proposal ini sudah selesai dieksekusi dan dana telah disalurkan.",
  Unauthorized:
    "Alamat dompet Anda tidak memiliki izin role yang sesuai untuk aksi ini.",
  BatchAlreadySettled:
    "Batch settlement fiat ini sudah pernah tercatat on-chain sebelumnya.",
  InvalidMerkleRoot:
    "Merkle root batch donasi tidak valid atau kosong.",
  ZeroAmount:
    "Nominal transaksi tidak boleh 0.",
  InvalidAddress:
    "Alamat dompet Ethereum tidak valid atau merupakan zero address (0x0).",
  InvalidCurrencyType:
    "Tipe mata uang tidak valid (hanya mendukung 0: IDR dan 1: USDC).",

  // Wallet & Client Rejections
  UserRejectedRequestError:
    "Transaksi dibatalkan di dompet oleh pengguna.",
  TransactionExecutionError:
    "Gagal mengeksekusi transaksi pada jaringan Ethereum Sepolia.",
  EstimateGasExecutionError:
    "Simulasi transaksi gagal di Sepolia. Pastikan akun Anda memiliki saldo gas fee Sepolia ETH dan hak akses yang benar.",
  ContractFunctionRevertedError:
    "Kontrak menolak transaksi karena kondisi syariah tidak terpenuhi.",
  TimeoutError:
    "Koneksi RPC Sepolia melebihi batas waktu (timeout). Silakan periksa koneksi internet Anda dan coba lagi.",
};

export function decodeContractError(error: unknown): string {
  if (!error) {
    return "Terjadi kesalahan yang tidak diketahui.";
  }

  // If already a string
  if (typeof error === "string") {
    for (const [key, msg] of Object.entries(SYARIAH_ERROR_DICTIONARY)) {
      if (error.includes(key)) return msg;
    }
    return error;
  }

  const errObj = error as Record<string, any>;
  const rawMessage =
    errObj.shortMessage ||
    errObj.message ||
    errObj.details ||
    errObj.reason ||
    "";

  // 1. Check direct error name
  if (errObj.name && SYARIAH_ERROR_DICTIONARY[errObj.name]) {
    return SYARIAH_ERROR_DICTIONARY[errObj.name];
  }

  // 2. Check inner custom error name (Viem / Wagmi ContractFunctionRevertedError)
  if (errObj.data?.errorName && SYARIAH_ERROR_DICTIONARY[errObj.data.errorName]) {
    return SYARIAH_ERROR_DICTIONARY[errObj.data.errorName];
  }

  // 3. Scan known keys inside the error message string
  for (const [key, msg] of Object.entries(SYARIAH_ERROR_DICTIONARY)) {
    if (rawMessage.includes(key)) {
      return msg;
    }
  }

  // 4. Handle specific user rejection patterns
  if (
    rawMessage.includes("User rejected") ||
    rawMessage.includes("rejected the request") ||
    rawMessage.includes("ACTION_REJECTED")
  ) {
    return SYARIAH_ERROR_DICTIONARY.UserRejectedRequestError;
  }

  // 5. Handle insufficient gas / funds
  if (rawMessage.includes("insufficient funds") || rawMessage.includes("exceeds balance")) {
    return "Saldo Sepolia ETH di dompet Anda tidak mencukupi untuk membayar biaya gas jaringan.";
  }

  // 6. Clean up raw message if sensible
  if (rawMessage.length > 0 && rawMessage.length < 200) {
    // Strip technical prefixes if present
    const cleaned = rawMessage.replace(/Details:.*$/gs, "").trim();
    return cleaned || rawMessage;
  }

  return "Terjadi kesalahan transaksi pada jaringan Sepolia. Silakan coba kembali.";
}
