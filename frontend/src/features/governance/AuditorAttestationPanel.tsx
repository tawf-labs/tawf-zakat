import React, { useEffect, useState } from "react";
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Sparkles,
  Award,
  Lock,
  Upload,
  Eye,
  ChevronUp,
} from "lucide-react";
import { useAccount, useSignTypedData } from "wagmi";
import {
  GOVERNANCE_EIP712_DOMAIN,
  GOVERNANCE_EIP712_TYPES,
  AUDIT_STANDARD,
  AUDIT_OPINIONS,
  AUDIT_DOCUMENT_MAX_BYTES,
} from "../../lib/contracts";
import { type Hex } from "viem";
import { toast } from "sonner";
import { useGovernanceRole } from "./RoleContext";
import { UniversalEvidenceModal } from "../evidence/UniversalEvidenceModal";

interface AuditorProfile {
  accountAddress: string;
  name: string;
  kapLicenseNumber: string;
  licenseProofCID: string;
}

interface AuditorAttestationPanelProps {
  proposals: any[];
  onActionComplete: () => void;
}

type AuditOpinionValue = (typeof AUDIT_OPINIONS)[number]["value"];

async function uploadAuditDocument(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", file.name);

  const res = await fetch(`${getApiBaseUrl()}/api/ipfs/upload-document`, {
    method: "POST",
    body: formData,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(json.error || `Gagal mengunggah ${file.name} ke IPFS`);
  }
  return json.cid as string;
}

function validatePdfFile(file: File | null, label: string) {
  if (!file) throw new Error(`${label} wajib diunggah`);
  if (file.type !== "application/pdf") {
    throw new Error(`${label} harus berupa berkas PDF`);
  }
  if (file.size > AUDIT_DOCUMENT_MAX_BYTES) {
    throw new Error(`${label} melebihi batas ukuran 10MB`);
  }
}

export function AuditorAttestationPanel({
  proposals,
  onActionComplete,
}: AuditorAttestationPanelProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { canAttestAudit, getRestrictionReason } = useGovernanceRole();

  const [profile, setProfile] = useState<AuditorProfile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [activeFormId, setActiveFormId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [opinion, setOpinion] = useState<AuditOpinionValue>("WTP");
  const [notes, setNotes] = useState("");
  const [laiFile, setLaiFile] = useState<File | null>(null);
  const [financialFile, setFinancialFile] = useState<File | null>(null);
  const [evidenceCid, setEvidenceCid] = useState<string | null>(null);
  const [evidenceTitle, setEvidenceTitle] = useState("");

  // Executed proposals that can receive auditor attestation
  const executedProposals = proposals.filter(
    (p) => p.status === "Executed" || p.status === "EXECUTED" || p.status === "Approved" || p.status === "APPROVED"
  );

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setProfileChecked(false);

    if (!address) {
      setProfileChecked(true);
      return;
    }

    fetch(`${getApiBaseUrl()}/api/governance/auditors/${address}`)
      .then((res) => res.json().catch(() => ({})))
      .then((json) => {
        if (!cancelled) {
          setProfile(json?.profile || null);
          setProfileChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) setProfileChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  const resetForm = () => {
    setActiveFormId(null);
    setOpinion("WTP");
    setNotes("");
    setLaiFile(null);
    setFinancialFile(null);
  };

  const openForm = (pId: number) => {
    setActiveFormId(pId);
    setOpinion("WTP");
    setNotes("");
    setLaiFile(null);
    setFinancialFile(null);
  };

  const handleSubmitAttestation = async (proposal: any) => {
    if (!canAttestAudit) {
      toast.info("Akses Dibatasi", { description: getRestrictionReason("audit") });
      return;
    }
    if (!isConnected || !address) {
      toast.error("Silakan hubungkan dompet dengan hak Auditor (AUDITOR_ROLE).");
      return;
    }
    if (!profile) {
      toast.error("Wallet Anda belum terdaftar sebagai auditor. Hubungi admin BAZNAS untuk registrasi KAP.");
      return;
    }

    const pId = proposal.proposalId || proposal.id;

    try {
      validatePdfFile(laiFile, "Laporan Auditor Independen (LAI)");
      validatePdfFile(financialFile, "Paket Laporan Keuangan Diaudit");
    } catch (validationErr: any) {
      toast.error(validationErr.message);
      return;
    }

    setLoadingId(pId);

    try {
      // 1. Upload the two required PDF documents to IPFS
      toast.info("Mengunggah dokumen LAI & laporan keuangan ke IPFS...");
      const laiDocumentCID = await uploadAuditDocument(laiFile as File);
      const financialStatementsCID = await uploadAuditDocument(financialFile as File);

      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const amountIDR = BigInt(Number(proposal.amountIDR) || 2500000);
      const benHash = (proposal.beneficiaryHash ||
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef") as Hex;

      // 2. Sign Gasless EIP-712 Signature — binds the opinion to the exact documents reviewed
      toast.info("Silakan konfirmasi tanda tangan digital otorisasi di dompet...");
      const signature = await signTypedDataAsync({
        domain: GOVERNANCE_EIP712_DOMAIN,
        types: GOVERNANCE_EIP712_TYPES,
        primaryType: "AuditorAttestation",
        message: {
          proposalId: BigInt(pId),
          beneficiaryHash: benHash,
          amountIDR,
          auditOpinion: opinion,
          standard: AUDIT_STANDARD,
          auditorName: profile.name,
          laiDocumentCID,
          financialStatementsCID,
          timestamp,
        },
      });

      // 3. Broadcast via Relayer API with Sponsored Gas
      const res = await fetch(`${getApiBaseUrl()}/api/governance/attest-audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: pId,
          auditorAddress: address,
          auditOpinion: opinion,
          auditNotes: notes || undefined,
          laiDocumentCID,
          financialStatementsCID,
          timestamp: Number(timestamp),
          signature,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMessage = "Gagal mencatat atestasi auditor";
        try {
          const errJson = JSON.parse(errText);
          errMessage = errJson.error || errMessage;
        } catch {
          errMessage = errText || errMessage;
        }
        throw new Error(errMessage);
      }

      const opinionLabel = AUDIT_OPINIONS.find((o) => o.value === opinion)?.label || opinion;
      toast.success(`Atestasi ${opinionLabel} untuk Proposal #${pId} berhasil dicatat on-chain!`);
      resetForm();
      onActionComplete();
    } catch (err: any) {
      console.error("Auditor Attestation error:", err);
      toast.error(err.message || "Gagal menerbitkan atestasi auditor.");
    } finally {
      setLoadingId(null);
    }
  };

  const notRegistered = isConnected && canAttestAudit && profileChecked && !profile;

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#dbe7dd]/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold text-[#17332c]">
              Panel Atestasi Auditor Independen (Ex-Post)
            </h3>
            <p className="text-xs text-[#5e7a70]">
              Sertifikasi kepatuhan akuntansi syariah {AUDIT_STANDARD} disertai dokumen LAI & laporan keuangan diaudit.
            </p>
          </div>
        </div>
        {profile && (
          <div className="text-right text-xs">
            <p className="font-bold text-[#17332c]">{profile.name}</p>
            <p className="text-[#5e7a70]">Lisensi AP: {profile.kapLicenseNumber}</p>
          </div>
        )}
      </div>

      {notRegistered && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            Wallet <span className="font-mono">{address}</span> memegang AUDITOR_ROLE namun belum terdaftar di
            registry identitas auditor. Hubungi admin BAZNAS untuk registrasi nama KAP & bukti izin sebelum dapat
            menerbitkan opini.
          </p>
        </div>
      )}

      {executedProposals.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#5e7a70] space-y-2">
          <Award className="w-8 h-8 text-emerald-600 mx-auto opacity-70" />
          <p className="font-semibold text-[#17332c]">Semua Pencairan Telah Diaudit</p>
          <p>Belum ada program baru yang memerlukan atestasi audit pasca-penyaluran.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {executedProposals.map((p) => {
            const pId = p.proposalId || p.id;
            const isLoading = loadingId === pId;
            const isFormOpen = activeFormId === pId;
            const auditStatus = p.auditStatus;
            const isAudited = auditStatus === "AUDITED_WTP" || p.auditOpinion === "WTP";
            const isDisputed = auditStatus === "DISPUTED" && p.auditOpinion && p.auditOpinion !== "WTP";
            const isSettled = isAudited || isDisputed;

            return (
              <div
                key={pId}
                className="p-5 rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3]/40 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[#17332c]">
                        Proposal #{pId}
                      </span>
                      <span className="text-[11px] font-semibold text-[#1b765e] bg-white px-2 py-0.5 rounded-full border border-[#dbe7dd]">
                        {p.asnafLabel || p.asnafType || "Fakir Miskin"}
                      </span>
                      {isAudited && (
                        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                          {p.auditOpinion || "WTP"} Terbit
                        </span>
                      )}
                      {isDisputed && (
                        <span className="text-[10px] font-bold text-red-800 bg-red-100 px-2 py-0.5 rounded-full">
                          {p.auditOpinion} — Disengketa
                        </span>
                      )}
                      {!isSettled && (
                        <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                          Siap Diaudit
                        </span>
                      )}
                    </div>
                    <p className="font-bold text-sm text-[#17332c]">
                      {p.beneficiaryName ? `Bantuan Mustahik: ${p.beneficiaryName}` : "Program Bantuan Kemanusiaan"}
                    </p>
                    <p className="text-xs text-[#5e7a70]">
                      Nominal:{" "}
                      <strong className="text-[#17332c]">
                        {p.amountIDR ? `Rp ${Number(p.amountIDR).toLocaleString("id-ID")}` : `${p.amountUSDC} USDC`}
                      </strong>{" "}
                      | BAST IPFS: <span className="font-mono">{p.disbursementReceiptCID?.slice(0, 12) || "QmXoy...uco"}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {isSettled ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEvidenceCid(p.auditReportCID || p.laiDocumentCID);
                            setEvidenceTitle(`Laporan Audit Proposal #${pId}`);
                          }}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1b765e] bg-white px-4 py-2.5 rounded-xl border border-[#dbe7dd] hover:bg-[#f4f8f3]"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Lihat Berkas Audit</span>
                        </button>
                        <div
                          className={`flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-xl border ${
                            isAudited
                              ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                              : "text-red-700 bg-red-50 border-red-200"
                          }`}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Opini {p.auditOpinion} Tercatat</span>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={isLoading || !canAttestAudit}
                        onClick={() => (isFormOpen ? resetForm() : openForm(pId))}
                        className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer ${
                          canAttestAudit
                            ? "bg-[#17332c] hover:bg-[#1b765e] text-white"
                            : "bg-[#eaf3e8] text-[#5e7a70] border border-[#dbe7dd]"
                        }`}
                        title={!canAttestAudit ? getRestrictionReason("audit") : "Buka formulir atestasi opini audit"}
                      >
                        {canAttestAudit ? (
                          isFormOpen ? <ChevronUp className="w-4 h-4" /> : <Sparkles className="w-4 h-4 text-[#c4ed70]" />
                        ) : (
                          <Lock className="w-3.5 h-3.5 text-[#5e7a70]" />
                        )}
                        <span>{isFormOpen ? "Tutup Formulir" : "Terbitkan Opini Audit"}</span>
                        {!canAttestAudit && (
                          <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-white text-[#5e7a70] border border-[#dbe7dd]">
                            Khusus Auditor
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {isFormOpen && (
                  <div className="rounded-2xl border border-[#dbe7dd] bg-white p-5 space-y-4">
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
                        Opini Audit (SA 705)
                      </label>
                      <select
                        value={opinion}
                        onChange={(e) => setOpinion(e.target.value as AuditOpinionValue)}
                        className="mt-1.5 w-full rounded-xl border border-[#dbe7dd] bg-white px-3 py-2.5 text-xs font-semibold text-[#17332c] outline-none focus:border-[#1b765e]"
                      >
                        {AUDIT_OPINIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {opinion !== "WTP" && (
                        <p className="mt-1.5 text-[11px] text-red-700">
                          Opini selain WTP akan menandai proposal sebagai "Disengketa" dan memblokir pencairan lebih
                          lanjut sampai ditinjau ulang.
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
                          Laporan Auditor Independen (PDF)
                        </label>
                        <label className="mt-1.5 flex items-center gap-2 rounded-xl border border-dashed border-[#dbe7dd] bg-[#f4f8f3]/40 px-3 py-2.5 text-xs font-semibold text-[#17332c] cursor-pointer hover:bg-[#f4f8f3]">
                          <Upload className="w-3.5 h-3.5 text-[#1b765e]" />
                          <span className="truncate">{laiFile ? laiFile.name : "Pilih berkas LAI..."}</span>
                          <input
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            onChange={(e) => setLaiFile(e.target.files?.[0] || null)}
                          />
                        </label>
                      </div>
                      <div>
                        <label className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
                          Paket Laporan Keuangan Diaudit (PDF)
                        </label>
                        <label className="mt-1.5 flex items-center gap-2 rounded-xl border border-dashed border-[#dbe7dd] bg-[#f4f8f3]/40 px-3 py-2.5 text-xs font-semibold text-[#17332c] cursor-pointer hover:bg-[#f4f8f3]">
                          <Upload className="w-3.5 h-3.5 text-[#1b765e]" />
                          <span className="truncate">{financialFile ? financialFile.name : "Pilih berkas laporan keuangan..."}</span>
                          <input
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            onChange={(e) => setFinancialFile(e.target.files?.[0] || null)}
                          />
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
                        Catatan Auditor (opsional, tampil publik)
                      </label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        placeholder="Temuan atau catatan tambahan..."
                        className="mt-1.5 w-full rounded-xl border border-[#dbe7dd] bg-white px-3 py-2.5 text-xs text-[#17332c] outline-none focus:border-[#1b765e] resize-none"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleSubmitAttestation(p)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-[#17332c] hover:bg-[#1b765e] text-white shadow-xs cursor-pointer disabled:opacity-60"
                      >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-[#c4ed70]" />}
                        <span>Terbitkan & Tanda Tangani</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <UniversalEvidenceModal
        isOpen={!!evidenceCid}
        onClose={() => setEvidenceCid(null)}
        cid={evidenceCid || undefined}
        title={evidenceTitle}
      />
    </div>
  );
}
