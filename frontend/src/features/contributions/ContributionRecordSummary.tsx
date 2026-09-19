import { channelLabel, fundTypeLabel, formatNominal, type ContributionRecord } from "./contributionClient";
import { at } from "./contributionUi";

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 break-words">
      <span className="text-stone-500 font-medium">{label}</span>
      <div className={`font-semibold text-stone-900 mt-0.5 ${mono ? "font-mono" : ""}`}>{children}</div>
    </div>
  );
}

export function ContributionRecordSummary({ record }: { record: ContributionRecord }) {
  return <>
    {/* Main Grid Info */}
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs bg-stone-50 p-4 rounded-xl">
      <Field label="Nomor Referensi Sumber" mono>
        {record.sourceReference}
      </Field>
      <Field label="Kanal Sumber">{channelLabel(record.sourceChannel)}</Field>
      <Field label="Nominal Pasti">{formatNominal(record.amountExact, record.currencyUnit)}</Field>
      <Field label="Jenis Dana">{fundTypeLabel(record.fundType)}</Field>
      <Field label="Nama Donor">{record.donorName || "Hamba Allah"}</Field>
      <Field label="Kontak Donor">{record.donorContact || "-"}</Field>
      <Field label="Tujuan / Peruntukan">{record.purpose}</Field>
      <Field label="Waktu Diterima">{at(record.receivedAt)}</Field>
      <Field label="Kelayakan Batch">{record.unqualifiedReason || "Layak masuk batch kontribusi."}</Field>
    </div>

    {/* Endorsement and Reconciliation Details */}
    {(record.reconciledAt || record.endorsedAt) && (
      <div className="rounded-xl border border-stone-200 p-4 space-y-2 text-xs">
        <h4 className="font-semibold text-stone-800">Status Pengesahan & Bukti</h4>
        {record.reconciledAt && (
          <div className="text-stone-600">
            <span className="font-medium text-stone-900">Rekonsiliasi:</span> Direkonsiliasi pada {at(record.reconciledAt)}{" "}
            oleh <code>{record.reconciledBy}</code> (Bukti: <code>{record.reconciliationProofRef}</code>)
          </div>
        )}
        {record.endorsedAt && (
          <div className="text-stone-600">
            <span className="font-medium text-stone-900">Pengesahan Pejabat:</span> Disahkan pada {at(record.endorsedAt)}{" "}
            oleh <code>{record.endorsedBy}</code> (Mandat: <code>{record.endorsementMandateId}</code>)
          </div>
        )}
      </div>
    )}
  </>;
}
