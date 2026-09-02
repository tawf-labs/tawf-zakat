import React, { useEffect, useState } from "react";
import { ShieldPlus, Loader2, Upload, UserCheck, Lock } from "lucide-react";
import { useAccount, useSignTypedData } from "wagmi";
import { GOVERNANCE_EIP712_DOMAIN, GOVERNANCE_EIP712_TYPES, AUDIT_DOCUMENT_MAX_BYTES } from "../../lib/contracts";
import { toast } from "sonner";
import { useGovernanceRole } from "./RoleContext";

interface AuditorProfile {
  accountAddress: string;
  name: string;
  kapLicenseNumber: string;
  licenseProofCID: string;
  registeredAt?: string;
}

export function AuditorRegistrationPanel() {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { canCreateProposal, getRestrictionReason } = useGovernanceRole();

  const [auditorAddress, setAuditorAddress] = useState("");
  const [auditorName, setAuditorName] = useState("");
  const [kapLicenseNumber, setKapLicenseNumber] = useState("");
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [profiles, setProfiles] = useState<AuditorProfile[]>([]);

  const canRegister = canCreateProposal; // DEFAULT_ADMIN_ROLE wallet, same gate as proposal creation

  const refreshProfiles = () => {
    fetch("http://localhost:3001/api/governance/auditors")
      .then((res) => res.json().catch(() => ({})))
      .then((json) => setProfiles(json?.profiles || []))
      .catch(() => {});
  };

  useEffect(() => {
    refreshProfiles();
  }, []);

  const resetForm = () => {
    setAuditorAddress("");
    setAuditorName("");
    setKapLicenseNumber("");
    setLicenseFile(null);
  };

  const handleRegister = async () => {
    if (!canRegister) {
      toast.info("Akses Dibatasi", { description: getRestrictionReason("create") });
      return;
    }
    if (!isConnected || !address) {
      toast.error("Silakan hubungkan dompet admin (DEFAULT_ADMIN_ROLE).");
      return;
    }
    if (!auditorAddress || !auditorName || !kapLicenseNumber) {
      toast.error("Alamat wallet, nama KAP, dan nomor izin AP wajib diisi.");
      return;
    }
    if (!licenseFile) {
      toast.error("Bukti izin Akuntan Publik (PDF) wajib diunggah.");
      return;
    }
    if (licenseFile.type !== "application/pdf") {
      toast.error("Bukti izin harus berupa berkas PDF.");
      return;
    }
    if (licenseFile.size > AUDIT_DOCUMENT_MAX_BYTES) {
      toast.error("Berkas bukti izin melebihi batas ukuran 10MB.");
      return;
    }

    setSubmitting(true);
    try {
      toast.info("Mengunggah bukti izin Akuntan Publik ke IPFS...");
      const formData = new FormData();
      formData.append("file", licenseFile);
      formData.append("name", licenseFile.name);
      const uploadRes = await fetch("http://localhost:3001/api/ipfs/upload-document", {
        method: "POST",
        body: formData,
      });
      const uploadJson = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploadJson.success) {
        throw new Error(uploadJson.error || "Gagal mengunggah bukti izin ke IPFS");
      }
      const licenseProofCID = uploadJson.cid as string;

      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      toast.info("Silakan konfirmasi tanda tangan digital registrasi auditor di dompet...");
      const signature = await signTypedDataAsync({
        domain: GOVERNANCE_EIP712_DOMAIN,
        types: GOVERNANCE_EIP712_TYPES,
        primaryType: "AuditorRegistration",
        message: {
          auditorAddress: auditorAddress as `0x${string}`,
          auditorName,
          kapLicenseNumber,
          licenseProofCID,
          timestamp,
        },
      });

      const res = await fetch("http://localhost:3001/api/governance/auditors/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminAddress: address,
          auditorAddress,
          auditorName,
          kapLicenseNumber,
          licenseProofCID,
          timestamp: Number(timestamp),
          signature,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Gagal mendaftarkan identitas auditor");
      }

      toast.success(`Auditor ${auditorName} berhasil didaftarkan.`);
      resetForm();
      refreshProfiles();
    } catch (err: any) {
      console.error("Auditor registration error:", err);
      toast.error(err.message || "Gagal mendaftarkan auditor.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 shadow-2xs space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
          <ShieldPlus className="w-4.5 h-4.5" />
        </div>
        <div>
          <h4 className="font-serif text-base font-bold text-[#17332c]">Registrasi Identitas Auditor (KAP)</h4>
          <p className="text-xs text-[#5e7a70] mt-0.5">
            Onboarding satu kali per wallet AUDITOR_ROLE — nama & bukti izin AP tersimpan di registry, tidak lagi
            diketik ulang setiap atestasi.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
            Alamat Wallet Auditor
          </label>
          <input
            type="text"
            value={auditorAddress}
            onChange={(e) => setAuditorAddress(e.target.value)}
            placeholder="0x..."
            className="mt-1.5 w-full rounded-xl border border-[#dbe7dd] bg-white px-3 py-2.5 text-xs font-mono text-[#17332c] outline-none focus:border-[#1b765e]"
          />
        </div>
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
            Nama KAP / Auditor
          </label>
          <input
            type="text"
            value={auditorName}
            onChange={(e) => setAuditorName(e.target.value)}
            placeholder="Kantor Akuntan Publik ..."
            className="mt-1.5 w-full rounded-xl border border-[#dbe7dd] bg-white px-3 py-2.5 text-xs text-[#17332c] outline-none focus:border-[#1b765e]"
          />
        </div>
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
            Nomor Izin Akuntan Publik
          </label>
          <input
            type="text"
            value={kapLicenseNumber}
            onChange={(e) => setKapLicenseNumber(e.target.value)}
            placeholder="AP.XXXX"
            className="mt-1.5 w-full rounded-xl border border-[#dbe7dd] bg-white px-3 py-2.5 text-xs text-[#17332c] outline-none focus:border-[#1b765e]"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
            Bukti Izin Akuntan Publik (PDF)
          </label>
          <label className="mt-1.5 flex items-center gap-2 rounded-xl border border-dashed border-[#dbe7dd] bg-[#f4f8f3]/40 px-3 py-2.5 text-xs font-semibold text-[#17332c] cursor-pointer hover:bg-[#f4f8f3]">
            <Upload className="w-3.5 h-3.5 text-[#1b765e]" />
            <span className="truncate">{licenseFile ? licenseFile.name : "Pilih berkas bukti izin..."}</span>
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => setLicenseFile(e.target.files?.[0] || null)}
            />
          </label>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={submitting || !canRegister}
          onClick={handleRegister}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer disabled:opacity-60 ${
            canRegister ? "bg-[#17332c] hover:bg-[#1b765e] text-white" : "bg-[#eaf3e8] text-[#5e7a70] border border-[#dbe7dd]"
          }`}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : canRegister ? <ShieldPlus className="w-4 h-4 text-[#c4ed70]" /> : <Lock className="w-3.5 h-3.5" />}
          <span>Daftarkan Auditor</span>
        </button>
      </div>

      {profiles.length > 0 && (
        <div className="pt-4 border-t border-[#dbe7dd]/60 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">Auditor Terdaftar</p>
          {profiles.map((p) => (
            <div
              key={p.accountAddress}
              className="flex items-center justify-between gap-3 rounded-xl border border-[#dbe7dd] bg-[#f4f8f3]/40 px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <UserCheck className="w-3.5 h-3.5 text-[#1b765e] shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-[#17332c] truncate">{p.name}</p>
                  <p className="font-mono text-[10px] text-[#5e7a70] truncate">{p.accountAddress}</p>
                </div>
              </div>
              <span className="text-[10px] font-semibold text-[#1b765e] bg-white px-2 py-0.5 rounded-full border border-[#dbe7dd] shrink-0">
                {p.kapLicenseNumber}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
