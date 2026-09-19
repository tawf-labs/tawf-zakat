import { useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "../../components/ui/Dialog";
import type { PrivateRequests } from "../workspace/privateRequests";
import type { ContributionRecord, DonorRecoveryRequestRecord } from "./contributionClient";
import { DonorRecoveryDetails } from "./DonorRecoveryDetails";
import { DonorRecoveryDecision } from "./DonorRecoveryDecision";
import { DonorRecoveryDecisionForm } from "./DonorRecoveryDecisionForm";

export function DonorRecoveryReviewModal({ requests, record, onClose, onDecided }: {
  requests: PrivateRequests;
  record: DonorRecoveryRequestRecord | null;
  onClose: () => void;
  onDecided: (contribution: ContributionRecord) => void;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={!!record} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl w-[calc(100%-2rem)]" showCloseButton={false}
        onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}>
        <DialogClose aria-label="Tutup peninjauan" className="justify-self-end text-xs">Tutup</DialogClose>
        <DialogTitle>Pemeriksaan Pemulihan Kontak Donatur</DialogTitle>
        <DialogDescription>Periksa dasar hubungan dan bukti transaksi sebelum memutuskan persetujuan pemulihan kontak.</DialogDescription>
        {record && <>
          <DonorRecoveryDetails record={record} />
          {record.status === "PENDING"
            ? <DonorRecoveryDecisionForm key={record.id} requests={requests} record={record} onClose={onClose} onDecided={onDecided} />
            : <DonorRecoveryDecision record={record} />}
        </>}
      </DialogContent>
    </Dialog>
  );
}
