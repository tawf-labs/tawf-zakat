import { Badge } from "../../components/ui/Badge";
import type { PublicCertificateSummary } from "../../../../shared/certificate-nft";
import { CORRECTION_REASON_LABELS, REPLACEMENT_LABELS, SCOPE_LABELS, VALIDITY_LABELS } from "./certificateLabels";

type Props = {
  certificate: PublicCertificateSummary;
  /** Open one historical version, or the official version again when null. */
  onSelectVersion?: (version: string | null) => void;
  viewingVersion?: string | null;
};

/** Render only the public aggregate; never realization or beneficiary references. */
export function CertificateResult({ certificate: c, onSelectVersion, viewingVersion = null }: Props) {
  const validity = c.validity ? VALIDITY_LABELS[c.validity] : null;
  const history = c.history ?? [];
  return (
    <div className="mt-8 rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3]/80 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-[#17332c]">Sertifikat #{c.tokenId}</h3>
        <Badge variant={c.observation.state === "CONFIRMED" ? "success" : c.observation.state === "REVERTED" ? "danger" : "info"}>{c.observation.state}</Badge>
      </div>
      {validity ? (
        <div role="status" aria-label="Status keberlakuan"
          className={`rounded-xl border p-3 text-xs ${validity.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : validity.tone === "danger" ? "border-red-200 bg-red-50 text-red-900"
              : validity.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-stone-200 bg-stone-100 text-stone-800"}`}>
          <p className="font-semibold">{validity.title}</p>
          <p className="mt-0.5">{validity.detail}</p>
          {c.scope && <p className="mt-1">{SCOPE_LABELS[c.scope.sourceStatus]}{c.scope.disputedCount > 0 ? ` (${c.scope.disputedCount} diperselisihkan)` : ""}.</p>}
          {c.replacement && c.replacement.state !== "NONE" && (
            <p className="mt-1">{REPLACEMENT_LABELS[c.replacement.state]}{c.replacement.version ? ` — versi ${c.replacement.version}` : ""}.</p>
          )}
        </div>
      ) : (
        <p role="status" className="text-xs text-stone-600">Status keberlakuan tidak tersedia dari layanan ini; token saja tidak menunjukkan sertifikat masih berlaku.</p>
      )}
      {c.predecessor && (
        <p className="text-xs text-stone-700">
          Menggantikan versi {c.predecessor.version}{c.predecessor.tokenId ? ` (token #${c.predecessor.tokenId})` : ""}
          {c.correction ? ` · ${CORRECTION_REASON_LABELS[c.correction.reason]}` : ""}.
          {onSelectVersion && (
            <> <button type="button" className="underline" onClick={() => onSelectVersion(c.predecessor!.version)}>Lihat versi {c.predecessor.version}</button></>
          )}
        </p>
      )}
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
      {history.length > 1 && (
        <section aria-label="Riwayat versi" className="space-y-1.5">
          <h4 className="text-[11px] font-semibold uppercase text-[#5e7a70]">Riwayat versi</h4>
          <ul className="space-y-1 text-xs">
            {history.map((h) => (
              <li key={h.version} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#dbe7dd] bg-white px-2.5 py-1.5">
                <span className="font-medium">Versi {h.version}{h.tokenId ? ` · token #${h.tokenId}` : ""}</span>
                <span>{VALIDITY_LABELS[h.validity].title}</span>
                {h.version === c.version
                  ? <span className="text-[#5e7a70]">{viewingVersion ? "(sedang dilihat)" : "(versi resmi terkini)"}</span>
                  : onSelectVersion && <button type="button" className="underline" onClick={() => onSelectVersion(h.version)}>Lihat versi {h.version}</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {viewingVersion && onSelectVersion && (
        <button type="button" className="text-xs underline" onClick={() => onSelectVersion(null)}>Kembali ke versi resmi terkini</button>
      )}
      <p className="text-[11px] text-[#5e7a70]">
        Token ini terkunci pada akun lembaga dan tidak dapat dipindahtangankan atau diperdagangkan.
        Isi sertifikat tidak menampilkan identitas penerima manfaat.
      </p>
    </div>
  );
}
