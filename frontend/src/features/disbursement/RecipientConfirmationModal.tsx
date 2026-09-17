import { useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import { WorkspaceRequestError, type PrivateRequests } from "../workspace/privateRequests";
import { formatIdrAmount } from "../workspace/mandateLabels";
import {
  issueRealizationOtp,
  verifyBastBySecondOfficer,
  verifyRealizationOtp,
  type DisbursementRealization,
  type Beneficiary,
  type RealizationOtpChallenge,
} from "./disbursementClient";

const failureText = (failure: unknown, fallback: string) =>
  failure instanceof WorkspaceRequestError && failure.status < 500
    ? failure.message
    : `${fallback} Hasilnya belum diketahui; muat ulang status realisasi sebelum mencoba lagi.`;

/**
 * Confirmation of receipt, separate from the officer's realization record. The OTP goes only
 * to the recipient's contact and is read back by the recipient; the officer never sees it.
 * Without OTP, an officer other than the recorder examines the uploaded receipt/BAST.
 */
export function RecipientConfirmationModal({ requests, proposalId, realization, beneficiaryName, beneficiary, isOpen, onClose, onChanged }: {
  requests: PrivateRequests;
  proposalId: string;
  realization: DisbursementRealization;
  beneficiaryName: string;
  beneficiary?: Beneficiary;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const id = useId();
  const [method, setMethod] = useState<"OTP" | "BAST">("OTP");
  const contacts = [beneficiary?.contact?.phone, beneficiary?.contact?.email].filter((value): value is string => Boolean(value));
  const [contact, setContact] = useState(contacts[0] ?? "");
  const [challenge, setChallenge] = useState<RealizationOtpChallenge | null>(null);
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function attempt(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failureText(failure, fallback));
      if (!(failure instanceof WorkspaceRequestError && failure.status < 500)) onChanged();
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () => attempt(async () => {
    setChallenge(await issueRealizationOtp(requests, proposalId, realization.id, contact.trim()));
    setCode("");
  }, "Kode OTP gagal dikirim.");

  const confirmCode = () => attempt(async () => {
    await verifyRealizationOtp(requests, proposalId, realization.id, { nonce: challenge!.nonce, otpCode: code });
    onChanged();
    onClose();
  }, "Verifikasi kode gagal.");

  const confirmBast = () => attempt(async () => {
    await verifyBastBySecondOfficer(requests, proposalId, realization.id, { notes: notes.trim() });
    onChanged();
    onClose();
  }, "Pemeriksaan BAST gagal dicatat.");

  return <Dialog open={isOpen} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" showCloseButton={!busy}>
      <DialogTitle>Konfirmasi penerimaan</DialogTitle>
      <DialogDescription>
        Penyerahan {realization.quantity != null ? `${realization.quantity} ${realization.unit}` : formatIdrAmount(realization.amountIdr ?? "0")} kepada {beneficiaryName}. Konfirmasi ini terpisah dari catatan realisasi petugas.
      </DialogDescription>

      <div role="radiogroup" aria-label="Cara konfirmasi" className="flex flex-col gap-2 text-sm sm:flex-row">
        {([["OTP", "Kode OTP dari penerima"], ["BAST", "BAST diperiksa petugas lain"]] as const).map(([value, label]) =>
          <label key={value} className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2">
            <input type="radio" name={`${id}-method`} checked={method === value} disabled={busy}
              onChange={() => { setMethod(value); setError(null); }} />
            {label}
          </label>)}
      </div>

      {method === "OTP" ? <div className="space-y-3 text-sm">
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void sendCode(); }}>
          <label className="block text-xs font-semibold" htmlFor={`${id}-contact`}>
            Nomor telepon atau email penerima / perwakilan
            <select id={`${id}-contact`} value={contact} disabled={busy}
              className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal" onChange={(event) => setContact(event.target.value)}>
              {!contacts.length && <option value="">Kontak belum tercatat; gunakan BAST</option>}
              {contacts.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <p className="text-xs text-stone-600">Kontak pada versi pengajuan yang disetujui · {beneficiary?.contact?.relation ?? "Hubungan kontak belum tercatat"}</p>
          <Button type="submit" size="sm" variant={challenge ? "outline" : "primary"} disabled={busy || !contact.trim()}>
            {challenge ? "Kirim kode baru" : "Kirim kode ke penerima"}
          </Button>
        </form>

        {challenge && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void confirmCode(); }}>
          <p role="status" className="rounded-md bg-stone-100 px-3 py-2 text-xs">
            Kode dikirim ke {challenge.contactHint}, berlaku sampai {new Date(challenge.expiresAt * 1000).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}.
            Minta penerima membacakan kode hanya jika bantuan sudah diterima.
          </p>
          <label className="block text-xs font-semibold" htmlFor={`${id}-code`}>
            Kode dari penerima (6 digit)
            <input id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy}
              className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-center font-mono text-base tracking-widest"
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
          </label>
          <Button type="submit" size="sm" disabled={busy || code.length !== 6}>Konfirmasi penerimaan</Button>
        </form>}
      </div> : <form className="space-y-2 text-sm" onSubmit={(event) => { event.preventDefault(); void confirmBast(); }}>
        <p className="text-xs text-stone-600">
          Pemeriksa harus petugas selain pencatat realisasi, dan tanda terima/BAST harus sudah diunggah.
        </p>
        <label className="block text-xs font-semibold" htmlFor={`${id}-notes`}>
          Hasil pemeriksaan tanda terima / BAST
          <textarea id={`${id}-notes`} rows={3} value={notes} disabled={busy}
            className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal" onChange={(event) => setNotes(event.target.value)} />
        </label>
        <Button type="submit" size="sm" disabled={busy || !notes.trim()}>Catat pemeriksaan BAST</Button>
      </form>}

      {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    </DialogContent>
  </Dialog>;
}
