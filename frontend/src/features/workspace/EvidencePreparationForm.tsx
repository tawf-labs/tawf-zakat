import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import {
  EvidenceRequestError,
  fetchInternalSources,
  prepareEvidence,
  type EvidenceIssue,
  type InternalSourceStream,
} from "./evidenceClient";
import { describeChainScope, describeSourceStatus, roleLabel } from "./evidenceText";

type Side = "CLAIM" | "SOURCE";
const SIDES: Side[] = ["CLAIM", "SOURCE"];
const sideName = (side: Side) => side === "CLAIM" ? "Sisi klaim" : "Sisi sumber";
const inputClass = "mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * The one internal stream this deployment offers (ticket #79). Named here rather
 * than typed by the operator: a source the server does not know how to build is
 * a request that fails after the decision was already made.
 */
const USDC_DEPOSIT_STREAM = "USDC_DEPOSITS";

// A documented source template, not institution data. Amounts remain strings
// from the editor to the API; no Number conversion is applied to money.
function example(side: Side, scopeUnit: string, scopeLevel: string) {
  return JSON.stringify({
    manifest: {
      label: sideName(side), origin: "PASTE", scopeUnit, scopeLevel,
      fundTypes: ["ZAKAT"], balanceSheet: "ON", currencyUnit: "IDR",
      period: { kind: "AKHIR_TAHUN", year: 2024 },
      cutOff: "2025-02-11T00:00:00.000Z", format: "baris-ledger", mappingVersion: "1",
      transactionDetail: "NOT_AVAILABLE",
    },
    status: "READ",
    rows: [{ key: "contoh-1", bucket: "ZAKAT", balanceSheet: "ON",
      value: { amount: side === "CLAIM" ? "1500000000" : "1200000000", unit: "IDR" } }],
  }, null, 2);
}

async function attachment(file: File, role: Side) {
  if (!file.size || file.size > MAX_FILE_BYTES) {
    throw new Error(`${sideName(role)}: berkas harus berisi data dan paling besar 5 MiB.`);
  }
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error(`${sideName(role)}: berkas gagal dibaca. Pilih ulang berkasnya.`));
    reader.readAsDataURL(file);
  });
  return { role, fileName: file.name, mimeType: file.type || "application/octet-stream", contentBase64 };
}

/**
 * What choosing the internal deposit source would actually bring in.
 *
 * Shown before the choice, not after: block range, indexer checkpoint, what each
 * side would be read as, and the records that exist and cannot be examined. A
 * side that is unavailable says why on its own row - the rest of the form, and
 * every other structured source, keeps working.
 */
function InternalSourcePanel({ stream }: { stream: InternalSourceStream }) {
  const scope = stream.chainScope ? describeChainScope(stream.chainScope) : null;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-700">
      {stream.reason && <p className="text-stone-600">{stream.reason}</p>}
      {scope && (
        <p>
          <span className="font-semibold">{scope.label}.</span> {scope.detail}
        </p>
      )}
      <ul className="space-y-2">
        {stream.sides.map((side) => {
          const status = describeSourceStatus(side.status, side.rowCount, side.detail);
          return (
            <li key={side.role} className="rounded border border-stone-200 p-2">
              <p className="font-semibold text-stone-900">
                {roleLabel(side.role)} · {status.label}
              </p>
              <p className="mt-1 text-stone-600">{status.detail}</p>
              {side.unverified.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-semibold">
                    Belum terverifikasi ({side.unverified.length})
                  </summary>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {side.unverified.slice(0, 20).map((record) => (
                      <li key={record.reference}>
                        <span className="font-mono">{record.reference}</span>: {record.reason}
                      </li>
                    ))}
                  </ul>
                  {side.unverified.length > 20 && (
                    <p className="mt-1">
                      Menampilkan 20 dari {side.unverified.length}; seluruhnya tersimpan dalam paket.
                    </p>
                  )}
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function EvidencePreparationForm({ token, scopeUnit, scopeLevel, onSaved }: {
  token: string;
  scopeUnit: string;
  scopeLevel: string;
  onSaved: (id: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [year, setYear] = useState("2024");
  const [periodKind, setPeriodKind] = useState("AKHIR_TAHUN");
  const [unit, setUnit] = useState("IDR");
  const [position, setPosition] = useState("ON");
  const [editors, setEditors] = useState<Record<Side, string>>({ CLAIM: "", SOURCE: "" });
  const [files, setFiles] = useState<Partial<Record<Side, File>>>({});
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<EvidenceIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<Side | null>(null);
  const [internal, setInternal] = useState<Record<Side, boolean>>({ CLAIM: false, SOURCE: false });
  const [stream, setStream] = useState<InternalSourceStream | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Read what the deployment's own ledger would contribute for the chosen
  // period, so the choice is made against a real block range and checkpoint
  // rather than against the word "internal".
  useEffect(() => {
    let current = true;
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear)) return;
    setStreamError(null);
    fetchInternalSources(token, { kind: periodKind, year: parsedYear })
      .then((payload) => {
        if (current) setStream(payload.streams[0] ?? null);
      })
      .catch((caught) => {
        if (!current) return;
        setStream(null);
        setStreamError(
          caught instanceof Error
            ? `Sumber internal tidak dapat dibaca: ${caught.message}`
            : "Sumber internal tidak dapat dibaca."
        );
      });
    return () => {
      current = false;
    };
  }, [token, periodKind, year]);

  const upload = async (side: Side, file?: File) => {
    if (!file) return;
    setReading(side);
    setError(null);
    try {
      if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Ledger harus berisi data dan paling besar 5 MiB.");
      const text = await file.text();
      JSON.parse(text);
      setEditors((current) => ({ ...current, [side]: text }));
      setFiles((current) => ({ ...current, [side]: file }));
    } catch {
      setError(`${sideName(side)}: unggahan gagal dibaca. Gunakan JSON sesuai contoh, paling besar 5 MiB. Masukan sebelumnya tetap dipertahankan.`);
    } finally {
      setReading(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const parsed = {} as Record<Side, unknown>;
      for (const side of SIDES) {
        // An internal side is named, never pasted: the server reads this
        // deployment's own ledger and indexed events, and nothing typed here
        // could stand in for what the chain recorded.
        if (internal[side]) { parsed[side] = { internal: { stream: USDC_DEPOSIT_STREAM } }; continue; }
        try { parsed[side] = JSON.parse(editors[side]); }
        catch { throw new Error(`${sideName(side)}: JSON belum sah. Periksa tanda kutip, koma, dan kurung sesuai contoh.`); }
      }
      const attachments = await Promise.all(SIDES.flatMap((side) => files[side] ? [attachment(files[side], side)] : []));
      const { preparation } = await prepareEvidence(token, {
        label, period: { kind: periodKind, year: Number(year) },
        currencyUnit: unit, balanceSheetScope: position,
        claim: parsed.CLAIM, source: parsed.SOURCE, files: attachments,
      });
      onSaved(preparation.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Persiapan gagal disimpan.");
      if (caught instanceof EvidenceRequestError) setIssues(caught.issues);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
      <h4 className="font-semibold text-stone-900">Siapkan snapshot sumber</h4>
      <p className="mt-2 text-sm text-stone-600">
        Tempel atau unggah dua ledger JSON beserta manifestnya. Saat disimpan, sumber dibekukan
        dan direkonsiliasi; selisih tetap disimpan sebagai temuan pemeriksaan.
      </p>
      <fieldset disabled={busy || reading !== null} className="mt-4 space-y-4">
        <label className="block text-sm">Nama persiapan
          <input required value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Periode
            <select value={periodKind} onChange={(e) => setPeriodKind(e.target.value)} className={inputClass}>
              <option value="AKHIR_TAHUN">Akhir tahun</option><option value="SEMESTER">Semester pertama</option>
            </select>
          </label>
          <label className="text-sm">Tahun
            <input required type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">Unit mata uang
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass}>
              <option value="IDR">Rupiah (IDR)</option><option value="USDC_6DP">USDC (6 desimal)</option>
            </select>
          </label>
          <label className="text-sm">Cakupan posisi neraca
            <select value={position} onChange={(e) => setPosition(e.target.value)} className={inputClass}>
              <option value="ON">On balance sheet</option><option value="OFF">Off balance sheet</option><option value="BOTH">Kedua posisi</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-stone-600">
          Manifest setiap sisi harus menyebut asal, unit/lembaga, jenis dana, posisi neraca, mata uang,
          periode, cut-off, format, versi pemetaan, dan ketersediaan rincian transaksi. Samakan periode
          serta mata uang manifest dengan pilihan di atas. Jumlah ditulis sebagai teks integer:
          "1500000" berarti Rp1.500.000 untuk IDR atau 1,5 USDC untuk USDC_6DP.
          Ekspor SiMBA, PDF, dan CSV belum didukung sebagai ledger; berkasnya dapat dilampirkan sebagai sumber asli.
        </p>
        <div className="grid gap-4 xl:grid-cols-2">
          {SIDES.map((side) => (
            <div key={side} className="space-y-3 rounded-lg border border-stone-200 bg-white p-3">
              <h5 className="font-semibold text-stone-800">{sideName(side)}</h5>
              <label className="flex items-start gap-2 text-sm text-stone-800">
                <input type="checkbox" className="mt-1" checked={internal[side]}
                  onChange={(e) => setInternal((current) => ({ ...current, [side]: e.target.checked }))} />
                <span>
                  Pakai sumber internal: deposit USDC on-chain
                  <span className="block text-xs text-stone-600">
                    Dibaca server dari event terindeks dan ledger internal, dalam satuan minor USDC yang
                    presisi. Pilih unit USDC (6 desimal) dan cakupan on balance sheet.
                  </span>
                </span>
              </label>
              {internal[side] && streamError && (
                <p role="alert" className="rounded bg-amber-50 p-2 text-xs text-amber-900">{streamError}</p>
              )}
              {internal[side] && stream && <InternalSourcePanel stream={stream} />}
              {internal[side] ? (
                <p className="text-xs text-stone-500">
                  Sisi ini tidak diisi dari editor. Manifest, cakupan blok, checkpoint indexer, dan
                  catatan yang belum terverifikasi ikut dibekukan bersama paket.
                </p>
              ) : (
              <>
              <details className="text-xs text-stone-600">
                <summary className="cursor-pointer">Contoh format JSON (data sintetis)</summary>
                <pre className="mt-2 overflow-x-auto rounded bg-stone-100 p-2">{example(side, scopeUnit, scopeLevel)}</pre>
              </details>
              <label className="block text-sm">Unggah ledger JSON
                <input type="file" accept=".json,application/json" className="mt-1 block w-full text-xs"
                  onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void upload(side, file); }} />
              </label>
              <label className="block text-sm">Tempel atau perbaiki ledger dan manifest
                <textarea required={!internal[side]} spellCheck={false} rows={15} value={editors[side]} className={`${inputClass} font-mono text-xs`}
                  onChange={(e) => setEditors((current) => ({ ...current, [side]: e.target.value }))} />
              </label>
              <p className="text-xs text-stone-500">
                rows: [] menyatakan sumber berhasil dibaca dan kosong. Bila belum tersedia/gagal,
                gunakan status MISSING/FAILED beserta detail alasan, tanpa baris. Rekap memakai
                transactionDetail: NOT_AVAILABLE.
              </p>
              <label className="block text-sm">Berkas asli pendukung (opsional, maksimal 5 MiB)
                <input type="file" className="mt-1 block w-full text-xs"
                  onChange={(e) => { const file = e.target.files?.[0]; setFiles((current) => ({ ...current, [side]: file })); }} />
              </label>
              {files[side] && <div className="flex items-center justify-between gap-2 text-xs">
                <span className="break-all">Lampiran: {files[side].name}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setFiles((current) => ({ ...current, [side]: undefined }))}>Lepas</Button>
              </div>}
              </>
              )}
            </div>
          ))}
        </div>
        <Button type="submit">{busy ? "Membekukan dan menyimpan…" : reading ? "Membaca unggahan…" : "Bekukan, rekonsiliasi, dan simpan"}</Button>
      </fieldset>
      {error && <div role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
        <p>{error}</p>
        {issues.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">
          {issues.map((issue, index) => <li key={index}>
            {issue.side && `${sideName(issue.side)} · `}
            {issue.rowIndex !== null && `${issue.scope === "total" ? "Total" : "Baris"} ${issue.rowIndex + 1} · `}
            {issue.field}: {issue.message}
          </li>)}
        </ul>}
      </div>}
    </form>
  );
}
