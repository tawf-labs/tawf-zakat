export function canonicalJson(value: unknown): string {
  if (value === null) return "null";

  if (typeof value === "undefined") {
    throw new Error(
      "Snapshot tidak boleh memuat undefined: sebuah field yang hilang harus ditulis sebagai null, " +
        "agar kanonikalisasinya tidak bergantung pada urutan penulisan."
    );
  }
  if (typeof value === "bigint") {
    throw new Error("Snapshot menyimpan jumlah sebagai teks angka desimal, bukan bigint mentah.");
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `Snapshot hanya menerima bilangan bulat aman; ${value} bukan salah satunya. ` +
          `Jumlah uang ditulis sebagai teks angka desimal, tidak pernah sebagai floating point.`
      );
    }
    return String(value);
  }
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);

  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }

  throw new Error(`Snapshot tidak dapat menyimpan nilai bertipe ${typeof value}.`);
}
