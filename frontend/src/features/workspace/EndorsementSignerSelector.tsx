import { useState } from "react";
import { Landmark, User, CheckCircle2, ChevronRight, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { InstitutionalEndorsementAccount, OfficerProfile } from "./workspaceClient";

interface EndorsementSignerSelectorProps {
  operatorAccount: string;
  officerProfile: OfficerProfile | null;
  endorsementAccounts?: InstitutionalEndorsementAccount[];
  selectedEndorsementAddress: string | null;
  onSelectEndorsement: (accountAddress: string | null) => void;
}

export function EndorsementSignerSelector({
  operatorAccount,
  officerProfile,
  endorsementAccounts = [],
  selectedEndorsementAddress,
  onSelectEndorsement,
}: EndorsementSignerSelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const activeAccounts = endorsementAccounts.filter((a) => a.isActive);
  const currentSelection = activeAccounts.find(
    (a) => a.accountAddress.toLowerCase() === selectedEndorsementAddress?.toLowerCase()
  );

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <Landmark className="h-5 w-5 text-[#1b765e]" />
            Konteks Akun Operasional & Penanda Tangan Lembaga
          </h3>
          <p className="mt-0.5 text-xs text-stone-500">
            Pemisahan tegas antara akun kerja pribadi operator dan akun pengesahan institusi.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Context 1: Personal Operator Account */}
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-850">
              <User className="h-3.5 w-3.5 text-emerald-700" />
              1. Akun Operator (Pribadi)
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              Sesi Aktif
            </span>
          </div>
          <div className="mt-2.5">
            <p className="text-sm font-semibold text-stone-900">
              {officerProfile?.displayName || "Petugas Belum Terhubung"}
            </p>
            <p className="mt-0.5 font-mono text-xs text-stone-600 break-all">{operatorAccount}</p>
            <p className="mt-2 text-[11px] text-emerald-900/80">
              Menentukan identitas penyusun atau pemeriksa. Identitas ini tetap tidak berubah saat memilih penanda tangan lembaga.
            </p>
          </div>
        </div>

        {/* Context 2: Institutional Endorsement Signer */}
        <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-700">
              <Landmark className="h-3.5 w-3.5 text-stone-600" />
              2. Akun Pengesahan Lembaga
            </span>
            {currentSelection ? (
              <span className="rounded-full bg-[#1b765e]/15 px-2 py-0.5 text-[10px] font-bold text-[#17332c]">
                Terpilih
              </span>
            ) : (
              <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-600">
                Belum Dipilih
              </span>
            )}
          </div>

          <div className="mt-2.5">
            {currentSelection ? (
              <div>
                <p className="text-sm font-semibold text-stone-900">{currentSelection.label}</p>
                <p className="mt-0.5 font-mono text-xs text-stone-600 break-all">
                  {currentSelection.accountAddress}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                  >
                    Ganti Akun
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => onSelectEndorsement(null)}
                  >
                    Lepas Konteks
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-stone-600">Tidak ada penanda tangan lembaga yang dipilih.</p>
                <p className="mt-1 text-[11px] text-stone-500">
                  Untuk tindakan pengesahan keputusan, pilih akun penanda tangan lembaga yang berwenang.
                </p>
                {activeAccounts.length > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 h-7 text-xs"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                  >
                    Pilih Penanda Tangan
                  </Button>
                ) : (
                  <p className="mt-2 text-xs text-amber-700 italic">
                    Belum ada akun pengesahan lembaga yang diotorisasi untuk profil petugas ini.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Account Selection Dropdown Modal/List */}
      {dropdownOpen && activeAccounts.length > 0 && (
        <div className="mt-4 rounded-xl border border-stone-300 bg-white p-4 shadow-md animate-in fade-in">
          <div className="flex items-center justify-between pb-2 border-b border-stone-100">
            <h4 className="text-xs font-semibold text-stone-900">
              Pilih Akun Penanda Tangan Lembaga yang Diotorisasi
            </h4>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setDropdownOpen(false)}
            >
              Tutup
            </Button>
          </div>

          <div className="mt-2 space-y-2">
            {activeAccounts.map((account) => {
              const isSelected =
                currentSelection?.accountAddress.toLowerCase() === account.accountAddress.toLowerCase();

              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => {
                    onSelectEndorsement(account.accountAddress);
                    setDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? "border-[#1b765e] bg-[#f4f8f3]"
                      : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
                  }`}
                >
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-stone-900">{account.label}</span>
                      {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-[#1b765e]" />}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-stone-600 truncate">
                      {account.accountAddress}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-stone-400 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-stone-50 p-2.5 text-[11px] text-stone-600">
        <RefreshCw className="h-3.5 w-3.5 text-stone-400 shrink-0" />
        <span>
          Memilih akun pengesahan lembaga <strong>tidak mengubah</strong> sesi login, hak akses operator,
          maupun ruang kerja lembaga. Logout atau pergantian wallet pribadi akan membersihkan konteks pengesahan ini.
        </span>
      </div>
    </div>
  );
}
