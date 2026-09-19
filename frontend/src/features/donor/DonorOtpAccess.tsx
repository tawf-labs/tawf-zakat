import React, { useState, useEffect } from "react";
import { KeyRound, Loader2, Send, ShieldCheck, AlertCircle, RefreshCw } from "lucide-react";
import { requestDonorOtp, verifyDonorOtp, saveDonorSession } from "./donorClient";

interface DonorOtpAccessProps {
  contributionId: string;
  hasContact: boolean;
  initialContactMasked?: string | null;
  onAuthenticated: (sessionToken: string) => void;
}

export function DonorOtpAccess({
  contributionId,
  hasContact,
  initialContactMasked,
  onAuthenticated,
}: DonorOtpAccessProps) {
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [contactMasked, setContactMasked] = useState<string>(initialContactMasked || "");
  const [otpCode, setOtpCode] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSendOtp = async () => {
    if (cooldown > 0 || isRequesting) return;
    setIsRequesting(true);
    setErrorMsg(null);

    const res = await requestDonorOtp(contributionId);
    setIsRequesting(false);

    if (!res.success) {
      setErrorMsg(res.error || "Gagal mengirim kode OTP.");
      return;
    }

    setChallengeId(res.challengeId || null);
    if (res.contactMasked) {
      setContactMasked(res.contactMasked);
    }
    setCooldown(60); // 60 detik cooldown
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeId || otpCode.trim().length !== 6 || isVerifying) return;

    setIsVerifying(true);
    setErrorMsg(null);

    const res = await verifyDonorOtp(challengeId, otpCode.trim());
    setIsVerifying(false);

    if (!res.success || !res.sessionToken) {
      setErrorMsg(res.error || "Kode OTP tidak sah.");
      return;
    }

    saveDonorSession(contributionId, res.sessionToken);
    onAuthenticated(res.sessionToken);
  };

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-gradient-to-br from-white to-[#f4f8f3]/50 p-6 sm:p-8 shadow-sm space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-2xl bg-[#1b765e]/10 border border-[#1b765e]/20 flex items-center justify-center shrink-0 text-[#1b765e]">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-serif text-lg font-bold text-[#17332c]">
            Akses Rincian Donatur (Tanpa Akun)
          </h4>
          <p className="text-xs text-[#5e7a70] mt-1 leading-relaxed">
            Anda tidak perlu mendaftar akun atau menghubungkan dompet digital. Masukkan kode verifikasi satu kali (OTP) yang dikirimkan ke kontak Anda untuk membuka riwayat donasi pribadi dan alokasi ke kegiatan penyaluran.
          </p>
        </div>
      </div>

      {!hasContact ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <span className="font-semibold block">Kontak Belum Terdaftar</span>
            Catatan kontribusi ini belum memiliki kontak aktif untuk pengiriman OTP. Untuk membuka rincian pribadi, Anda dapat mengajukan pemulihan kontak kepada amil lembaga pengelola dengan bukti transaksi.
          </div>
        </div>
      ) : !challengeId ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#f4f8f3] border border-[#dbe7dd] p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold text-[#5e7a70] uppercase tracking-wider block">
                Tujuan Pengiriman
              </span>
              <span className="text-sm font-mono font-bold text-[#17332c]">
                {contactMasked || "Kontak Terdaftar"}
              </span>
            </div>

            <button
              type="button"
              onClick={handleSendOtp}
              disabled={isRequesting || cooldown > 0}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#17332c] hover:bg-[#1b765e] disabled:opacity-50 text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              {isRequesting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Mengirim Kode...</span>
                </>
              ) : cooldown > 0 ? (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>Kirim Ulang ({cooldown}s)</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Kirim Kode OTP</span>
                </>
              )}
            </button>
          </div>

          <p className="text-[11px] text-[#5e7a70] flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#1b765e]" />
            <span>Pesan verifikasi hanya memuat 6 digit kode dan masa berlaku 15 menit.</span>
          </p>
        </div>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <div className="rounded-2xl bg-[#f4f8f3] border border-[#dbe7dd] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#17332c]">
                Masukkan 6 digit kode OTP yang dikirim ke <span className="font-mono font-bold">{contactMasked}</span>
              </span>
              {cooldown > 0 ? (
                <span className="text-[11px] text-[#5e7a70]">Kirim ulang dalam {cooldown}s</span>
              ) : (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={isRequesting}
                  className="text-[11px] font-bold text-[#1b765e] hover:underline cursor-pointer flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Kirim Ulang</span>
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                placeholder="123456"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                className="w-full text-center tracking-[0.4em] font-mono text-xl font-bold bg-white border border-[#dbe7dd] rounded-xl px-4 py-2.5 text-[#17332c] focus:outline-hidden focus:ring-2 focus:ring-[#1b765e]"
              />

              <button
                type="submit"
                disabled={otpCode.length !== 6 || isVerifying}
                className="px-6 py-2.5 rounded-xl bg-[#17332c] hover:bg-[#1b765e] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
              >
                {isVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>Verifikasi</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}
