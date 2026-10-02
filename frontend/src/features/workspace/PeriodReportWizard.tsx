import { useState } from "react";
import { ArrowLeft, Lock, Receipt } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { bucketLabel } from "../reconciliation/format";
import { formatRupiah } from "./evidenceText";
import type { PrivateRequests } from "./privateRequests";
import {
  formatCutOff,
  lockPeriodReport,
  previewPeriodReport,
  type Period,
  type PeriodKind,
  type PeriodReportPreview,
} from "./periodReportClient";

/**
 * Laporan periode baru, langkah 1–2 (ADR-0043, #130).
 *
 * Step 1 asks for a period and a cut-off and nothing else: the rupiah unit and the
 * balance sheet scope are the flow's own and never shown. Step 2 shows what the app
 * holds for that period, in staff language, and locks exactly that: the cut-off the
 * preview was read at is the cut-off the snapshot is frozen with.
 *
 * *Buat koreksi* (#133) opens the same wizard on a published report's period: the period
 * is fixed, and the version being corrected and the next one are the app's to fill in.
 * A cost row the published version locked is corrected in the Biaya operasional tab, under
 * the report-correction statement (#129), before the data is locked again.
 */

const PERIOD_OPTIONS: { kind: PeriodKind; label: string; hint: string }[] = [
  { kind: "SEMESTER", label: "Semester I", hint: "1 Januari – 30 Juni" },
  { kind: "AKHIR_TAHUN", label: "Akhir tahun", hint: "1 Januari – 31 Desember" },
];

const rp = (amount: string) => `Rp${formatRupiah(amount)}`;
const inputClass = "mt-1 min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-[#0F3D30] focus:ring-1 focus:ring-[#0F3D30]";

function Figure({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-stone-900">{value}</dd>
      {detail && <dd className="mt-0.5 text-xs text-stone-500">{detail}</dd>}
    </div>
  );
}

function PreviewTables({ preview }: { preview: PeriodReportPreview }) {
  const { costs } = preview;
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Figure label="Total disalurkan (uang)" value={rp(preview.totalIdr)} detail={`${preview.handovers} penyerahan`} />
        <Figure label="Jumlah penerima" value={`${preview.recipients} orang`} />
        <Figure label="Biaya operasional" value={rp(costs.totalIdr)} detail={`Langsung ${rp(costs.directIdr)} · dari panjar ${rp(costs.fromAdvanceIdr)}`} />
      </dl>

      {preview.collection && <section aria-label="Dihimpun per jenis dana">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Penghimpunan Rupiah</h5>
        <p className="mt-2 text-lg font-semibold tabular-nums text-stone-900">{rp(preview.collection.totalIdr)}</p>
        <table className="mt-2 w-full text-sm"><tbody>{preview.collection.byFundType.map(row => (
          <tr key={row.fundType} className="border-t border-stone-100"><td className="py-2 text-stone-700">{bucketLabel(row.fundType)}</td>
            <td className="py-2 text-right tabular-nums text-stone-900">{rp(row.amountIdr)}</td></tr>
        ))}</tbody></table>
        <p className="mt-2 text-xs text-stone-500">Setelah koreksi dan pengembalian yang sudah dibayar. Keputusan pengembalian yang belum dibayar belum mengurangi angka.</p>
        {preview.collection.afterCutOff > 0 && <p className="mt-2 text-xs text-amber-800">{preview.collection.afterCutOff} kontribusi dalam periode dicatat sesudah batas data dan belum ikut laporan ini.</p>}
      </section>}

      <section aria-label="Disalurkan per jenis dana">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Disalurkan per jenis dana</h5>
        {preview.byFundType.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">Belum ada penyaluran uang yang tercatat sampai batas data.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody>
              {preview.byFundType.map((row) => (
                <tr key={row.fundType} className="border-t border-stone-100">
                  <td className="py-2 text-stone-700">{bucketLabel(row.fundType)}</td>
                  <td className="py-2 text-right tabular-nums text-stone-900">{rp(row.amountIdr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {preview.goods.length > 0 && (
        <section aria-label="Barang yang disalurkan">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Barang yang disalurkan</h5>
          <ul className="mt-2 space-y-1 text-sm text-stone-700">
            {preview.goods.map((g) => (
              <li key={g.unit}>{g.quantity} {g.unit} <span className="text-stone-500">({g.handovers} penyerahan)</span></li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-stone-500">Barang dihitung per satuan dan tidak dirupiahkan.</p>
        </section>
      )}

      {costs.advancesIdr !== "0" && (
        <p className="text-xs text-stone-600">
          Panjar yang dikeluarkan {rp(costs.advancesIdr)}; belum dipertanggungjawabkan {rp(costs.unaccountedAdvancesIdr)}.
        </p>
      )}

      {preview.incompleteEvidence.length > 0 && (
        <section aria-label="Penyerahan yang buktinya belum lengkap" className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h5 className="text-sm font-semibold text-amber-950">
            {preview.incompleteEvidence.length} penyerahan buktinya belum lengkap
          </h5>
          <p className="mt-1 text-xs text-amber-900">
            Penyerahan ini tetap masuk laporan. Lengkapi buktinya di Penyaluran bila memungkinkan sebelum laporan diterbitkan.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-amber-950">
            {preview.incompleteEvidence.slice(0, 10).map((r) => (
              <li key={r.realizationId}>
                {r.recipient}{r.program ? ` · ${r.program}` : ""} · {r.amountIdr ? rp(r.amountIdr) : `${r.quantity ?? ""} ${r.unit ?? ""}`.trim()}
              </li>
            ))}
          </ul>
          {preview.incompleteEvidence.length > 10 && (
            <p className="mt-1 text-xs text-amber-900">dan {preview.incompleteEvidence.length - 10} penyerahan lain.</p>
          )}
        </section>
      )}

      {preview.afterCutOff > 0 && (
        <p className="text-xs text-stone-600">
          {preview.afterCutOff} penyerahan pada periode ini dicatat sesudah batas data, jadi tidak masuk laporan ini.
        </p>
      )}
      {preview.unverified.length > 0 && (
        <p className="text-xs text-stone-600">
          {preview.unverified.length} catatan tidak dapat dihitung (misalnya barang tanpa nilai rupiah); rinciannya ada di Detail teknis setelah data dikunci.
        </p>
      )}
    </div>
  );
}

/** What a correction tells staff about the cost rows the published version locked (#129). */
function LockedCostsNotice({ version, onOpenCosts }: { version: string; onOpenCosts?: () => void }) {
  return (
    <section aria-label="Baris biaya yang terkunci laporan" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
      <p className="flex items-center gap-2 text-sm font-semibold"><Receipt className="h-4 w-4" aria-hidden /> Perlu membetulkan biaya operasional?</p>
      <p className="mt-1">
        Baris biaya yang masuk versi {version} berlabel <span className="font-semibold">terkunci laporan</span> dan tidak dapat diubah
        diam-diam. Koreksi atau batalkan barisnya di tab <span className="font-semibold">Biaya operasional</span> pada pengajuannya,
        lalu centang pernyataan bahwa perubahan itu untuk versi koreksi laporan ini. Riwayat baris mencatat pernyataan tersebut.
      </p>
      <p className="mt-1">Setelah barisnya dibetulkan, kembali ke sini dan kunci data laporan agar angka barunya ikut masuk.</p>
      {onOpenCosts && (
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onOpenCosts}>Buka Biaya operasional di Penyaluran</Button>
      )}
    </section>
  );
}

export function PeriodReportWizard({ requests, onLocked, onCancel, correcting, onOpenCosts }: {
  requests: PrivateRequests;
  onLocked: (preparationId: string, period: Period) => void;
  onCancel: () => void;
  /** A correction of a published report: its period is fixed and its current version named. */
  correcting?: { period: Period; name: string; version: string };
  onOpenCosts?: () => void;
}) {
  const thisYear = new Date().getFullYear();
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<PeriodKind>(correcting?.period.kind ?? "AKHIR_TAHUN");
  const [year, setYear] = useState(correcting?.period.year ?? thisYear);
  const [cutOffMode, setCutOffMode] = useState<"NOW" | "CHOSEN">("NOW");
  const [chosenCutOff, setChosenCutOff] = useState("");
  const [preview, setPreview] = useState<PeriodReportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const period: Period = { kind, year };
  const periodName = correcting?.name ?? `${PERIOD_OPTIONS.find((o) => o.kind === kind)!.label} ${year}`;
  const title = correcting ? `Koreksi laporan penyaluran ${correcting.name}` : "Laporan periode baru";

  const showData = async () => {
    setError(null);
    // `datetime-local` is the officer's wall clock; the server takes an instant.
    const cutOff = cutOffMode === "CHOSEN" ? new Date(chosenCutOff).toISOString() : null;
    if (cutOffMode === "CHOSEN" && !chosenCutOff) return setError("Isi tanggal dan jam batas data, atau pilih Sekarang.");
    setBusy(true);
    try {
      setPreview((await previewPeriodReport(requests, period, cutOff)).preview);
      setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data aplikasi tidak dapat dibaca.");
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const { preparation } = await lockPeriodReport(requests, period, preview.cutOff);
      onLocked(preparation.id, period);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data laporan gagal dikunci.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={title} className="rounded-xl border border-stone-200 bg-stone-50 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-900">{title}</h4>
        <ol className="flex gap-2 text-xs text-stone-500">
          <li className={step === 1 ? "font-semibold text-emerald-800" : ""}>1. Periode</li>
          <li aria-hidden>›</li>
          <li className={step === 2 ? "font-semibold text-emerald-800" : ""}>2. Data dari aplikasi</li>
        </ol>
      </header>

      {step === 1 ? (
        <div className="mt-4 space-y-4">
          {correcting ? (
            <>
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                Versi {correcting.version} laporan ini sudah terbit. Koreksi mengunci data periode yang sama sekali lagi dan menerbitkannya
                sebagai versi {/^\d+$/.test(correcting.version) ? Number(correcting.version) + 1 : "berikutnya"} yang menggantikan versi {correcting.version}.
                Versi {correcting.version} tetap dapat dibaca dengan tanda <span className="font-semibold">Dikoreksi</span>. Alasan koreksi
                ditulis di langkah tinjau.
              </p>
              <LockedCostsNotice version={correcting.version} onOpenCosts={onOpenCosts} />
            </>
          ) : (<>
          <fieldset>
            <legend className="text-sm font-medium text-stone-800">Periode laporan</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {PERIOD_OPTIONS.map((option) => (
                <label key={option.kind}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${kind === option.kind ? "border-emerald-600 bg-white text-emerald-900" : "border-stone-300 bg-white text-stone-700"}`}>
                  <input type="radio" name="period-kind" value={option.kind} checked={kind === option.kind} onChange={() => setKind(option.kind)} />
                  <span>{option.label} <span className="text-xs text-stone-500">({option.hint})</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm font-medium text-stone-800">
            Tahun
            <select className={`${inputClass} ml-0 block w-40`} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          </>)}

          <fieldset>
            <legend className="text-sm font-medium text-stone-800">Batas data laporan</legend>
            <p className="mt-1 text-xs text-stone-600">
              Data yang dicatat sesudah batas ini tidak masuk laporan dan tidak dianggap tidak ada.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-stone-700">
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name="cut-off" checked={cutOffMode === "NOW"} onChange={() => setCutOffMode("NOW")} /> Sekarang
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name="cut-off" checked={cutOffMode === "CHOSEN"} onChange={() => setCutOffMode("CHOSEN")} /> Tanggal dan jam tertentu
              </label>
              {cutOffMode === "CHOSEN" && (
                <input type="datetime-local" aria-label="Tanggal dan jam batas data" className={inputClass}
                  value={chosenCutOff} onChange={(e) => setChosenCutOff(e.target.value)} />
              )}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={showData}>{busy ? "Membaca data…" : "Lanjut: lihat data"}</Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Batal</Button>
          </div>
        </div>
      ) : preview && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-stone-700">
            Data penyaluran <span className="font-semibold">{periodName}</span> yang tercatat di aplikasi sampai{" "}
            <span className="font-semibold">{formatCutOff(preview.cutOff)}</span>.
          </p>
          <PreviewTables preview={preview} />
          <p className="rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-600">
            Setelah dikunci, angka ini tidak berubah meski data di aplikasi bertambah. Perubahan sesudahnya masuk laporan koreksi.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={lock}>
              <Lock className="mr-2 h-4 w-4" /> {busy ? "Mengunci…" : "Kunci data laporan"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setStep(1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Kembali
            </Button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
