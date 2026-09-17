import { useId, useState } from "react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import {
  createContribution,
  formatNominal,
  JENIS_DANA_LIST,
  SOURCE_CHANNELS,
  type ContributionDraftInput,
  type ContributionRecord,
  type CurrencyUnit,
  type JenisDana,
  type SourceChannel,
} from "./contributionClient";
import { errorMessage, toLocalInput, useOperationIds } from "./contributionUi";

const inputClass =
  "w-full text-sm border border-stone-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-emerald-500 focus:outline-none";
const selectClass = `${inputClass} bg-white text-stone-800`;
const labelClass = "block text-xs font-semibold uppercase text-stone-600 mb-1";

export function ManualContributionForm({
  requests,
  onRecorded,
  onCancel,
  onError,
}: {
  requests: PrivateRequests;
  onRecorded: (created: ContributionRecord) => void;
  onCancel: () => void;
  onError: (message: string | null) => void;
}) {
  const [channel, setChannel] = useState<SourceChannel>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [unit, setUnit] = useState<CurrencyUnit>("IDR");
  const [amount, setAmount] = useState("");
  const [fundType, setFundType] = useState<JenisDana>("ZAKAT");
  const [receivedAt, setReceivedAt] = useState(() => toLocalInput(Math.floor(Date.now() / 1000)));
  const [purpose, setPurpose] = useState("Penerimaan Zakat Lembaga");
  const [donorName, setDonorName] = useState("");
  const [donorContact, setDonorContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const operations = useOperationIds();
  const id = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const receivedSeconds = Math.floor(new Date(receivedAt).getTime() / 1000);
    if (!reference.trim() || !amount.trim() || !Number.isFinite(receivedSeconds)) {
      onError("Nomor referensi, nominal, dan waktu diterima wajib diisi.");
      return;
    }
    setSubmitting(true);
    onError(null);
    try {
      const input: ContributionDraftInput = {
        sourceChannel: channel,
        sourceReference: reference.trim(),
        currencyUnit: unit,
        amountExact: amount.trim(),
        fundType,
        purpose: purpose.trim() || "Penerimaan Kontribusi Lembaga",
        receivedAt: receivedSeconds,
        donorName: donorName.trim() || null,
        donorContact: donorContact.trim() || null,
      };
      const intent = `record:${JSON.stringify(input)}`;
      const created = await createContribution(requests, { ...input, operationId: operations.operationFor(intent) });
      operations.settle(intent);
      setReference("");
      setAmount("");
      setDonorName("");
      setDonorContact("");
      onRecorded(created);
    } catch (err) {
      onError(errorMessage(err, "Gagal mencatat kontribusi."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 space-y-4 max-w-2xl">
      <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
        <h3 className="text-sm font-semibold text-stone-900">Catat Penerimaan Kontribusi Manual</h3>
        <p className="mt-1 text-xs text-stone-600">
          Setiap catatan diverifikasi secara unik berdasarkan kombinasi lembaga, kanal sumber, dan nomor referensi.
          Nomor kontak donor bersifat opsional (US-51).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${id}-channel`} className={labelClass}>Kanal Sumber (Metode)</label>
          <select
            id={`${id}-channel`}
            value={channel}
            onChange={(e) => setChannel(e.target.value as SourceChannel)}
            className={selectClass}
          >
            {SOURCE_CHANNELS.map((ch) => (
              <option key={ch.value} value={ch.value}>
                {ch.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-reference`} className={labelClass}>Nomor Referensi Transaksi</label>
          <input
            id={`${id}-reference`}
            type="text"
            required
            placeholder="Contoh: BCA-TRX-2024101901"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={`${id}-unit`} className={labelClass}>Mata Uang</label>
          <select
            id={`${id}-unit`}
            value={unit}
            onChange={(e) => setUnit(e.target.value as CurrencyUnit)}
            className={selectClass}
          >
            <option value="IDR">Rupiah (IDR)</option>
            <option value="USDC_6DP">USDC (6 Decimal Places)</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-amount`} className={labelClass}>
            Nominal Pasti {unit === "USDC_6DP" ? "(Minor Unit: 1 USDC = 1000000)" : "(Rupiah)"}
          </label>
          <input
            id={`${id}-amount`}
            type="text"
            required
            placeholder={unit === "IDR" ? "5000000" : "1500000"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} font-mono`}
          />
          <span className="text-[11px] text-stone-500 mt-1 block">{amount ? formatNominal(amount, unit) : ""}</span>
        </div>

        <div>
          <label htmlFor={`${id}-fund`} className={labelClass}>Jenis Dana</label>
          <select
            id={`${id}-fund`}
            value={fundType}
            onChange={(e) => setFundType(e.target.value as JenisDana)}
            className={selectClass}
          >
            {JENIS_DANA_LIST.map((fd) => (
              <option key={fd.value} value={fd.value}>
                {fd.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-received`} className={labelClass}>Waktu Dana Diterima</label>
          <input
            id={`${id}-received`}
            type="datetime-local"
            required
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={`${id}-purpose`} className={labelClass}>Tujuan / Peruntukan</label>
          <input
            id={`${id}-purpose`}
            type="text"
            placeholder="Penerimaan Zakat Maal"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={`${id}-donor-name`} className={labelClass}>Nama Muzaki / Donor (Opsional)</label>
          <input
            id={`${id}-donor-name`}
            type="text"
            placeholder="Hamba Allah / Nama Pribadi"
            value={donorName}
            onChange={(e) => setDonorName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={`${id}-donor-contact`} className={labelClass}>Kontak Donor (Opsional)</label>
          <input
            id={`${id}-donor-contact`}
            type="text"
            placeholder="+628123456789 atau email"
            value={donorContact}
            onChange={(e) => setDonorContact(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="pt-3 flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Menyimpan…" : "Simpan Penerimaan"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Batal
        </Button>
      </div>
    </form>
  );
}
