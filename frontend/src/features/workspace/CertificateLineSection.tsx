import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { CORRECTION_REASON_LABELS, REPLACEMENT_LABELS, SCOPE_LABELS, VALIDITY_LABELS } from "../certificates/certificateLabels";
import { CORRECTION_REASONS, type CorrectionReason } from "../../../../shared/certificate-nft";
import { prepareCorrection, type CertificateLineStatus } from "./certificateClient";
import type { PrivateRequests } from "./privateRequests";

type Props = {
  requests: PrivateRequests; institutionId: string; activityId: string; certificateId: string;
  line: CertificateLineStatus; viewingVersion: string; disabled: boolean;
  /** Open another version's intent (a prepared successor, or an older version to read). */
  onOpen: (intentId: string) => void;
};

/** Version history of one certificate line, the source drift that would justify a correction, and
 * the form to prepare the next version (#112). Preparing never publishes: the officer still signs. */
export function CertificateLineSection({ requests, institutionId, activityId, certificateId, line, viewingVersion, disabled, onOpen }: Props) {
  const [reason, setReason] = useState<CorrectionReason>("SOURCE_CORRECTION");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bareId = certificateId.split("@")[0]!;
  const viewingHead = viewingVersion === line.headVersion;
  const drift = line.scope && line.scope.sourceStatus !== "MATCHES" ? line.scope : null;

  async function prepare() {
    setBusy(true); setError(null);
    try {
      const status = await prepareCorrection(requests, institutionId, activityId, bareId, reason, note);
      onOpen(status.certificate.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Koreksi ditolak.");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 rounded-lg border border-stone-200 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Versi dan keberlakuan</h4>
      <ul aria-label="Riwayat versi sertifikat" className="space-y-1.5 text-xs">
        {line.versions.map((v) => (
          <li key={v.intentId} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Versi {v.version}{v.tokenId ? ` · token #${v.tokenId}` : v.endorsed ? " · belum ada token" : " · draf belum disahkan"}</span>
            <span>{VALIDITY_LABELS[v.validity].title}</span>
            {v.replacement !== "NONE" && <span className="text-stone-500">{REPLACEMENT_LABELS[v.replacement]}</span>}
            {v.correction && <span className="text-stone-500">{CORRECTION_REASON_LABELS[v.correction.reason]}: {v.correction.note}</span>}
            {v.version !== viewingVersion && (
              <button type="button" className="underline" disabled={disabled} onClick={() => onOpen(v.intentId)}>Buka versi {v.version}</button>
            )}
          </li>
        ))}
      </ul>
      {drift && (
        <p role="alert" className="text-xs text-amber-800">
          {SCOPE_LABELS[drift.sourceStatus]} ({drift.changedCount} berubah, {drift.disputedCount} diperselisihkan).
          Versi resmi terkini tidak ditampilkan berlaku sampai ada pengganti yang terkonfirmasi.
        </p>
      )}
      {line.correctionAllowed && viewingHead && (
        <div className="space-y-2">
          <label className="block text-xs">
            Alasan koreksi
            <select className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" value={reason} disabled={disabled || busy}
              onChange={(event) => setReason(event.target.value as CorrectionReason)}>
              {CORRECTION_REASONS.map((value) => <option key={value} value={value}>{CORRECTION_REASON_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="block text-xs">
            Catatan koreksi
            <textarea className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" rows={2} maxLength={500} value={note}
              disabled={disabled || busy} onChange={(event) => setNote(event.target.value)} />
          </label>
          <Button size="sm" disabled={disabled || busy || !note.trim()} onClick={() => void prepare()}>
            {busy ? "Membekukan versi pengganti…" : "Siapkan versi pengganti"}
          </Button>
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
