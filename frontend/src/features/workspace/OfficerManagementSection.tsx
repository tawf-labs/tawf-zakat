import React, { useEffect, useState } from "react";
import { UserCheck, UserPlus, Link2, Unlink, Edit3, ShieldAlert, CheckCircle2, UserX } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { PrivateRequests } from "./privateRequests";
import {
  fetchOfficers,
  createOfficer,
  updateOfficer,
  linkOfficerAccount,
  unlinkOfficerAccount,
  type OfficerWithAccounts,
  type WorkspaceRole,
} from "./workspaceClient";

export function OfficerManagementSection({
  requests,
  institutionId: _institutionId,
}: {
  requests: PrivateRequests;
  institutionId: string;
}) {
  const [officers, setOfficers] = useState<OfficerWithAccounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // New officer form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newAccount, setNewAccount] = useState("");
  const [newRole, setNewRole] = useState<WorkspaceRole>("OFFICER");
  const [creating, setCreating] = useState(false);

  // Link account state
  const [linkingOfficerId, setLinkingOfficerId] = useState<string | null>(null);
  const [linkAccountAddress, setLinkAccountAddress] = useState("");
  const [linkAccountRole, setLinkAccountRole] = useState<WorkspaceRole>("OFFICER");
  const [linking, setLinking] = useState(false);

  // Edit officer name state
  const [editingOfficerId, setEditingOfficerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [updating, setUpdating] = useState(false);

  async function loadOfficers() {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchOfficers(requests);
      setOfficers(data);
    } catch (err: any) {
      setErrorMessage(err?.message || "Gagal memuat daftar petugas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOfficers();
  }, [requests]);

  function notifySuccess(msg: string) {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  }

  async function handleCreateOfficer(e: React.FormEvent) {
    e.preventDefault();
    if (!newDisplayName.trim()) return;
    setCreating(true);
    setErrorMessage(null);
    try {
      await createOfficer(requests, {
        displayName: newDisplayName.trim(),
        account: newAccount.trim() || undefined,
        role: newAccount.trim() ? newRole : undefined,
      });
      setNewDisplayName("");
      setNewAccount("");
      setShowCreateForm(false);
      notifySuccess("Profil petugas berhasil dibuat.");
      await loadOfficers();
    } catch (err: any) {
      setErrorMessage(err?.message || "Gagal membuat profil petugas.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdateName(officerId: string) {
    if (!editingName.trim()) return;
    setUpdating(true);
    setErrorMessage(null);
    try {
      await updateOfficer(requests, officerId, { displayName: editingName.trim() });
      setEditingOfficerId(null);
      notifySuccess("Nama petugas berhasil diperbarui.");
      await loadOfficers();
    } catch (err: any) {
      setErrorMessage(err?.message || "Gagal memperbarui nama petugas.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleToggleActive(officerId: string, currentActive: boolean) {
    setErrorMessage(null);
    try {
      await updateOfficer(requests, officerId, { isActive: !currentActive });
      notifySuccess(`Petugas ${!currentActive ? "diaktifkan" : "dinonaktifkan"}.`);
      await loadOfficers();
    } catch (err: any) {
      setErrorMessage(err?.message || "Gagal mengubah status aktif petugas.");
    }
  }

  async function handleLinkAccount(officerId: string) {
    if (!linkAccountAddress.trim()) return;
    setLinking(true);
    setErrorMessage(null);
    try {
      await linkOfficerAccount(requests, officerId, {
        account: linkAccountAddress.trim(),
        role: linkAccountRole,
      });
      setLinkingOfficerId(null);
      setLinkAccountAddress("");
      notifySuccess("Akun kerja berhasil ditautkan ke profil petugas.");
      await loadOfficers();
    } catch (err: any) {
      setErrorMessage(err?.message || "Gagal menautkan akun kerja.");
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlinkAccount(officerId: string, account: string) {
    setErrorMessage(null);
    try {
      await unlinkOfficerAccount(requests, officerId, account);
      notifySuccess("Akun kerja dinonaktifkan/dilepas dari profil petugas.");
      await loadOfficers();
    } catch (err: any) {
      setErrorMessage(err?.message || "Gagal melepas akun kerja.");
    }
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-700">
            <UserCheck className="h-4 w-4 text-[#1b765e]" />
            Pengelolaan Profil Petugas & Akun Kerja
          </h3>
          <p className="mt-1 text-xs text-stone-500">
            Petugas memiliki identitas stabil. Administrator dapat menautkan lebih dari satu akun kerja ke petugas yang sama.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreateForm((prev) => !prev)}
          className="text-xs"
        >
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          {showCreateForm ? "Tutup Form" : "Tambah Petugas"}
        </Button>
      </div>

      {successMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200 animate-in fade-in">
          <ShieldAlert className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Form Tambah Petugas */}
      {showCreateForm && (
        <form onSubmit={handleCreateOfficer} className="mt-4 rounded-xl border border-[#dbe7dd] bg-[#f4f8f3]/60 p-4 space-y-3">
          <h4 className="text-xs font-semibold text-[#17332c] uppercase tracking-wider">
            Buat Profil Petugas Baru
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label htmlFor="new-officer-name" className="block font-medium text-stone-700">
                Nama Lengkap / Tampilan Petugas *
              </label>
              <input
                id="new-officer-name"
                type="text"
                required
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="Contoh: Ahmad Fauzi Amil"
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 text-xs"
              />
            </div>
            <div>
              <label htmlFor="new-officer-account" className="block font-medium text-stone-700">
                Alamat Akun Kerja (Wallet 0x..., opsional)
              </label>
              <input
                id="new-officer-account"
                type="text"
                value={newAccount}
                onChange={(e) => setNewAccount(e.target.value)}
                placeholder="0x..."
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-stone-900 text-xs"
              />
            </div>
          </div>
          {newAccount.trim() && (
            <div className="text-xs max-w-xs">
              <label htmlFor="new-officer-role" className="block font-medium text-stone-700">
                Peran Akun
              </label>
              <select
                id="new-officer-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as WorkspaceRole)}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-900"
              >
                <option value="OFFICER">OFFICER (Amil operasional)</option>
                <option value="READER">READER (Pembaca berwenang)</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCreateForm(false)}
              className="text-xs"
            >
              Batal
            </Button>
            <Button type="submit" size="sm" disabled={creating || !newDisplayName.trim()} className="text-xs">
              {creating ? "Menyimpan…" : "Simpan Petugas"}
            </Button>
          </div>
        </form>
      )}

      {/* Daftar Petugas */}
      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-xs text-stone-500 py-4 text-center">Memuat profil petugas…</p>
        ) : officers.length === 0 ? (
          <p className="text-xs text-stone-500 py-4 text-center bg-stone-50 rounded-xl border border-dashed border-stone-200">
            Belum ada profil petugas terdaftar dalam lembaga ini.
          </p>
        ) : (
          officers.map((officer) => (
            <div
              key={officer.id}
              className={`rounded-xl border p-4 transition-all ${
                officer.isActive
                  ? "border-stone-200 bg-white shadow-2xs"
                  : "border-stone-200 bg-stone-50/70 opacity-75"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  {editingOfficerId === officer.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="rounded border border-stone-300 px-2 py-1 text-xs font-semibold text-stone-900"
                        placeholder="Nama tampilan baru"
                      />
                      <Button
                        size="sm"
                        disabled={updating || !editingName.trim()}
                        onClick={() => handleUpdateName(officer.id)}
                        className="text-xs py-1 h-7"
                      >
                        Simpan
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingOfficerId(null)}
                        className="text-xs py-1 h-7"
                      >
                        Batal
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-stone-900">{officer.displayName}</h4>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingOfficerId(officer.id);
                          setEditingName(officer.displayName);
                        }}
                        className="text-stone-400 hover:text-stone-700 p-0.5"
                        title="Ubah nama tampilan"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <Badge className={officer.isActive ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}>
                        {officer.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </div>
                  )}
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    ID Petugas: <code className="font-mono text-stone-700">{officer.id}</code>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setLinkingOfficerId(officer.id === linkingOfficerId ? null : officer.id);
                      setLinkAccountAddress("");
                    }}
                    className="text-xs h-7 px-2.5"
                  >
                    <Link2 className="w-3 h-3 mr-1" />
                    Tautkan Akun
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleActive(officer.id, officer.isActive)}
                    className="text-xs h-7 px-2.5 text-stone-600 hover:text-red-700"
                  >
                    <UserX className="w-3 h-3 mr-1" />
                    {officer.isActive ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                </div>
              </div>

              {/* Form Tautkan Akun Baru untuk Petugas Ini */}
              {linkingOfficerId === officer.id && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-[#f4f8f3] p-3 space-y-2 text-xs animate-in fade-in">
                  <p className="font-semibold text-stone-800">Tautkan Akun Kerja Baru untuk {officer.displayName}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="sm:col-span-2">
                      <input
                        type="text"
                        placeholder="Alamat akun wallet (0x...)"
                        value={linkAccountAddress}
                        onChange={(e) => setLinkAccountAddress(e.target.value)}
                        className="w-full rounded border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                      />
                    </div>
                    <div>
                      <select
                        value={linkAccountRole}
                        onChange={(e) => setLinkAccountRole(e.target.value as WorkspaceRole)}
                        className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-xs"
                      >
                        <option value="OFFICER">OFFICER</option>
                        <option value="READER">READER</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLinkingOfficerId(null)}
                      className="text-xs h-7"
                    >
                      Batal
                    </Button>
                    <Button
                      size="sm"
                      disabled={linking || !linkAccountAddress.trim()}
                      onClick={() => handleLinkAccount(officer.id)}
                      className="text-xs h-7"
                    >
                      {linking ? "Menautkan…" : "Tautkan"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Daftar Akun Kerja Tertaut */}
              <div className="mt-3 pt-3 border-t border-stone-100">
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                  Akun Kerja Tertaut ({officer.accounts.length})
                </span>
                {officer.accounts.length === 0 ? (
                  <p className="text-xs text-stone-400 mt-1 italic">Belum ada akun kerja yang ditautkan.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {officer.accounts.map((acc) => (
                      <li
                        key={acc.account}
                        className={`flex flex-wrap items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 border ${
                          acc.isActive ? "bg-stone-50 border-stone-200" : "bg-stone-100/60 border-stone-200 opacity-60"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <code className="font-mono text-[11px] truncate text-stone-800">{acc.account}</code>
                          <Badge className="text-[10px] py-0">{acc.role}</Badge>
                          {!acc.isActive && (
                            <span className="text-[10px] text-stone-500">(Nonaktif)</span>
                          )}
                        </div>
                        {acc.isActive && (
                          <button
                            type="button"
                            onClick={() => handleUnlinkAccount(officer.id, acc.account)}
                            className="text-stone-400 hover:text-red-700 transition-colors p-1"
                            title="Lepas/nonaktifkan akun ini"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
