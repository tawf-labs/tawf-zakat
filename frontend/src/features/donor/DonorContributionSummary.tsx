import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  Clock,
  Copy,
  Check,
} from "lucide-react";
import {
  JENIS_DANA_LIST,
  SOURCE_CHANNELS,
  STATUS_MEANINGS,
  formatNominal,
  type ContributionStatus,
} from "../contributions/contributionClient";
import {
  getPublicReceiptVerification,
  type DonorContribution,
  type DonorZkProofStatus,
  type PublicReceiptVerification,
} from "./donorClient";

const STATUS_LABELS: Record<ContributionStatus, string> = {
  RECEIVED: "Diterima Lembaga",
  RECONCILED: "Dicocokkan dengan Bukti Lembaga",
  ENDORSED: "Disahkan Lembaga",
  REJECTED: "Ditolak",
};

const PROOF_STATUS_TEXT: Record<DonorZkProofStatus, string> = {
  UNCONFIRMED: "Hasil historis tersimpan, tetapi pemeriksaan EVM saat ini belum dapat mengonfirmasi bukti. Coba periksa kembali.",
  NOT_AVAILABLE:
    "Belum tersedia. Bukti keanggotaan kriptografis baru diterbitkan setelah batch kontribusi disahkan lembaga dan dibuktikan; sampai saat itu tidak ada bukti yang ditampilkan.",
  PENDING:
    "Menunggu pembuktian. Kontribusi telah masuk dalam batch terdaftar dan sedang dalam antrean pemrosesan bukti Zero-Knowledge.",
  PROVING:
    "Sedang dibuktikan. Prover sedang menghasilkan bukti kriptografis Groth16 (BN254).",
  VERIFIED:
    "Terverifikasi on-chain. Bukti keanggotaan Zero-Knowledge Groth16 telah diverifikasi oleh Solidity verifier dan tercatat permanen di smart contract EVM.",
  FAILED:
    "Gagal diverifikasi. Eksekusi verifier on-chain atau kalkulasi prover tidak berhasil.",
  SUPERSEDED:
    "Tergantikan. Versi kontribusi ini telah digantikan oleh koreksi terbaru.",
};

const PROOF_BADGE_CONFIG: Record<
  DonorZkProofStatus,
  { label: string; bg: string; border: string; text: string; icon: any }
> = {
  UNCONFIRMED: { label: "Belum Terkonfirmasi Saat Ini", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", icon: AlertCircle },
  VERIFIED: {
    label: "Terverifikasi ZK On-Chain (Groth16)",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-800",
    icon: ShieldCheck,
  },
  PROVING: {
    label: "Sedang Dibuktikan ZK",
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-800",
    icon: RefreshCw,
  },
  PENDING: {
    label: "Menunggu Proof ZK",
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-800",
    icon: Clock,
  },
  FAILED: {
    label: "Verifikasi Gagal",
    bg: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-800",
    icon: AlertCircle,
  },
  SUPERSEDED: {
    label: "Proof Versi Lama",
    bg: "bg-gray-50",
    border: "border-gray-200",
    text: "text-gray-700",
    icon: Clock,
  },
  NOT_AVAILABLE: {
    label: "Bukti ZK Belum Tersedia",
    bg: "bg-[#f4f8f3]/60",
    border: "border-tawf-green-10",
    text: "text-tawf-muted",
    icon: AlertCircle,
  },
};

const labelOf = <T extends string>(list: { value: T; label: string }[], value: T) =>
  list.find((item) => item.value === value)?.label ?? value;

const formatDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function TruncatedHash({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white/80 border border-tawf-green-10 text-xs">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase text-tawf-muted">{label}</p>
        <p className="font-mono text-xs text-tawf-green truncate select-all">{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        title={`Salin ${label}`}
        aria-label={`Salin ${label}`}
        className="p-1.5 rounded-lg border border-tawf-green-10 hover:bg-[#1b765e]/5 text-tawf-green transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-tawf-muted" />}
      </button>
    </div>
  );
}

export function DonorContributionSummary({ contribution }: { contribution: DonorContribution }) {
  const rejected = contribution.status === "REJECTED";
  const [liveCheck, setLiveCheck] = useState<PublicReceiptVerification | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const receiptKey = `${contribution.id}:${contribution.version}`;
  const currentKey = useRef(receiptKey);
  currentKey.current = receiptKey;
  const [checkError, setCheckError] = useState<string | null>(null);
  useEffect(() => { setLiveCheck(null); setCheckError(null); }, [contribution.id, contribution.version]);
  const currentProof = liveCheck || contribution.zkProof;
  const proofConfig = PROOF_BADGE_CONFIG[currentProof.status];
  const ProofIcon = proofConfig.icon;

  const handleRepeatCheck = async () => {
    setIsChecking(true);
    setCheckError(null);
    try {
      const res = await getPublicReceiptVerification(contribution.id);
      if (currentKey.current !== receiptKey) return;
      if (res) {
        setLiveCheck(res);
        if (res.status === "UNCONFIRMED") setCheckError("Hasil historis tersimpan; pemeriksaan EVM saat ini belum terkonfirmasi.");
      } else {
        setCheckError("Pemeriksaan belum tersedia. Coba lagi nanti.");
      }
    } finally {
      setIsChecking(false);
    }
  };

  const fields: [string, string, string?][] = [
    ["Nama Donatur", contribution.donorName || "Tidak dicantumkan"],
    ["Jenis Dana", labelOf(JENIS_DANA_LIST, contribution.fundType), contribution.purpose || undefined],
    ["Referensi", contribution.sourceReference, labelOf(SOURCE_CHANNELS, contribution.sourceChannel)],
    ["Diterima", formatDate(contribution.receivedAt)],
  ];

  return (
    <section aria-labelledby="donor-contribution-heading" className="rounded-3xl border border-tawf-green-10 bg-white p-6 sm:p-8 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-tawf-green-10 pb-6">
        <div>
          <h3 id="donor-contribution-heading" className="text-xs font-semibold text-tawf-muted uppercase tracking-wider">
            Kontribusi Anda
          </h3>
          <p className="font-serif text-2xl font-bold text-tawf-green mt-1">
            {formatNominal(contribution.amountExact, contribution.currencyUnit)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div
            className={`px-3.5 py-1.5 rounded-full border text-xs font-semibold ${
              rejected ? "border-red-200 bg-red-50 text-red-800" : "border-[#1b765e]/20 bg-[#1b765e]/10 text-tawf-green-light"
            }`}
          >
            {STATUS_LABELS[contribution.status]}
          </div>
          <div
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold ${proofConfig.bg} ${proofConfig.border} ${proofConfig.text}`}
          >
            <ProofIcon className={`w-3.5 h-3.5 ${currentProof.status === "PROVING" ? "animate-spin" : ""}`} />
            <span>{proofConfig.label}</span>
          </div>
        </div>
      </div>
      <p className="text-xs text-tawf-muted">{STATUS_MEANINGS[contribution.status]}</p>

      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {fields.map(([label, value, detail]) => (
          <div key={label} className="p-4 rounded-2xl bg-[#f4f8f3]/60 border border-tawf-green-10">
            <dt className="text-[11px] font-semibold text-tawf-muted uppercase tracking-wider">{label}</dt>
            <dd className="text-sm font-bold text-tawf-green mt-0.5 break-words">{value}</dd>
            {detail && <dd className="text-xs text-tawf-muted line-clamp-2">{detail}</dd>}
          </div>
        ))}
      </dl>

      <section aria-label="Riwayat koreksi kontribusi" className="space-y-3">
        <h4 className="text-sm font-semibold text-tawf-green">Riwayat Kontribusi · Versi {contribution.version}</h4>
        {contribution.corrections.length === 0 && <p className="text-xs text-tawf-muted">Belum ada koreksi.</p>}
        {contribution.corrections.map(correction => (
          <div key={correction.toVersion} className="rounded-xl border border-tawf-green-10 p-3 text-sm space-y-1">
            <p className="font-semibold text-tawf-green">Versi {correction.fromVersion} → {correction.toVersion} · {formatDate(correction.createdAt)}</p>
            <p className="text-xs text-tawf-muted">{formatNominal(correction.fromAmountExact, contribution.currencyUnit)} → {formatNominal(correction.toAmountExact, contribution.currencyUnit)}</p>
            {correction.correctionType === "DUPLICATE" && <p className="text-xs text-amber-700">Catatan ganda dikeluarkan dari pendanaan; nominal historis tetap tersimpan.</p>}
            <p className="text-xs text-tawf-muted">Alasan: {correction.reason}</p>
          </div>
        ))}
      </section>

      {checkError && <p role="alert" className="text-sm text-amber-800">{checkError}</p>}
      <p className="text-xs text-tawf-muted">Klaim: catatan kontribusi termasuk batch yang disahkan lembaga. Ini tidak membuktikan pembayaran bank atau penyerahan bantuan.</p>
      {/* Technical ZK Proof Accordion */}
      <details className="group rounded-2xl border border-tawf-green-10 bg-[#f4f8f3]/60 overflow-hidden" open={currentProof.status === "VERIFIED"}>
        <summary className="cursor-pointer list-none p-4 flex items-center justify-between text-xs font-semibold text-tawf-green hover:bg-[#1b765e]/5 transition-colors">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-tawf-green" />
            <span>Rincian Teknis Pembuktian Kriptografis (ZK Groth16 EVM)</span>
          </div>
          <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180 text-tawf-muted" aria-hidden />
        </summary>
        <div className="p-4 pt-0 space-y-4 text-xs">
          <div className="p-3 rounded-xl bg-white/70 border border-tawf-green-10 text-tawf-muted leading-relaxed">
            <p className="font-medium text-tawf-green mb-1">
              Status Bukti: <span className="font-semibold">{proofConfig.label}</span>
            </p>
            <p>{PROOF_STATUS_TEXT[currentProof.status]}</p>
          </div>

          {currentProof.status === "VERIFIED" && (
            <div className="space-y-2.5">
              {currentProof.batchRoot && (
                <TruncatedHash value={currentProof.batchRoot} label="Merkle Batch Root (Poseidon)" />
              )}
              {currentProof.receiptCommitment && (
                <TruncatedHash value={currentProof.receiptCommitment} label="Komitmen Tanda Terima (Receipt Commitment)" />
              )}
              {currentProof.txHash && (
                <TruncatedHash value={currentProof.txHash} label="Transaksi EVM On-Chain (TxHash)" />
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                {currentProof.batchNumber !== undefined && (
                  <div className="p-2.5 rounded-xl bg-white/80 border border-tawf-green-10">
                    <span className="text-tawf-muted block">Nomor Batch</span>
                    <span className="font-semibold text-tawf-green">Batch #{currentProof.batchNumber}</span>
                  </div>
                )}
                {currentProof.blockNumber && (
                  <div className="p-2.5 rounded-xl bg-white/80 border border-tawf-green-10">
                    <span className="text-tawf-muted block">Blok EVM</span>
                    <span className="font-semibold text-tawf-green">#{currentProof.blockNumber}</span>
                  </div>
                )}
                {currentProof.verifiedAt && (
                  <div className="p-2.5 rounded-xl bg-white/80 border border-tawf-green-10 col-span-2 sm:col-span-1">
                    <span className="text-tawf-muted block">Waktu Verifikasi</span>
                    <span className="font-semibold text-tawf-green">{formatDate(currentProof.verifiedAt)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-tawf-green-10 text-[11px]">
            <span className="text-tawf-muted">
              Pemeriksaan ulang status dilakukan tanpa biaya gas (zero-cost view call).
            </span>
            <button
              type="button"
              onClick={handleRepeatCheck}
              disabled={isChecking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-tawf-green-10 bg-white hover:bg-[#1b765e]/5 text-tawf-green font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isChecking ? "animate-spin" : ""}`} />
              <span>{isChecking ? "Memeriksa..." : "Verifikasi Ulang On-Chain"}</span>
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
