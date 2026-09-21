import { Badge } from "../../components/ui/Badge";
import type { PublicCertificateSummary } from "../../../../shared/certificate-nft";

/** Render only the public aggregate; never realization or beneficiary references. */
export function CertificateResult({ certificate: c }: { certificate: PublicCertificateSummary }) {
  return (
    <div className="mt-8 rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3]/80 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-[#17332c]">Sertifikat #{c.tokenId}</h3>
        <Badge variant={c.observation.state === "CONFIRMED" ? "success" : c.observation.state === "REVERTED" ? "danger" : "info"}>{c.observation.state}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-2.5 text-xs sm:grid-cols-3">
        <div className="rounded-xl border border-[#dbe7dd] bg-white p-2.5">
          <span className="text-[10px] font-semibold uppercase text-[#5e7a70]">Terkonfirmasi</span>
          <p className="mt-0.5 font-bold text-emerald-700">{c.totals.confirmedCount}</p>
        </div>
        <div className="rounded-xl border border-[#dbe7dd] bg-white p-2.5">
          <span className="text-[10px] font-semibold uppercase text-[#5e7a70]">Belum terkonfirmasi</span>
          <p className="mt-0.5 font-bold text-amber-700">{c.totals.unconfirmedCount}</p>
        </div>
        <div className="rounded-xl border border-[#dbe7dd] bg-white p-2.5">
          <span className="text-[10px] font-semibold uppercase text-[#5e7a70]">Diperselisihkan</span>
          <p className="mt-0.5 font-bold text-red-700">{c.totals.disputedCount}</p>
        </div>
      </div>
      <p className="break-all font-mono text-[11px] text-[#5e7a70]">
        Lembaga {c.institutionId} · Kegiatan {c.activityId} · Versi {c.version}<br />
        Penerbit {c.issuer}<br />
        Akun pemegang (lembaga) {c.custodian}<br />
        Keterikatan isi {c.contentDigest}
      </p>
      <p className="text-[11px] text-[#5e7a70]">
        Token ini terkunci pada akun lembaga dan tidak dapat dipindahtangankan atau diperdagangkan.
        Isi sertifikat tidak menampilkan identitas penerima manfaat.
      </p>
    </div>
  );
}
