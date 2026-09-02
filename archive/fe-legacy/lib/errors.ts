export function handleTransactionError(error: unknown): string {
  if (error instanceof Error) {
    // Common blockchain error patterns
    if (error.message.includes("user rejected")) {
      return "Transaksi ditolak oleh pengguna";
    }
    if (error.message.includes("insufficient funds")) {
      return "Saldo tidak mencukupi";
    }
    if (error.message.includes("network")) {
      return "Error jaringan. Silakan coba lagi";
    }
    return error.message;
  }
  return "Terjadi kesalahan pada transaksi";
}

export function handleWalletError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("no provider")) {
      return "Wallet tidak terdeteksi. Silakan instal wallet terlebih dahulu";
    }
    if (error.message.includes("already pending")) {
      return "Transaksi sedang diproses";
    }
    if (error.message.includes("user rejected")) {
      return "Koneksi ditolak oleh pengguna";
    }
    return error.message;
  }
  return "Terjadi kesalahan pada wallet";
}
