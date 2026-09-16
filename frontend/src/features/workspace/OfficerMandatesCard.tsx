import { ShieldCheck, FileText, Calendar, Coins, AlertCircle } from "lucide-react";
import type { OperationalMandate } from "./workspaceClient";
import {
  OPERATIONAL_FUNCTION_LABELS,
  SCOPE_TYPE_LABELS,
  formatIdrAmount,
  formatTimestamp,
} from "./mandateLabels";

interface OfficerMandatesCardProps {
  mandates?: OperationalMandate[];
  officerName?: string;
}

export function OfficerMandatesCard({ mandates = [], officerName }: OfficerMandatesCardProps) {
  const activeMandates = mandates.filter((m) => m.isActive);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <ShieldCheck className="h-5 w-5 text-[#1b765e]" />
            Mandat Operasional Petugas
          </h3>
          <p className="mt-0.5 text-xs text-stone-500">
            Kewenangan operasional yang diberikan lembaga kepada {officerName ? `petugas ${officerName}` : "akun ini"}.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f8f3] px-3 py-1 text-xs font-semibold text-[#17332c] border border-[#1b765e]/30">
          {activeMandates.length} Mandat Aktif
        </span>
      </div>

      {activeMandates.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-stone-200 bg-stone-50 p-6 text-center">
          <FileText className="mx-auto h-8 w-8 text-stone-400" />
          <p className="mt-2 text-sm font-medium text-stone-700">Belum ada mandat operasional aktif</p>
          <p className="mt-1 text-xs text-stone-500">
            Administrator lembaga belum menerbitkan surat keputusan mandat operasional untuk akun petugas ini.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {activeMandates.map((mandate) => {
            const info = OPERATIONAL_FUNCTION_LABELS[mandate.function] ?? {
              label: mandate.function,
              description: "Fungsi operasional terdaftar.",
            };

            return (
              <div
                key={mandate.id}
                className="relative flex flex-col justify-between rounded-xl border border-stone-200 bg-gradient-to-br from-white to-stone-50/50 p-4 transition-all hover:border-[#1b765e]/40 hover:shadow-xs"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center rounded-md bg-[#1b765e]/10 px-2 py-0.5 text-xs font-semibold text-[#17332c]">
                      {info.label}
                    </span>
                    <span className="text-[11px] font-mono text-stone-400" title={mandate.id}>
                      {mandate.id.slice(0, 8)}…
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-stone-600 line-clamp-2">{info.description}</p>

                  <div className="mt-3 space-y-1.5 text-xs">
                    <div className="flex items-center gap-1.5 text-stone-600">
                      <FileText className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                      <span className="font-medium text-stone-800">SK: {mandate.assignmentRef}</span>
                    </div>

                    <div className="flex items-center gap-1.5 text-stone-600">
                      <Coins className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                      <span>{formatIdrAmount(mandate.nominalLimit)}</span>
                    </div>

                    <div className="flex items-center gap-1.5 text-stone-500 text-[11px]">
                      <Calendar className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                      <span>
                        {formatTimestamp(mandate.validFrom)} – {formatTimestamp(mandate.validUntil)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 border-t border-stone-100 pt-2 text-[11px] text-stone-500">
                  <span className="font-medium text-stone-700">Cakupan:</span>{" "}
                  {mandate.scopeType === "SPECIFIC_PROGRAM"
                    ? `Program (${mandate.programId})`
                    : SCOPE_TYPE_LABELS[mandate.scopeType]}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 flex items-start gap-2 rounded-xl bg-amber-50/70 p-3 text-xs text-amber-900 border border-amber-200">
        <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
        <p>
          <strong>Kewenangan Offchain:</strong> Mandat operasional ini hanya mengatur kewenangan alur kerja
          internal lembaga (pembuatan draf, pemeriksaan, pengesahan usulan) dan <em>tidak memberikan</em> peran
          smart contract onchain seperti Auditor atau Vault Governance.
        </p>
      </div>
    </div>
  );
}
