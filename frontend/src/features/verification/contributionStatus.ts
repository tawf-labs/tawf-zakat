import { Clock, CheckCircle2, Layers, XCircle, type LucideIcon } from "lucide-react";
import type { PublicContributionStatus } from "./contributionApi";

interface StatusBadge {
  Icon: LucideIcon;
  label: string;
  tone: string;
  explanation: string;
}

export const STATUS_BADGES: Record<PublicContributionStatus, StatusBadge> = {
  PENDING: {
    Icon: Clock,
    label: "Menunggu Pembayaran",
    tone: "bg-amber-50 border-amber-200 text-amber-800",
    explanation: "Referensi ini tercatat, tetapi pembayarannya belum diterima. Catatan ini belum menjadi bukti penunaian.",
  },
  PAID: {
    Icon: CheckCircle2,
    label: "Pembayaran Tercatat",
    tone: "bg-blue-50 border-blue-200 text-blue-800",
    explanation: "Pembayaran untuk referensi ini sudah tercatat dan menunggu dimasukkan ke batch penerimaan.",
  },
  BATCHED: {
    Icon: Layers,
    label: "Masuk Batch Penerimaan",
    tone: "bg-emerald-50 border-emerald-200 text-emerald-800",
    explanation: "Pembayaran untuk referensi ini sudah tercatat dan dimasukkan ke batch penerimaan.",
  },
  RECEIVED: {
    Icon: CheckCircle2,
    label: "Diterima Lembaga",
    tone: "bg-blue-50 border-blue-200 text-blue-800",
    explanation: "Lembaga mencatat penerimaan kontribusi ini; pencocokan dengan bukti sumber lembaga belum dilakukan.",
  },
  RECONCILED: {
    Icon: CheckCircle2,
    label: "Dicocokkan Lembaga",
    tone: "bg-blue-50 border-blue-200 text-blue-800",
    explanation: "Kontribusi ini sudah dicocokkan dengan bukti sumber lembaga dan menunggu pengesahan.",
  },
  ENDORSED: {
    Icon: CheckCircle2,
    label: "Disahkan Lembaga",
    tone: "bg-emerald-50 border-emerald-200 text-emerald-800",
    explanation: "Kontribusi ini disahkan pihak berwenang lembaga. Bukti batch kriptografis belum diterbitkan.",
  },
  REJECTED: {
    Icon: XCircle,
    label: "Ditolak Lembaga",
    tone: "bg-red-50 border-red-200 text-red-800",
    explanation: "Lembaga menolak catatan ini karena sumbernya tidak terverifikasi atau tidak sah. Catatan ini bukan bukti penunaian.",
  },
};
