import { useState } from "react";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import { requestDonorOtp, verifyDonorOtp, type DonorOtpChallenge, type DonorSessionRecord } from "./donorClient";
import { useCountdown } from "./useCountdown";
import { Notice } from "./DonorNotice";

const PILL_PRIMARY =
  "px-6 py-2.5 rounded-full bg-tawf-green hover:bg-tawf-green-light disabled:opacity-50 text-tawf-sand text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer";

type DonorOtpFormProps = {
  reference: string;
  onAuthenticated: (session: DonorSessionRecord) => void;
};

/** Request a code, then enter it. The code itself never touches the URL. */
export function DonorOtpForm({ reference, onAuthenticated }: DonorOtpFormProps) {
  const [challenge, setChallenge] = useState<DonorOtpChallenge | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [busy, setBusy] = useState<"request" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCountdown(retryAt);

  const handleRequest = async () => {
    if (cooldown > 0 || busy) return;
    setBusy("request");
    setError(null);
    const result = await requestDonorOtp(reference);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      if (result.retryAt) setRetryAt(result.retryAt);
      return;
    }
    setChallenge(result);
    setOtpCode("");
    setRetryAt(result.resendAvailableAt);
  };

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challenge || otpCode.length !== 6 || busy) return;
    setBusy("verify");
    setError(null);
    const result = await verifyDonorOtp(challenge.challengeId, otpCode);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAuthenticated({ token: result.sessionToken, contributionId: result.contributionId, expiresAt: result.expiresAt });
  };

  const resendLabel = cooldown > 0 ? `Kirim ulang dalam ${cooldown} detik` : challenge ? "Kirim Ulang Kode" : "Kirim Kode OTP";

  return (
    <div className="space-y-4">
      {/* Kirim dan verifikasi tampil sekaligus: kode baru aktif setelah "Kirim", tapi
          kolomnya tidak disembunyikan menunggu klik itu lebih dulu. */}
      <form onSubmit={handleVerify} className="rounded-2xl bg-[#f4f8f3] border border-tawf-green-10 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <label htmlFor="donor-otp-code" className="text-xs font-medium text-tawf-green">
            {challenge ? "Masukkan 6 digit kode yang dikirim ke kontak terdaftar" : "Klik “Kirim Kode OTP” untuk menerima kode di kontak terdaftar"}
          </label>
          <button
            type="button"
            onClick={handleRequest}
            disabled={busy !== null || cooldown > 0}
            className="text-[11px] font-bold text-tawf-green-light hover:underline disabled:no-underline disabled:opacity-60 cursor-pointer flex items-center gap-1"
          >
            {busy === "request" ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <Send className="w-3 h-3" aria-hidden />}
            <span>{resendLabel}</span>
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="donor-otp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            disabled={!challenge}
            placeholder={challenge ? undefined : "------"}
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
            className="w-full text-center tracking-[0.4em] font-mono text-xl font-bold bg-white border border-tawf-green-10 rounded-full px-4 py-2.5 text-tawf-green focus:outline-hidden focus:ring-2 focus:ring-[#1b765e] disabled:bg-[#eef2ef] disabled:text-tawf-muted"
          />
          <button type="submit" disabled={!challenge || otpCode.length !== 6 || busy !== null} className={`shrink-0 ${PILL_PRIMARY}`}>
            {busy === "verify" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <ShieldCheck className="w-4 h-4" aria-hidden />}
            <span>Verifikasi</span>
          </button>
        </div>
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      <p className="text-[11px] text-tawf-muted flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
        <span>Pesan verifikasi hanya memuat kode dan masa berlakunya, tanpa nama atau nominal.</span>
      </p>
    </div>
  );
}
