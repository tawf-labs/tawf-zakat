import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { useAccount, useSignTypedData } from "wagmi";
import { Upload, Loader2, Sparkles, ShieldCheck, FileText, CheckCircle2 } from "lucide-react";
import { keccak256, encodePacked, parseUnits, type Hex } from "viem";
import { GOVERNANCE_EIP712_DOMAIN, GOVERNANCE_EIP712_TYPES, getApiBaseUrl } from "../../lib/contracts";
import { toast } from "sonner";

interface CreateProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const ASNAF_OPTIONS = [
  { id: 1, label: "Fakir" },
  { id: 2, label: "Miskin" },
  { id: 3, label: "Amil" },
  { id: 4, label: "Muallaf" },
  { id: 5, label: "Riqab" },
  { id: 6, label: "Gharimin" },
  { id: 7, label: "Fisabilillah" },
  { id: 8, label: "Ibnu Sabil" },
];

export function CreateProposalModal({ isOpen, onClose, onSuccess }: CreateProposalModalProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [title, setTitle] = useState("Bantuan Pangan & Sembako Mustahik");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [nik, setNik] = useState("");
  const [asnafId, setAsnafId] = useState(1);
  const [currencyType, setCurrencyType] = useState<0 | 1>(0); // 0 = IDR, 1 = USDC
  const [amount, setAmount] = useState("2500000");
  const [file, setFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address) {
      toast.error("Silakan hubungkan dompet dengan hak Amil (DEFAULT_ADMIN_ROLE).");
      return;
    }

    if (!beneficiaryName || !nik) {
      toast.error("Nama mustahik dan NIK wajib diisi.");
      return;
    }

    setLoading(true);
    setStatusText("Mengunggah berkas survei mustahik ke IPFS...");

    try {
      // 1. Upload file or dossier to Pinata IPFS
      let cid = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"; // Default fallback CID
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("docType", "PROPOSAL_DOSSIER");
        const uploadRes = await fetch(`${getApiBaseUrl()}/api/ipfs/upload-file`, {
          method: "POST",
          body: formData,
        });
        if (uploadRes.ok) {
          const uploadJson = await uploadRes.json();
          cid = uploadJson.cid || cid;
        }
      }

      // 2. Compute privacy-preserving salted beneficiary hash
      setStatusText("Membuat Salted Hash perlindungan privasi (UU PDP)...");
      const salt = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const beneficiaryHash = keccak256(
        encodePacked(["string", "string", "bytes32"], [nik, beneficiaryName, salt as Hex])
      );

      // 3. Request EIP-712 Typed Signature from Amil
      setStatusText("Silakan konfirmasi tanda tangan digital di dompet...");
      const currentPeriodId = 202609;
      const numAmount = Number(amount);
      const parsedAmount = currencyType === 1 ? parseUnits(amount.toString(), 6) : BigInt(amount);
      const recipient = (currencyType === 1 ? (address as Hex) : "0x0000000000000000000000000000000000000000") as Hex;
      const timestamp = BigInt(Math.floor(Date.now() / 1000));

      const signature = await signTypedDataAsync({
        domain: GOVERNANCE_EIP712_DOMAIN,
        types: GOVERNANCE_EIP712_TYPES,
        primaryType: "AmilProposal",
        message: {
          currencyType,
          amount: parsedAmount,
          asnafCategory: asnafId,
          beneficiaryHash,
          ipfsProofCID: cid,
          periodId: BigInt(currentPeriodId),
          usdcRecipient: recipient,
          timestamp,
        },
      });

      // 4. Submit to Backend Gasless Governance Relayer
      setStatusText("Memproses pengajuan ke smart contract via Relayer...");
      const res = await fetch(`${getApiBaseUrl()}/api/governance/gasless-propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currencyType,
          amount: currencyType === 1 ? Number(parsedAmount) : numAmount,
          asnafCategory: asnafId,
          beneficiaryHash,
          ipfsProofCID: cid,
          periodId: currentPeriodId,
          usdcRecipient: recipient,
          timestamp: Number(timestamp),
          signature,
          signerAddress: address,
          programTitle: title,
          beneficiaryName,
          beneficiaryNIK: nik,
          secretSalt: salt,
          evidenceFiles: [
            {
              fileName: file ? file.name : "berkas_survei_mustahik.pdf",
              fileType: file ? file.type : "application/pdf",
              description: "Dokumen survei kelayakan asnaf BAZNAS",
              cid,
            },
          ],
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Gagal mengajukan proposal via Relayer.");
      }

      toast.success(`Proposal "${title}" berhasil diajukan ke antrean DPS!`);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error("Propose error:", err);
      toast.error(err.message || "Gagal mengajukan proposal penyaluran.");
    } finally {
      setLoading(false);
      setStatusText(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-2xl">
        <DialogHeader className="space-y-1.5 border-b border-[#dbe7dd]/60 pb-4">
          <DialogTitle className="font-serif text-2xl font-bold text-[#17332c]">
            Pengajuan Penyaluran Zakat Baru
          </DialogTitle>
          <p className="text-xs text-[#5e7a70]">
            Khusus Amil Operasional. Proposal akan masuk ke antrean verifikasi Dewan Pengawas Syariah (DPS).
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          <Input
            label="Nama / Judul Program Bantuan"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Contoh: Bantuan Sembako Fakir Miskin"
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Nama Lengkap Mustahik"
              value={beneficiaryName}
              onChange={(e) => setBeneficiaryName(e.target.value)}
              placeholder="Sesuai KTP"
              required
            />
            <Input
              label="NIK KTP Mustahik (16 Digit)"
              value={nik}
              onChange={(e) => setNik(e.target.value)}
              placeholder="3201xxxxxxxxxxxx"
              required
              helperText="Akan di-hash salted untuk perlindungan data"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#17332c]">
                Kategori 8 Asnaf
              </label>
              <select
                value={asnafId}
                onChange={(e) => setAsnafId(Number(e.target.value))}
                className="w-full rounded-xl border border-[#dbe7dd] bg-white px-3.5 py-2.5 text-sm text-[#17332c] outline-none focus:border-[#1b765e]"
              >
                {ASNAF_OPTIONS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id}. {a.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#17332c]">
                Mata Uang Kas
              </label>
              <div className="flex rounded-xl bg-[#f4f8f3] p-1 border border-[#dbe7dd]">
                <button
                  type="button"
                  onClick={() => setCurrencyType(0)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    currencyType === 0 ? "bg-white text-[#17332c] shadow-xs" : "text-[#5e7a70]"
                  }`}
                >
                  IDR (Fiat)
                </button>
                <button
                  type="button"
                  onClick={() => setCurrencyType(1)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    currencyType === 1 ? "bg-white text-[#17332c] shadow-xs" : "text-[#5e7a70]"
                  }`}
                >
                  USDC (Web3)
                </button>
              </div>
            </div>
          </div>

          <Input
            label={currencyType === 0 ? "Nominal Bantuan (IDR)" : "Nominal Bantuan (USDC)"}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            leftAddon={currencyType === 0 ? "Rp" : "USDC"}
            required
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#17332c]">
              Unggah Dokumen Survei & SKTM (PDF / Gambar)
            </label>
            <div className="relative border-2 border-dashed border-[#dbe7dd] rounded-2xl p-4 text-center hover:bg-[#f4f8f3] transition-colors">
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center gap-1 text-xs text-[#5e7a70]">
                <Upload className="w-5 h-5 text-[#1b765e]" />
                <span className="font-semibold text-[#17332c]">
                  {file ? file.name : "Klik atau seret berkas survei mustahik ke sini"}
                </span>
                <span className="text-[10px]">Tersimpan permanen di Pinata IPFS Gateway</span>
              </div>
            </div>
          </div>

          {statusText && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-[#f4f8f3] border border-[#dbe7dd] text-xs text-[#1b765e]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{statusText}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#dbe7dd]/60">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-[#dbe7dd] text-xs font-bold text-[#5e7a70] hover:bg-[#f4f8f3]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#17332c] hover:bg-[#1b765e] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-[#c4ed70]" />}
              <span>Ajukan ke DPS</span>
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
