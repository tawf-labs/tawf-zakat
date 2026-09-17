import { useId } from "react";

export type PaymentRecipientFields = { enabled: boolean; name: string; relation: string };

export function RealizationPaymentRecipientFields({ value, onChange }: {
  value: PaymentRecipientFields; onChange: (value: PaymentRecipientFields) => void;
}) {
  const id = useId();
  return <div className="space-y-2">
    <label className="flex items-center gap-2 text-xs font-semibold">
      <input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />
      Dibayarkan ke pihak lain (sekolah, rumah sakit, penyedia)
    </label>
    {value.enabled && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="block text-xs font-semibold" htmlFor={`${id}-recipient`}>
        Nama penerima pembayaran
        <input id={`${id}-recipient`} value={value.name} className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
          onChange={(event) => onChange({ ...value, name: event.target.value })} />
      </label>
      <label className="block text-xs font-semibold" htmlFor={`${id}-relation`}>
        Hubungan dengan penerima manfaat
        <input id={`${id}-relation`} value={value.relation} placeholder="Contoh: sekolah penerima manfaat" className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
          onChange={(event) => onChange({ ...value, relation: event.target.value })} />
      </label>
      <p className="text-xs text-stone-600 sm:col-span-2">Penerima pembayaran tidak mengubah identitas penerima manfaat yang berhak.</p>
    </div>}
  </div>;
}
