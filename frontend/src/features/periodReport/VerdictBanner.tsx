import { CheckCircle2, Download, XOctagon } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { verdictHeadline } from "./verdictText";
import { FindingList } from "./FindingList";
import type { WireVerdict } from "./types";

interface VerdictBannerProps {
  verdict: WireVerdict;
  signable: boolean;
  onDownload: () => void;
}

/**
 * The verdict, made impossible to miss.
 *
 * A rejected draft shows no signing control at all - not a disabled one, not a
 * dismissible warning. There is no "lanjutkan saja": if the numbers do not
 * match, the way to a signature is simply not on the page.
 */
export function VerdictBanner({ verdict, signable, onDownload }: VerdictBannerProps) {
  const passed = verdict.outcome === "LOLOS";

  return (
    <section
      aria-live="polite"
      className={
        passed
          ? "rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6 md:p-8"
          : "rounded-2xl border-2 border-red-300 bg-red-50 p-6 md:p-8"
      }
    >
      <div className="flex items-start gap-4">
        {passed ? (
          <CheckCircle2 className="mt-0.5 h-9 w-9 shrink-0 text-emerald-600" />
        ) : (
          <XOctagon className="mt-0.5 h-9 w-9 shrink-0 text-red-600" />
        )}

        <div className="min-w-0 flex-1">
          <h2
            className={
              passed
                ? "font-serif text-2xl font-bold text-emerald-900"
                : "font-serif text-2xl font-bold text-red-900"
            }
          >
            {verdictHeadline(verdict)}
          </h2>

          <p
            className={
              passed
                ? "mt-2 max-w-3xl text-sm leading-relaxed text-emerald-800"
                : "mt-2 max-w-3xl text-sm leading-relaxed text-red-800"
            }
          >
            {passed
              ? "Validator mencocokkan setiap angka yang diklaim dengan hitungan dari ledger, dan memeriksa bahwa tidak ada angka rupiah di dalam narasi yang tidak diklaim. Bacalah narasinya sebelum menandatangani: validator memeriksa angka, bukan kata sifat."
              : "Draf ini tidak dapat ditandatangani. Perbaiki angka yang disebut di bawah, lalu susun ulang narasinya."}
          </p>

          {passed && signable && (
            <Button className="mt-5" onClick={onDownload}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Unduh laporan
            </Button>
          )}

          {!passed && <FindingList findings={verdict.findings} />}
        </div>
      </div>
    </section>
  );
}
