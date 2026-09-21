/** Service-funded pilot liability only; never a debit to contributions or donor balances. */
export type CertificateBudgetConfig = { maxWei: string; gasLimit: string; maxFeePerGas: string };
export type CertificateBudgetPolicy = { scope: string; maxWei: string; reservationWei: string };

export class CertificateBudgetError extends Error {
  constructor(message = "Anggaran layanan penerbitan sertifikat tidak mencukupi.") {
    super(message);
    this.name = "CertificateBudgetError";
  }
}

const UINT256_MAX = (1n << 256n) - 1n;
export function positiveBudgetWei(value: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,77}$/.test(value) || BigInt(value) > UINT256_MAX) {
    throw new CertificateBudgetError("Konfigurasi anggaran sertifikat harus berupa bilangan desimal positif uint256.");
  }
  return BigInt(value);
}

export function certificateBudget(config: CertificateBudgetConfig, chainId: number, relayer: string): CertificateBudgetPolicy {
  if (!config) throw new CertificateBudgetError("Konfigurasi anggaran sertifikat wajib diisi.");
  positiveBudgetWei(config.maxWei);
  const reservationWei = positiveBudgetWei(config.gasLimit) * positiveBudgetWei(config.maxFeePerGas);
  positiveBudgetWei(reservationWei.toString());
  return { scope: `${chainId}:${relayer.toLowerCase()}`, maxWei: config.maxWei, reservationWei: reservationWei.toString() };
}
