import { useState } from "react";
import { HelpCircle, KeyRound, Loader2 } from "lucide-react";
import { Notice } from "./DonorNotice";
import type { DonorSessionRecord } from "./donorClient";
import { useDonorChannel } from "./donorQueries";
import { DonorOtpForm } from "./DonorOtpForm";
import { DonorRecoveryModal } from "./DonorRecoveryModal";

type DonorOtpAccessProps = {
  reference: string;
  /** Why a previous session is no longer open, if it ended. */
  notice: string | null;
  onAuthenticated: (session: DonorSessionRecord) => void;
};

/**
 * Entry to a donor's private detail. The send button only appears when this
 * deployment has a delivery channel; otherwise the page says so rather than
 * offering a code that cannot arrive.
 */
export function DonorOtpAccess({ reference, notice, onAuthenticated }: DonorOtpAccessProps) {
  const channel = useDonorChannel();
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  return (
    <section
      aria-labelledby="donor-access-heading"
      className="rounded-3xl border border-tawf-green-10 bg-white p-6 sm:p-8 shadow-sm space-y-6"
    >
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-2xl bg-[#1b765e]/10 flex items-center justify-center shrink-0 text-tawf-green">
          <KeyRound className="w-5 h-5" aria-hidden />
        </div>
        <div>
          <h4 id="donor-access-heading" className="font-serif text-lg font-bold text-tawf-green">
            Akses Rincian Donatur (Tanpa Akun)
          </h4>
          <p className="text-xs text-tawf-muted mt-1 leading-relaxed">
            Tidak perlu mendaftar akun atau menghubungkan dompet digital. Kode sekali pakai dikirim ke kontak
            yang tercatat pada kontribusi ini, dan hanya membuka kontribusi ini saja.
          </p>
        </div>
      </div>

      {notice && <Notice tone="info">{notice}</Notice>}

      {channel.isPending ? (
        <p className="text-xs text-tawf-muted flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Memeriksa layanan pengiriman kode...
        </p>
      ) : channel.isError ? (
        <Notice tone="warning">
          Layanan pengiriman kode belum dapat diperiksa. Coba lagi beberapa saat lagi.
        </Notice>
      ) : !channel.data ? (
        <Notice tone="warning">
          Pengiriman kode OTP belum tersedia pada layanan ini. Untuk melihat rincian kontribusi, hubungi amil
          lembaga yang mencatat kontribusi Anda.
        </Notice>
      ) : (
        <DonorOtpForm reference={reference} onAuthenticated={onAuthenticated} />
      )}

      <div className="pt-2 border-t border-tawf-green-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
        <span className="text-tawf-muted">
          Kontak belum terdaftar atau tidak dapat menerima kode?
        </span>
        <button
          type="button"
          onClick={() => setRecoveryOpen(true)}
          className="font-semibold text-tawf-green hover:text-tawf-green-light underline inline-flex items-center gap-1 cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" aria-hidden />
          <span>Ajukan Pemulihan Kontak & Akses</span>
        </button>
      </div>

      <DonorRecoveryModal
        reference={reference}
        isOpen={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
      />
    </section>
  );
}

