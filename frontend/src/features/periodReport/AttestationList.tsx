import { Stamp } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { coverageCounts, formatAuditDate } from "./figures";
import type { WirePeriodFigures } from "./types";

/**
 * What the Independent Auditor has signed off inside this period - and, beside
 * it, what they have not yet reached. A list of what was checked, shown without
 * the count of what was not, flatters the report.
 */
export function AttestationList({ figures }: { figures: WirePeriodFigures }) {
  const attestations = figures.attestations;
  const coverage = coverageCounts(figures);

  return (
    <div className="rounded-2xl border border-[#dbe7dd] bg-white p-5 shadow-xs md:p-6">
      <div className="flex items-center gap-2.5">
        <Stamp className="h-5 w-5 text-[#1b765e]" />
        <h3 className="font-serif text-lg font-bold text-[#17332c]">Atestasi Auditor</h3>
      </div>

      {coverage.unattested !== null && (
        <p
          className={
            coverage.unattested > 0
              ? "mt-2 text-sm font-semibold text-amber-800"
              : "mt-2 text-sm text-[#3d5b52]"
          }
        >
          {coverage.unattested > 0
            ? `${coverage.unattested} penyaluran pada periode ini belum diatestasi auditor.`
            : "Seluruh penyaluran pada periode ini sudah diatestasi auditor."}
        </p>
      )}

      {coverage.undatedRows !== null && coverage.undatedRows > 0 && (
        <p className="mt-1.5 text-xs text-[#5e7a70]">
          {coverage.undatedRows} baris tanpa tanggal yang dapat dibaca dikeluarkan dari periode ini,
          bukan dihitung di setiap periode.
        </p>
      )}

      {attestations.length === 0 ? (
        <p className="mt-2 text-sm text-[#5e7a70]">
          Belum ada atestasi auditor yang terbit pada periode ini.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[#eef4ef]">
          {attestations.map((attestation) => (
            <li key={attestation.proposalId} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
              <span className="font-mono text-sm text-[#17332c]">
                Penyaluran #{attestation.proposalId}
              </span>
              <span className="text-sm text-[#3d5b52]">
                {attestation.auditorName ?? "Auditor tidak dinamai"}
              </span>
              {attestation.opinion && <Badge variant="success">{attestation.opinion}</Badge>}
              {formatAuditDate(attestation.auditedAt) && (
                <span className="text-xs text-[#5e7a70]">
                  {formatAuditDate(attestation.auditedAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
