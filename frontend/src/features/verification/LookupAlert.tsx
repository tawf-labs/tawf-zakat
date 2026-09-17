import { AlertCircle, AlertTriangle } from "lucide-react";

const ALERTS = {
  NOT_FOUND: {
    Icon: AlertCircle,
    tone: "border-rose-200 bg-rose-50/70 text-rose-800",
    title: "Kontribusi Tidak Ditemukan",
    body: "Referensi tersebut tidak tercatat. Periksa kembali nomor transaksi Anda.",
    note: "Sistem tidak membuat catatan atau bukti untuk referensi yang tidak terdaftar.",
  },
  UNAVAILABLE: {
    Icon: AlertTriangle,
    tone: "border-amber-200 bg-amber-50/70 text-amber-900",
    title: "Status Belum Dapat Diperiksa",
    body: "Layanan penelusuran sedang tidak dapat dijangkau, sehingga status kontribusi belum dapat dipastikan.",
    note: "Ini bukan berarti kontribusi Anda hilang atau dibatalkan. Coba lagi beberapa saat lagi.",
  },
} as const;

export function LookupAlert({ status }: { status: keyof typeof ALERTS }) {
  const { Icon, tone, title, body, note } = ALERTS[status];
  return (
    <div role="alert" className={`rounded-3xl border p-6 sm:p-8 space-y-2 animate-in fade-in duration-300 ${tone}`}>
      <div className="flex items-center gap-2.5 font-bold">
        <Icon className="w-5 h-5 shrink-0" />
        <h4 className="font-serif text-lg">{title}</h4>
      </div>
      <p className="text-xs leading-relaxed">{body}</p>
      <p className="text-[11px] opacity-80 pt-1">{note}</p>
    </div>
  );
}
