import React, { useState, useEffect } from "react";
import { Search, CheckCircle2, AlertCircle, AlertTriangle, Loader2, RefreshCw, Lock, KeyRound, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { computeDonationLeaf, verifyClientProof } from "../../lib/merkleClient";
import { CertificateCard } from "./CertificateCard";
import { MerkleProofDetails } from "./MerkleProofDetails";
import { type Hex } from "viem";
import { toast } from "sonner";
import { getApiBaseUrl } from "../../lib/contracts";

interface SearchReceiptFormProps {
  initialTrxId?: string;
}

type LookupState = "IDLE" | "LOADING" | "FOUND" | "NOT_FOUND" | "UNAVAILABLE";

export function SearchReceiptForm({ initialTrxId = "" }: SearchReceiptFormProps) {
  const [trxId, setTrxId] = useState(initialTrxId);
  const [lookupState, setLookupState] = useState<LookupState>("IDLE");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Public contribution record from server
  const [contributionData, setContributionData] = useState<any>(null);

  // Self-verification inputs (for donors holding personal receipts)
  const [showSelfVerify, setShowSelfVerify] = useState(false);
  const [personalSalt, setPersonalSalt] = useState("");
  const [personalAmount, setPersonalAmount] = useState("");
  const [selfVerifyResult, setSelfVerifyResult] = useState<{
    attempted: boolean;
    isValid: boolean;
    leaf?: Hex;
  } | null>(null);

  // Auto search if initialTrxId provided
  useEffect(() => {
    if (initialTrxId) {
      setTrxId(initialTrxId);
      handleSearch(initialTrxId);
    }
  }, [initialTrxId]);

  const handleSearch = async (searchId: string) => {
    const cleanId = searchId.trim();
    if (!cleanId) {
      toast.error("Masukkan Nomor Transaksi terlebih dahulu.");
      return;
    }

    setLookupState("LOADING");
    setErrorMessage("");
    setContributionData(null);
    setSelfVerifyResult(null);

    try {
      // 1. Fetch public contribution record
      let res: Response;
      try {
        res = await fetch(`${getApiBaseUrl()}/api/public/contributions/${encodeURIComponent(cleanId)}`);
        if (res.status === 404) {
          // Try fallback donation endpoint
          res = await fetch(`${getApiBaseUrl()}/api/donations/${encodeURIComponent(cleanId)}`);
        }
      } catch (networkErr) {
        setLookupState("UNAVAILABLE");
        setErrorMessage("Koneksi ke server verifikasi terputus atau server sedang tidak tersedia. Status belum dapat dipastikan.");
        toast.error("Layanan verifikasi tidak tersedia.");
        return;
      }

      if (res.status === 404) {
        setLookupState("NOT_FOUND");
        setErrorMessage("Transaksi tidak ditemukan. Periksa kembali Nomor Transaksi yang Anda masukkan.");
        toast.error("Transaksi tidak ditemukan.");
        return;
      }

      if (!res.ok) {
        setLookupState("UNAVAILABLE");
        setErrorMessage(`Server mengembalikan respon (${res.status}). Status verifikasi belum dapat dipastikan.`);
        toast.error("Gagal memeriksa transaksi.");
        return;
      }

      const json = await res.json();
      const c = json.contribution || json.donation;

      if (!c) {
        setLookupState("NOT_FOUND");
        setErrorMessage("Data transaksi tidak ditemukan pada buku besar.");
        return;
      }

      setContributionData(c);
      setLookupState("FOUND");
      toast.success("Catatan transaksi ditemukan!");
    } catch (err: any) {
      console.error("Verification lookup error:", err);
      setLookupState("UNAVAILABLE");
      setErrorMessage("Terjadi kesalahan teknis saat menghubungi server verifikasi.");
      toast.error("Gagal memeriksa catatan donasi.");
    }
  };

  const handleSelfVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!personalSalt.trim() || !personalAmount.trim()) {
      toast.error("Masukkan Salt dan Nominal donasi dari kuitansi pribadi Anda.");
      return;
    }

    const numAmount = Number(personalAmount.replace(/[^0-9]/g, ""));
    if (!numAmount || numAmount <= 0) {
      toast.error("Masukkan nominal yang sah.");
      return;
    }

    if (!contributionData) {
      toast.error("Cari transaksi terlebih dahulu.");
      return;
    }

    // Compute leaf hash using canonical Keccak256
    const leaf = computeDonationLeaf(contributionData.trxId, personalSalt.trim(), numAmount);

    // Verify against real root & proof if batch is available
    if (contributionData.merkleRoot && contributionData.proof && contributionData.proof.length > 0) {
      const isValid = verifyClientProof(leaf, contributionData.proof as Hex[], contributionData.merkleRoot as Hex);
      setSelfVerifyResult({
        attempted: true,
        isValid,
        leaf,
      });

      if (isValid) {
        toast.success("Kuitansi Anda cocok persis dengan State Root Merkle Batch L1!");
      } else {
        toast.error("Bukti kuitansi tidak cocok dengan State Root Batch. Periksa salt dan nominal.");
      }
    } else {
      // Batch not settled yet
      setSelfVerifyResult({
        attempted: true,
        isValid: false,
        leaf,
      });
      toast.info("Catatan donasi belum masuk dalam batch ter-settle di smart contract.");
    }
  };

  const handleSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(trxId);
  };

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {/* Search Input Card */}
      <form onSubmit={handleSubmitSearch} className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#17332c]">
            Pencarian Bukti & Status Penunaian Zakat
          </h3>
          <p className="text-xs text-[#5e7a70] mt-1">
            Masukkan Nomor Transaksi resmi untuk memeriksa status pencatatan pada buku besar.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="w-full flex-1">
            <Input
              placeholder="Contoh: TRX-20260824-001 atau USDC-A1B2C3D4"
              value={trxId}
              onChange={(e) => setTrxId(e.target.value)}
              leftAddon={<Search className="w-4 h-4 text-[#5e7a70]" />}
            />
          </div>
          <button
            type="submit"
            disabled={lookupState === "LOADING"}
            className="w-full sm:w-auto px-7 py-3 rounded-xl bg-[#17332c] hover:bg-[#1b765e] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
          >
            {lookupState === "LOADING" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Cek Status</span>
          </button>
        </div>

        <div className="flex items-center justify-between pt-1 text-xs text-[#5e7a70]">
          <span className="flex items-center gap-1.5 text-[11px]">
            <Lock className="w-3.5 h-3.5 text-[#1b765e]" />
            <span>Pencarian Publik Terlindungi (Kerahasiaan Nama & Nominal UU PDP)</span>
          </span>
          <span className="text-[11px]">
            Pencatatan 100% Bebas Biaya Gas
          </span>
        </div>
      </form>

      {/* State: Not Found Alert */}
      {lookupState === "NOT_FOUND" && (
        <div role="alert" className="rounded-3xl border border-rose-200 bg-rose-50/70 p-6 sm:p-8 space-y-2 animate-in fade-in duration-300">
          <div className="flex items-center gap-2.5 text-rose-800 font-bold">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <h4 className="font-serif text-lg">Transaksi Tidak Ditemukan</h4>
          </div>
          <p className="text-xs text-rose-700 leading-relaxed">
            {errorMessage || "Nomor transaksi tersebut tidak ditemukan dalam buku besar. Periksa kembali ID Transaksi yang Anda masukkan."}
          </p>
          <p className="text-[11px] text-rose-600/80 pt-1">
            Catatan: Sistem tidak membuat sertifikat atau bukti baru untuk referensi transaksi yang tidak terdaftar.
          </p>
        </div>
      )}

      {/* State: Service Unavailable Alert */}
      {lookupState === "UNAVAILABLE" && (
        <div role="alert" className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 sm:p-8 space-y-2 animate-in fade-in duration-300">
          <div className="flex items-center gap-2.5 text-amber-900 font-bold">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <h4 className="font-serif text-lg">Layanan Verifikasi Belum Tersedia</h4>
          </div>
          <p className="text-xs text-amber-800 leading-relaxed">
            {errorMessage || "Layanan verifikasi atau koneksi server sedang tidak dapat dijangkau. Status transaksi belum dapat dipastikan."}
          </p>
          <p className="text-[11px] text-amber-700/90 pt-1">
            Pencatatan penerimaan dana tidak dibatalkan. Silakan segarkan halaman atau coba beberapa saat lagi.
          </p>
        </div>
      )}

      {/* State: Found Result */}
      {lookupState === "FOUND" && contributionData && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Certificate Card */}
          <CertificateCard
            receipt={{
              trxId: contributionData.trxId,
              donorName: selfVerifyResult?.isValid ? "Muzakki (Terverifikasi)" : null,
              isAnonymous: !selfVerifyResult?.isValid,
              amountIDR: selfVerifyResult?.isValid ? Number(personalAmount.replace(/[^0-9]/g, "")) : null,
              zakatType: contributionData.zakatType || "Zakat Maal & Harta",
              paidAt: contributionData.paidAt || contributionData.timestamp,
              batchId: contributionData.batchId,
              status: contributionData.status,
              isSelfVerified: selfVerifyResult?.isValid,
              limitations: contributionData.limitations,
            }}
          />

          {/* Merkle Proof Details Accordion */}
          <MerkleProofDetails
            leaf={selfVerifyResult?.leaf || null}
            merkleRoot={contributionData.merkleRoot}
            proof={contributionData.proof}
            batchId={contributionData.batchId}
            isVerified={selfVerifyResult ? selfVerifyResult.isValid : null}
            proofType={contributionData.proofType || "MERKLE_TREE"}
            zkStatus={contributionData.zkStatus || "PENDING"}
          />

          {/* Optional Interactive Self-Verification Panel for Donor */}
          <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs space-y-5">
            <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowSelfVerify(!showSelfVerify)}>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[#1b765e]" />
                  <h4 className="font-serif text-base font-bold text-[#17332c]">
                    Verifikasi Matematis Kuitansi Mandiri (Khusus Pemilik Donasi)
                  </h4>
                </div>
                <p className="text-xs text-[#5e7a70]">
                  Punya Salt dan Nominal dari kuitansi pembayaran? Masukkan untuk membuktikan keaslian kuitansi Anda secara lokal tanpa membuka data ke publik.
                </p>
              </div>
              <button type="button" className="p-2 text-[#5e7a70] hover:text-[#17332c]">
                {showSelfVerify ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </div>

            {showSelfVerify && (
              <form onSubmit={handleSelfVerify} className="space-y-4 pt-2 border-t border-[#dbe7dd]/60">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-[#17332c] block mb-1">
                      Salt Kuitansi Pribadi
                    </label>
                    <Input
                      placeholder="Contoh: salt_budi_123"
                      value={personalSalt}
                      onChange={(e) => setPersonalSalt(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#17332c] block mb-1">
                      Nominal Donasi (IDR)
                    </label>
                    <Input
                      placeholder="Contoh: 2500000"
                      value={personalAmount}
                      onChange={(e) => setPersonalAmount(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-[#5e7a70]">
                    Pemeriksaan dihitung langsung di browser Anda menggunakan formula Keccak256
                  </span>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-[#1b765e] hover:bg-[#17332c] text-white text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Cocokkan Kuitansi</span>
                  </button>
                </div>

                {selfVerifyResult && (
                  <div className={`p-3.5 rounded-xl border text-xs ${selfVerifyResult.isValid ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-red-50 border-red-200 text-red-900"}`}>
                    <p className="font-bold flex items-center gap-1.5">
                      {selfVerifyResult.isValid ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>Kuitansi Terbukti Sah (100% Cocok dengan State Root L1)</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                          <span>Kuitansi Tidak Cocok dengan State Root Batch</span>
                        </>
                      )}
                    </p>
                    <p className="text-[11px] mt-1">
                      {selfVerifyResult.isValid
                        ? "Salt dan nominal yang Anda masukkan menghasilkan Leaf Hash yang terbukti secara matematis ada dalam Batch Root L1."
                        : "Leaf hash yang dihasilkan berbeda dari pohon Merkle batch ini. Pastikan salt dan nominal sesuai dengan saat akad pembayaran."}
                    </p>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
