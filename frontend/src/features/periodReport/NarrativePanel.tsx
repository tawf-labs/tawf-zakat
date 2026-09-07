import { CloudOff, PenLine } from "lucide-react";

interface NarrativePanelProps {
  narrative: string | null;
  unavailable: string | null;
  /** False before anyone has asked for a draft - which is not an outage. */
  requested: boolean;
  rejected: boolean;
}

/**
 * The narrative a human reads before signing - and, when there is none, why.
 *
 * An absent narrative is stated in the open rather than shown as an empty
 * report: the figures above it were computed from the ledger and stand on their
 * own whether or not the drafting service answered.
 */
export function NarrativePanel({
  narrative,
  unavailable,
  requested,
  rejected,
}: NarrativePanelProps) {
  if (!narrative && !requested) {
    return (
      <div className="rounded-2xl border border-[#dbe7dd] bg-[#f9fbf9] p-5 md:p-6">
        <div className="flex items-start gap-3">
          <PenLine className="mt-0.5 h-5 w-5 shrink-0 text-[#1b765e]" />
          <p className="text-sm leading-relaxed text-[#3d5b52]">
            Angka di atas dihitung dari ledger. Tekan <strong>Susunkan narasinya</strong> bila Anda
            ingin narasinya disusunkan, lalu diperiksa validator.
          </p>
        </div>
      </div>
    );
  }

  if (!narrative) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 md:p-6">
        <div className="flex items-start gap-3">
          <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <h3 className="font-serif text-lg font-bold text-amber-900">Narasi belum tersedia</h3>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-amber-800">
              {unavailable ??
                "Belum ada draf narasi untuk periode ini. Angka di atas tetap dihitung dari ledger."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#dbe7dd] bg-white p-5 shadow-xs md:p-6">
      <div className="flex items-center gap-2.5">
        <PenLine className="h-5 w-5 text-[#1b765e]" />
        <h3 className="font-serif text-lg font-bold text-[#17332c]">Narasi Laporan</h3>
      </div>
      <p className="mt-1 text-xs text-[#5e7a70]">
        {rejected
          ? "Draf ini ditolak validator dan ditampilkan apa adanya, supaya Anda bisa melihat apa yang ditolak dan mengapa. Draf ini tidak dapat ditandatangani."
          : "Disusun mesin dari angka di atas, lalu diperiksa validator. Tetap bacalah sendiri sebelum menandatangani - validator memeriksa angka, bukan kata sifat."}
      </p>
      <div className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-[#17332c]">
        {narrative}
      </div>
    </div>
  );
}
