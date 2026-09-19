import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "../../components/ui/Dialog";
import { getDonorRecoveryStatusByReference, type PublicDonorRecoveryStatus } from "./donorClient";
import { DonorRecoveryForm } from "./DonorRecoveryForm";
import { DonorRecoveryStatus } from "./DonorRecoveryStatus";

export function DonorRecoveryModal({ reference, isOpen, onClose, onRecoveryApproved }: {
  reference: string;
  isOpen: boolean;
  onClose: () => void;
  onRecoveryApproved?: () => void;
}) {
  const [status, setStatus] = useState<PublicDonorRecoveryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newRequest, setNewRequest] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let current = true;
    setLoading(true);
    setNewRequest(false);
    setStatus(null);
    setError(null);
    getDonorRecoveryStatusByReference(reference)
      .then((value) => { if (current) setStatus(value); })
      .catch(() => { if (current) setError("Status permohonan belum dapat diperiksa. Tutup lalu buka kembali untuk mencoba lagi."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [isOpen, reference]);
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[calc(100%-2rem)]" showCloseButton={false}
        onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}>
        <DialogClose aria-label="Tutup jendela pemulihan" className="justify-self-end text-xs">Tutup</DialogClose>
        <DialogTitle>Pemulihan Kontak & Akses Donatur</DialogTitle>
        <DialogDescription>Petugas lembaga akan memeriksa bukti hubungan Anda dengan kontribusi ini sebelum memperbarui kontak pengiriman kode OTP.</DialogDescription>
        {loading ? <p role="status" className="text-xs">Memeriksa status permohonan...</p>
          : error ? <p role="alert" className="text-xs text-rose-800">{error}</p>
          : status && !newRequest ? <DonorRecoveryStatus status={status} onNewRequest={() => setNewRequest(true)}
            onContinue={() => { onRecoveryApproved?.(); onClose(); }} />
          : <DonorRecoveryForm key={reference} reference={reference} onClose={onClose}
            onSubmitted={(value) => { setStatus(value); setNewRequest(false); }} />}
      </DialogContent>
    </Dialog>
  );
}
