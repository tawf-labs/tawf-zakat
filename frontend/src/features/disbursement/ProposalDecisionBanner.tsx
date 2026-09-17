import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { getProposalDecision, type ProposalDecision, type ProposalDraft } from "./disbursementClient";

/** The durable decision behind an approved or rejected proposal, with technical detail kept secondary. */
export function ProposalDecisionBanner({ requests, draft, recorded }: {
  requests: PrivateRequests;
  draft: Pick<ProposalDraft, "id" | "status">;
  recorded: ProposalDecision | null;
}) {
  const [loaded, setLoaded] = useState<ProposalDecision | null>(null);
  const decided = draft.status === "APPROVED" || draft.status === "REJECTED";

  useEffect(() => {
    if (!decided || recorded) return;
    let current = true;
    getProposalDecision(requests, draft.id)
      .then(({ decision }) => { if (current) setLoaded(decision); })
      .catch(() => { if (current) setLoaded(null); });
    return () => { current = false; };
  }, [requests, draft.id, decided, recorded]);

  if (!decided) return null;
  const decision = recorded ?? loaded;
  const approved = draft.status === "APPROVED";
  const tone = approved ? "border-emerald-400 bg-emerald-50 text-emerald-950" : "border-red-400 bg-red-50 text-red-950";
  const Icon = approved ? CheckCircle2 : XCircle;

  return <div className={`space-y-2 rounded-xl border p-4 text-xs ${tone}`}>
    <p className="flex items-center gap-1.5 text-sm font-bold">
      <Icon className="h-4 w-4" /> {approved ? "Pengajuan disetujui lembaga" : "Pengajuan ditolak lembaga"}
    </p>
    {decision && <>
      <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div><dt className="font-semibold">Rujukan SK / pleno</dt><dd>{decision.decisionReference}</dd></div>
        <div><dt className="font-semibold">Tanggal penetapan</dt><dd>{decision.decisionDate}</dd></div>
        {decision.rejectionReason && <div className="md:col-span-2"><dt className="font-semibold">Alasan penolakan</dt>
          <dd>{decision.rejectionReason}</dd></div>}
        {decision.notes && <div className="md:col-span-2"><dt className="font-semibold">Catatan keputusan</dt>
          <dd>{decision.notes}</dd></div>}
      </dl>
      <details>
        <summary className="cursor-pointer font-semibold">Detail pencatatan</summary>
        <dl className="mt-1 space-y-1 font-mono text-[11px]">
          <div><dt className="inline">Akun operator: </dt><dd className="inline">{decision.operatorAccount}</dd></div>
          <div><dt className="inline">Akun pengesah: </dt><dd className="inline">{decision.signerAccount}</dd></div>
          <div><dt className="inline">Sidik isi hak bantuan: </dt><dd className="inline break-all">{decision.rightsDigest}</dd></div>
        </dl>
      </details>
    </>}
  </div>;
}
