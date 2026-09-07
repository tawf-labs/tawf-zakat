import React from "react";

/** The one-line format contract, spelled out where the Amil is typing. */
export function LedgerFormatHelp() {
  return (
    <div className="rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3] px-5 py-4 text-xs leading-relaxed text-[#5e7a70]">
      <strong className="text-[#17332c]">Format satu baris:</strong> kode PZ; nama PZ; jenis dana;
      posisi neraca; jumlah pengumpulan; hak amil (opsional). Pemisah boleh titik koma, koma, atau tab. Kolom posisi neraca boleh
      dikosongkan (dianggap <em>on balance sheet</em>). Baris yang diawali{" "}
      <code className="rounded bg-white px-1 py-0.5">TOTAL</code> atau{" "}
      <code className="rounded bg-white px-1 py-0.5">GRAND TOTAL</code> diperlakukan sebagai total
      yang dideklarasikan, sehingga penjumlahan di dalam rekap Anda sendiri ikut diperiksa - dan
      grand total kedua laporan dibandingkan langsung satu sama lain.
    </div>
  );
}
