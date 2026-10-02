import { useEffect, useState } from "react";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { formatQuantity } from "../../lib/reporting";
import { formatRupiah } from "./evidenceText";
import type { SavedReportPackage } from "./evidenceClient";
import type { PrivateRequests } from "./privateRequests";
import { PeriodReportPublishStep } from "./PeriodReportPublishStep";
import {
  checkReport,
  formatCutOff,
  readReportMaterial,
  suggestNarrative,
  type CorrectionComparison,
  type FigureChange,
  type ReportFigure,
  type ReportMaterial,
} from "./periodReportClient";

/**
 * Langkah 4–5: tinjau dan tulis, lalu periksa dan terbitkan (ADR-0043, #131).
 *
 * Staff read the figures, write the narrative and confirm the disclosure; the report
 * id comes from the period, the version and predecessor from the registry, and every
 * figure is claimed by the server exactly as computed. The automatic check answers
 * *Lolos* or *Belum lolos* with reasons; a passing package is frozen and published.
 *
 * A correction (#133) also shows what changed since the version it succeeds: each figure
 * before and after, the cut-off of each version's data, and the operational costs.
 */

const formatValue = (value: ReportFigure["value"]) => value.unit === "IDR" ? `Rp${formatRupiah(value.amount)}` : formatQuantity(value);
const value = (figure: ReportFigure) => formatValue(figure.value);
const inputClass = "mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900 focus:border-[#0F3D30] focus:ring-1 focus:ring-[#0F3D30]";

function FigureGroup({ title, figures, note }: { title: string; figures: ReportFigure[]; note?: string }) {
  if (figures.length === 0) return null;
  return (
    <section aria-label={title}>
      <h5 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h5>
      {note && <p className="mt-1 text-xs text-stone-500">{note}</p>}
      <table className="mt-2 w-full text-sm">
        <tbody>
          {figures.map((figure) => (
            <tr key={figure.name} className="border-t border-stone-100">
              <td className="py-2 pr-3 text-stone-700">{figure.label}</td>
              <td className="whitespace-nowrap py-2 text-right tabular-nums text-stone-900">{value(figure)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Figures({ material }: { material: ReportMaterial }) {
  const of = (prefix: string) => material.figures.filter((f) => f.name.startsWith(prefix));
  return (
    <div className="space-y-4">
      <FigureGroup title="Data dari aplikasi" figures={of("SOURCE.")} />
      <FigureGroup
        title={material.comparedWithBookkeeping ? "Rekap pembukuan" : "Sisi pembanding"}
        note={material.comparedWithBookkeeping ? undefined : "Tanpa rekap pembukuan, sisi pembanding memuat data aplikasi yang sama."}
        figures={of("CLAIM.")}
      />
      <FigureGroup title="Perbedaan" figures={of("rekonsiliasi.")} />
    </div>
  );
}

const CHANGE_LABELS: Record<FigureChange["state"], string> = {
  TETAP: "tetap",
  BERUBAH: "berubah",
  DITAMBAHKAN: "baru",
  TIDAK_LAGI_TERSEDIA: "tidak ada lagi",
};

function CutOffChange({ correction }: { correction: CorrectionComparison }) {
  const { before, after } = correction.cutOff;
  const version = correction.predecessor.version;
  if (!before || !after) return null;
  // Two cut-offs within one minute would read as the same time; say the seconds then.
  const sameMinute = formatCutOff(before) === formatCutOff(after);
  const show = (iso: string) => sameMinute ? new Date(iso).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "medium" }) : formatCutOff(iso);
  return (
    <p>
      {before === after
        ? <>Batas data sama dengan versi {version}: {formatCutOff(after)}.</>
        : <>Batas data berubah dari <span className="font-semibold">{show(before)}</span> (versi {version}) menjadi{" "}
          <span className="font-semibold">{show(after)}</span>. Data yang dicatat di antara keduanya ikut masuk koreksi ini.</>}
    </p>
  );
}

function CorrectionChanges({ correction, comparedWithBookkeeping, onOpenCosts }: {
  correction: CorrectionComparison; comparedWithBookkeeping: boolean; onOpenCosts?: () => void;
}) {
  const version = correction.predecessor.version;
  // Without a recap the comparison side mirrors the app's data; its rows would only repeat the ones above them.
  const figures = correction.figures.filter((f) => comparedWithBookkeeping || !f.name.startsWith("CLAIM."));
  const changed = figures.filter((f) => f.state !== "TETAP").length;
  const { costs } = correction;
  return (
    <section aria-label={`Perubahan dibanding versi ${version}`} className="space-y-3 rounded-lg border border-amber-200 bg-white p-3">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Perubahan dibanding versi {version}</h5>
      <div className="space-y-1 text-xs text-stone-700">
        <CutOffChange correction={correction} />
        <p>
          {changed === 0
            ? "Tidak ada angka laporan yang berubah."
            : `${changed} angka laporan berubah.`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-500">
              <th scope="col" className="py-1 pr-3 font-medium">Angka</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Versi {version}</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Sesudah koreksi</th>
              <th scope="col" className="py-1 text-right font-medium"><span className="sr-only">Perubahan</span></th>
            </tr>
          </thead>
          <tbody>
            {figures.map((f) => (
              <tr key={f.name} className={`border-t border-stone-100 ${f.state === "TETAP" ? "" : "bg-amber-50"}`}>
                <td className="py-2 pr-3 text-stone-700">{f.label}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-stone-500">{f.before ? formatValue(f.before) : "—"}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums font-semibold text-stone-900">{f.after ? formatValue(f.after) : "—"}</td>
                <td className={`whitespace-nowrap py-2 text-right text-xs ${f.state === "TETAP" ? "text-stone-400" : "font-semibold text-amber-800"}`}>{CHANGE_LABELS[f.state]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 text-xs text-stone-700">
        {costs && (costs.before === costs.after
          ? <p>Biaya operasional dalam data laporan tetap Rp{formatRupiah(costs.after)}.</p>
          : <p>
              Biaya operasional dalam data laporan berubah dari Rp{formatRupiah(costs.before)} menjadi{" "}
              <span className="font-semibold">Rp{formatRupiah(costs.after)}</span>. Baris biaya yang diubah sesudah versi {version} terbit
              tercatat dengan pernyataan koreksi laporan di riwayat barisnya.
            </p>)}
        <p>
          Perlu membetulkan baris biaya yang terkunci versi {version}? Koreksi barisnya di tab Biaya operasional dengan pernyataan koreksi
          laporan, lalu kunci ulang data koreksi dari kartu laporan.
          {onOpenCosts && <>{" "}<button type="button" className="font-semibold text-emerald-800 underline" onClick={onOpenCosts}>Buka Biaya operasional</button></>}
        </p>
      </div>
    </section>
  );
}

export function PeriodReportReviewWizard({ preparationId, periodName, requests, onClose, onChanged, onOpenCosts }: {
  preparationId: string; periodName: string; requests: PrivateRequests; onClose: () => void; onChanged: () => void;
  onOpenCosts?: () => void;
}) {
  const [material, setMaterial] = useState<ReportMaterial | null>(null);
  const [saved, setSaved] = useState<SavedReportPackage | null>(null);
  const [narrative, setNarrative] = useState("");
  const [reason, setReason] = useState("");
  const [disclosed, setDisclosed] = useState(false);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"check" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readReportMaterial(requests, preparationId)
      .then((next) => { if (!cancelled) { setMaterial(next); setSaved(next.ready); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Data laporan tidak dapat dibuka."); });
    return () => { cancelled = true; };
  }, [preparationId, requests]);

  async function run(kind: "check" | "ai", task: () => Promise<void>) {
    setBusy(kind); setError(null);
    try { await task(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Permintaan gagal."); }
    finally { setBusy(null); }
  }

  const check = () => run("check", async () => {
    const result = await checkReport(requests, preparationId, { narrative, disclosed, correctionReason: material?.correctionRequired ? reason : null });
    setReasons(result.reasons);
    if (result.package.status === "FROZEN" && result.package.verdict.outcome === "LOLOS") setSaved(result.package);
    onChanged();
  });
  const suggest = () => run("ai", async () => setNarrative((await suggestNarrative(requests, preparationId)).narrative));

  const step = saved ? 5 : 4;
  return (
    <section aria-label={`Tinjau dan terbitkan ${periodName}`} className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-900">Laporan penyaluran {periodName}</h4>
        <ol className="flex gap-2 text-xs text-stone-500">
          <li className={step === 4 ? "font-semibold text-emerald-800" : ""}>Tinjau dan tulis</li>
          <li aria-hidden>›</li>
          <li className={step === 5 ? "font-semibold text-emerald-800" : ""}>Periksa dan terbitkan</li>
        </ol>
      </header>

      {!material ? (
        error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="text-sm text-stone-600">Memuat angka laporan…</p>
      ) : (
        <>
          <p className="text-xs text-stone-600">
            Versi {material.identity.version}
            {material.correction ? `, mengoreksi versi ${material.correction.predecessor.version} yang sudah terbit`
              : material.identity.predecessor ? ", mengoreksi versi yang sudah terbit" : ""} · <span className="font-mono">{material.identity.reportId}</span>
          </p>
          {material.correction ? (
            <CorrectionChanges correction={material.correction} comparedWithBookkeeping={material.comparedWithBookkeeping} onOpenCosts={onOpenCosts} />
          ) : material.correctionRequired && (
            <p className="rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-600">
              Versi yang dikoreksi tidak disusun di aplikasi ini, sehingga perbandingan angka per versi tidak tersedia.
            </p>
          )}
          <Figures material={material} />

          <section aria-label="Batas pemeriksaan" className="rounded-lg border border-stone-200 bg-white p-3">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Batas pemeriksaan</h5>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-stone-700">
              {material.limitations.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          </section>
          {material.blockers.map((note, index) => <p key={index} role="alert" className="text-sm text-red-700">{note}</p>)}

          {step === 4 ? (
            <div className="space-y-3">
              {material.correctionRequired && (
                <label className="block text-sm font-medium text-stone-800">
                  Alasan koreksi
                  <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <span className="text-xs font-normal text-stone-500">
                    Wajib. Laporan periode ini sudah pernah terbit; versi ini menggantikannya dan alasannya ikut tercatat bersama laporan.
                  </span>
                </label>
              )}
              <label className="block text-sm font-medium text-stone-800">
                Narasi laporan
                <textarea rows={6} className={inputClass} value={narrative} onChange={(e) => setNarrative(e.target.value)} />
              </label>
              <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={suggest}>
                <Sparkles className="mr-2 h-4 w-4" /> {busy === "ai" ? "Menyusun…" : "Bantu susun dengan AI"}
              </Button>
              <label className="flex gap-2 text-sm text-stone-800">
                <input type="checkbox" checked={disclosed} onChange={(e) => setDisclosed(e.target.checked)} />
                Saya menyertakan seluruh sumber dan batas pemeriksaan di atas sebagai bagian laporan.
              </label>
              {reasons && reasons.length > 0 && (
                <div role="status" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <p className="flex items-center gap-2 font-semibold"><XCircle className="h-4 w-4" /> Hasil pemeriksaan otomatis: belum lolos</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={busy !== null || !narrative.trim() || !disclosed || material.blockers.length > 0
                  || (material.correctionRequired && !reason.trim())} onClick={check}>
                  {busy === "check" ? "Memeriksa…" : "Periksa laporan"}
                </Button>
                <Button type="button" variant="ghost" onClick={onClose}>Tutup</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
                <CheckCircle2 className="h-4 w-4" /> Hasil pemeriksaan otomatis: lolos
              </p>
              <section aria-label="Narasi" className="rounded-lg border border-stone-200 bg-white p-3">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Narasi</h5>
                <p className="mt-1 whitespace-pre-wrap text-sm text-stone-800">{saved!.draft?.narrative}</p>
              </section>
              {material.publicationUnavailable === null ? (
                <PeriodReportPublishStep saved={saved!} preparationId={preparationId} requests={requests} onPublished={onChanged} />
              ) : (
                <div role="status" className="rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-700">
                  <p className="font-semibold">Penerbitan belum dibuka</p>
                  <p className="mt-1">{material.publicationUnavailable} Laporan tersimpan dengan status siap diterbitkan; operator perlu membuka penerbitan lebih dulu.</p>
                </div>
              )}
              <Button type="button" variant="ghost" onClick={onClose}>Tutup</Button>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </>
      )}
    </section>
  );
}
