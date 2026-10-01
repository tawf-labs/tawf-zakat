import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, FileText } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import {
  downloadDecisionDocument,
  getProposalClosure,
  getProposalDecision,
  type ProposalClosureRecord,
  type ProposalDecision,
  type ProposalDraft,
} from "./disbursementClient";
import { formatIdrAmount } from "../workspace/mandateLabels";

/** The four terminal outcomes, each read on its own terms rather than one shared "awaiting" label. */
const DECIDED_PRESENTATION = {
  APPROVED: {
    tone: "border-emerald-400 bg-emerald-50 text-emerald-950",
    Icon: CheckCircle2,
    title: "Pengajuan disetujui lembaga",
    reasonLabel: "Catatan persetujuan",
  },
  REJECTED: {
    tone: "border-red-400 bg-red-50 text-red-950",
    Icon: XCircle,
    title: "Pengajuan ditolak lembaga",
    reasonLabel: "Alasan penolakan",
  },
  CANCELLED: {
    tone: "border-stone-400 bg-stone-100 text-stone-900",
    Icon: AlertTriangle,
    title: "Pengajuan dibatalkan lembaga",
    reasonLabel: "Alasan pembatalan",
  },
  REMAINDER_CLOSED: {
    tone: "border-amber-400 bg-amber-50 text-amber-950",
    Icon: FileText,
    title: "Sisa hak pengajuan ditutup lembaga",
    reasonLabel: "Alasan penutupan sisa",
  },
} as const;

type DecidedStatus = keyof typeof DECIDED_PRESENTATION;

const isDecidedStatus = (status: string): status is DecidedStatus => status in DECIDED_PRESENTATION;

/** The durable decision behind an approved, rejected, cancelled, or closed proposal. */
export function ProposalDecisionBanner({ requests, draft, recorded }: {
  requests: PrivateRequests;
  draft: Pick<ProposalDraft, "id" | "status">;
  recorded: ProposalDecision | null;
}) {
  const [loaded, setLoaded] = useState<ProposalDecision | null>(null);
  const [closure, setClosure] = useState<ProposalClosureRecord | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const decided = isDecidedStatus(draft.status);

  useEffect(() => {
    if (!decided) return;
    let current = true;
    if (!recorded) {
      getProposalDecision(requests, draft.id)
        .then(({ decision }) => { if (current) setLoaded(decision); })
        .catch(() => { if (current) setLoaded(null); });
    }
    if (draft.status === "REMAINDER_CLOSED") {
      getProposalClosure(requests, draft.id)
        .then((data) => { if (current) setClosure(data); })
        .catch(() => { if (current) setClosure(null); });
    }
    return () => { current = false; };
  }, [requests, draft.id, decided, recorded, draft.status]);

  async function download(decision: ProposalDecision) {
    if (!decision.decisionDocumentId) return;
    try {
      const url = URL.createObjectURL(await downloadDecisionDocument(requests, draft.id, decision.decisionDocumentId));
      requests.assertCurrent();
      const link = document.createElement("a");
      link.href = url;
      link.download = `keputusan-${decision.decisionReference}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("Berkas keputusan tidak dapat diunduh atau tidak cocok dengan hash yang ditandatangani.");
    }
  }

  if (!isDecidedStatus(draft.status)) return null;
  const decision = recorded ?? loaded;
  const { tone, Icon, reasonLabel } = DECIDED_PRESENTATION[draft.status];
  // Published on the institution's own internal decision (ADR-0041): nothing was signed here.
  const outside = decision?.basis === "RECORDED_OUTSIDE_APP";
  const title = outside && draft.status === "APPROVED"
    ? "Pengajuan terbit atas keputusan internal lembaga · siap disalurkan"
    : DECIDED_PRESENTATION[draft.status].title;

  return <div className={`space-y-2 rounded-xl border p-4 text-xs ${tone}`}>
    <p className="flex items-center gap-1.5 text-sm font-bold">
      <Icon className="h-4 w-4" /> {title}
    </p>
    {decision && <>
      <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div><dt className="font-semibold">{outside ? "Rujukan keputusan internal" : "Rujukan SK / pleno"}</dt><dd>{decision.decisionReference}</dd></div>
        <div><dt className="font-semibold">{outside ? "Tanggal keputusan" : "Tanggal penetapan"}</dt><dd>{decision.decisionDate}</dd></div>
        {decision.rejectionReason && <div className="md:col-span-2"><dt className="font-semibold">{reasonLabel}</dt>
          <dd>{decision.rejectionReason}</dd></div>}
        {decision.notes && <div className="md:col-span-2"><dt className="font-semibold">Catatan keputusan</dt>
          <dd>{decision.notes}</dd></div>}
      </dl>
      {closure && (
        <div className="mt-2 space-y-2 rounded-lg border border-amber-300 bg-amber-100/50 p-3">
          <p className="font-semibold text-amber-950">Rincian Sisa Hak yang Ditutup:</p>
          <p className="text-xs">
            Tersalur: <span className="font-bold">{formatIdrAmount(closure.totalRealizedIdr)}</span>
            {" · "}
            Tidak disalurkan: <span className="font-bold">{formatIdrAmount(closure.totalUnrealizedRemainderIdr)}</span>
            {" dari "}
            {formatIdrAmount(closure.totalApprovedIdr)} yang disetujui
          </p>
          {closure.goodsUnitRemainders.length > 0 && (
            <p className="text-xs">
              Barang tidak disalurkan:{" "}
              {closure.goodsUnitRemainders
                .map((g) => `${g.totalUnrealizedRemainder} ${g.unit} ${g.aidType}`)
                .join(", ")}
            </p>
          )}
          <p className="text-[11px] text-amber-900">
            Sisa yang ditutup tidak dipindahkan ke penerima lain dan tidak dicatat sebagai penyerahan.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-amber-200 text-amber-900">
                  <th className="py-1">Baris</th>
                  <th className="py-1">Jenis</th>
                  <th className="py-1">Disetujui</th>
                  <th className="py-1">Terealisasi</th>
                  <th className="py-1 font-bold">Ditutup</th>
                </tr>
              </thead>
              <tbody>
                {closure.lineRemainders.map((lr) => {
                  const inUnit = (value: string) =>
                    lr.kind === "MONEY" ? formatIdrAmount(value) : `${value} ${lr.unit ?? ""}`.trim();
                  return (
                    <tr key={lr.aidLineId} className="border-b border-amber-100">
                      <td className="py-1">{lr.beneficiaryName} · {lr.aidType}</td>
                      <td className="py-1">{lr.kind === "MONEY" ? "Uang" : "Barang"}</td>
                      <td className="py-1">{inUnit(lr.approved)}</td>
                      <td className="py-1">{inUnit(lr.realized)}</td>
                      <td className="py-1 font-bold">{inUnit(lr.unrealizedRemainder)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <details>
        <summary className="cursor-pointer font-semibold">Detail pencatatan</summary>
        {outside ? <>
          <p className="mt-1">
            Keputusan diambil lewat proses internal lembaga di luar aplikasi. Aplikasi mencatat rujukannya dan akun yang
            menerbitkan; tidak ada tanda tangan pengesah atau berkas SK di sini.
          </p>
          <dl className="mt-1 space-y-1 font-mono text-[11px]">
            <div><dt className="inline">Diterbitkan oleh akun: </dt><dd className="inline">{decision.operatorAccount}</dd></div>
            <div><dt className="inline">Sidik isi hak bantuan: </dt><dd className="inline break-all">{decision.rightsDigest}</dd></div>
          </dl>
        </> : <>
          <dl className="mt-1 space-y-1 font-mono text-[11px]">
            <div><dt className="inline">Akun operator: </dt><dd className="inline">{decision.operatorAccount}</dd></div>
            <div><dt className="inline">Akun pengesah: </dt><dd className="inline">{decision.signerAccount}</dd></div>
            <div><dt className="inline">Sidik isi hak bantuan: </dt><dd className="inline break-all">{decision.rightsDigest}</dd></div>
            <div><dt className="inline">Sidik berkas keputusan: </dt><dd className="inline break-all">{decision.decisionDocumentSha256}</dd></div>
          </dl>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void download(decision)}>
            Unduh berkas keputusan
          </Button>
        </>}
        {downloadError && <p role="alert" className="mt-1">{downloadError}</p>}
      </details>
    </>}
  </div>;
}
