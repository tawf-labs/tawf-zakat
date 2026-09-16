import { useEffect, useState } from "react";
import { Landmark, Plus, RefreshCw, Trash2, Edit2, AlertCircle, CheckCircle2, Users } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import {
  fetchEndorsementAccounts,
  registerEndorsementAccount,
  updateEndorsementAccount,
  revokeEndorsementAccount,
  fetchOfficers,
  type InstitutionalEndorsementAccount,
  type OfficerWithAccounts,
} from "./workspaceClient";

interface EndorsementAccountSectionProps {
  requests: PrivateRequests;
}

export function EndorsementAccountSection({ requests }: EndorsementAccountSectionProps) {
  const [accounts, setAccounts] = useState<InstitutionalEndorsementAccount[]>([]);
  const [officers, setOfficers] = useState<OfficerWithAccounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Creation form state
  const [creating, setCreating] = useState(false);
  const [accountAddress, setAccountAddress] = useState("");
  const [label, setLabel] = useState("");
  const [selectedOfficerIds, setSelectedOfficerIds] = useState<string[]>([]);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editOfficerIds, setEditOfficerIds] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [accList, officerList] = await Promise.all([
        fetchEndorsementAccounts(requests, true),
        fetchOfficers(requests),
      ]);
      setAccounts(accList);
      setOfficers(officerList);
    } catch (err: any) {
      setError(err?.message || "Gagal memuat daftar akun pengesahan lembaga.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!accountAddress.trim() || !label.trim()) return;

    setSubmitting(true);
    setError(null);
    setStatusMessage(null);

    try {
      await registerEndorsementAccount(requests, {
        accountAddress: accountAddress.trim(),
        label: label.trim(),
        authorizedOfficerIds: selectedOfficerIds,
      });

      setStatusMessage("Akun pengesahan lembaga berhasil didaftarkan.");
      setCreating(false);
      setAccountAddress("");
      setLabel("");
      setSelectedOfficerIds([]);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Gagal mendaftarkan akun pengesahan.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(id: string) {
    setSubmitting(true);
    setError(null);
    try {
      await updateEndorsementAccount(requests, id, {
        label: editLabel.trim(),
        authorizedOfficerIds: editOfficerIds,
      });
      setStatusMessage("Perubahan akun pengesahan tersimpan.");
      setEditingId(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Gagal memperbarui akun pengesahan.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm("Apakah Anda yakin ingin menonaktifkan akun pengesahan lembaga ini?")) return;
    setSubmitting(true);
    setError(null);
    try {
      await revokeEndorsementAccount(requests, id);
      setStatusMessage("Akun pengesahan lembaga telah dinonaktifkan.");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Gagal mencabut akun pengesahan.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs" aria-label="Manajemen Akun Pengesahan Lembaga">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <Landmark className="h-5 w-5 text-[#1b765e]" />
            Pendaftaran Akun Pengesahan Lembaga
          </h3>
          <p className="mt-0.5 text-xs text-stone-500">
            Akun resmi penanda tangan keputusan penyaluran atas nama institusi dan penugasan akses petugas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            title="Muat ulang daftar akun pengesahan"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>

          <Button size="sm" onClick={() => setCreating(!creating)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {creating ? "Batal" : "Daftarkan Akun"}
          </Button>
        </div>
      </div>

      {statusMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          {statusMessage}
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-800 border border-red-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
          {error}
        </div>
      )}

      {/* Creation Form */}
      {creating && (
        <form onSubmit={handleRegister} className="mt-4 rounded-xl border border-[#1b765e]/30 bg-[#f4f8f3]/60 p-4 space-y-4">
          <h4 className="text-sm font-semibold text-stone-900">Formulir Pendaftaran Akun Pengesahan Lembaga</h4>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ea-address" className="block text-xs font-medium text-stone-700">
                Alamat Akun Ethereum (Wallet Lembaga) *
              </label>
              <input
                id="ea-address"
                type="text"
                value={accountAddress}
                onChange={(e) => setAccountAddress(e.target.value)}
                placeholder="0x..."
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 font-mono text-xs"
                required
              />
            </div>

            <div>
              <label htmlFor="ea-label" className="block text-xs font-medium text-stone-700">
                Label / Deskripsi Rekening Pengesahan *
              </label>
              <input
                id="ea-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Contoh: Rekening Pengesahan Direksi Penyaluran"
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-xs"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700">
              Petugas yang Diotorisasi Memilih Akun Ini (Opsional)
            </label>
            <p className="text-[11px] text-stone-500 mb-2">
              Jika tidak ada yang dicentang, semua petugas lembaga dapat memilih akun pengesahan ini.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 max-h-40 overflow-y-auto rounded-lg border border-stone-200 bg-white p-3">
              {officers.map((off) => (
                <label key={off.id} className="flex items-center gap-2 text-xs text-stone-700">
                  <input
                    type="checkbox"
                    checked={selectedOfficerIds.includes(off.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedOfficerIds([...selectedOfficerIds, off.id]);
                      } else {
                        setSelectedOfficerIds(selectedOfficerIds.filter((id) => id !== off.id));
                      }
                    }}
                  />
                  <span>{off.displayName}</span>
                  <span className="font-mono text-[10px] text-stone-400">({off.id})</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button disabled={submitting || !accountAddress.trim() || !label.trim()} type="submit" size="sm">
              {submitting ? "Mendaftarkan…" : "Daftarkan Akun Pengesahan"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setCreating(false)}
            >
              Batal
            </Button>
          </div>
        </form>
      )}

      {/* Account List */}
      <div className="mt-4 space-y-3">
        {accounts.map((acc) => {
          const isEditing = editingId === acc.id;

          return (
            <div
              key={acc.id}
              className={`rounded-xl border p-4 transition-all ${
                acc.isActive ? "border-stone-200 bg-stone-50/40" : "border-stone-200 bg-stone-100/60 opacity-75"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="rounded border p-1 text-sm font-semibold w-full"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-sm text-stone-900">{acc.label}</h4>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          acc.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-stone-200 text-stone-600"
                        }`}
                      >
                        {acc.isActive ? "Aktif" : "Nonaktif"}
                      </span>
                    </div>
                  )}

                  <p className="mt-1 font-mono text-xs text-stone-600 break-all">{acc.accountAddress}</p>
                </div>

                <div className="flex items-center gap-1">
                  {isEditing ? (
                    <>
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleSaveEdit(acc.id)}
                        disabled={submitting}
                      >
                        Simpan
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setEditingId(null)}
                      >
                        Batal
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setEditingId(acc.id);
                          setEditLabel(acc.label);
                          setEditOfficerIds(acc.authorizedOfficerIds);
                        }}
                      >
                        <Edit2 className="h-3 w-3 mr-1" />
                        Ubah
                      </Button>
                      {acc.isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-red-600 hover:bg-red-50"
                          onClick={() => handleRevoke(acc.id)}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Nonaktifkan
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Authorized Officers */}
              <div className="mt-3 pt-3 border-t border-stone-200/60 text-xs">
                {isEditing ? (
                  <div className="space-y-1">
                    <span className="font-medium text-stone-700 block">Otorisasi Petugas:</span>
                    <div className="grid gap-1 sm:grid-cols-2 max-h-32 overflow-y-auto p-2 bg-white rounded border border-stone-200">
                      {officers.map((off) => (
                        <label key={off.id} className="flex items-center gap-1.5 text-[11px]">
                          <input
                            type="checkbox"
                            checked={editOfficerIds.includes(off.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditOfficerIds([...editOfficerIds, off.id]);
                              } else {
                                setEditOfficerIds(editOfficerIds.filter((id) => id !== off.id));
                              }
                            }}
                          />
                          <span>{off.displayName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-stone-600">
                    <Users className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                    <span>
                      {acc.authorizedOfficerIds.length === 0 ? (
                        <span className="text-stone-700 font-medium">
                          Dapat dipilih oleh semua petugas lembaga
                        </span>
                      ) : (
                        <span>
                          Dibatasi untuk {acc.authorizedOfficerIds.length} petugas (
                          {acc.authorizedOfficerIds
                            .map((id) => officers.find((o) => o.id === id)?.displayName || id)
                            .join(", ")}
                          )
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {accounts.length === 0 && !loading && (
          <p className="py-6 text-center text-xs text-stone-500">
            Belum ada akun pengesahan lembaga yang didaftarkan.
          </p>
        )}
      </div>
    </section>
  );
}
