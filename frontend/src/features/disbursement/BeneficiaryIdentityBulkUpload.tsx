import { useId, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { readFileBase64, uploadProposalDocument, type AidLine, type Beneficiary } from "./disbursementClient";
import { Pager, pageOf, usePage } from "./Pagination";

/**
 * Bulk KTP/KK upload for a CSV-imported roster (100 mustahik and counting).
 * The one-file-one-beneficiary-one-form flow in ProposalDocumentUpload does
 * not scale to that: it is 100 repeats of picking a category, picking a name
 * out of a 100-option dropdown, and picking a file. Instead, the amil selects
 * every scan at once and each file is matched to its mustahik by filename —
 * NIK first (16 digits), then the aid line's referensi_bukti code — so most
 * files need no manual pick at all.
 */

type MatchKind = "nik" | "referensi" | "manual" | null;
type MatchedFile = { file: File; beneficiaryId: string | null; matchedBy: MatchKind };

const NIK_PATTERN = /\d{16}/;
// A reference code like "SKTM-2026-001" or "BAST-BRG-2026-01": letters, a dash,
// then alnum/dash ending in digits. Matched against AidLine.evidenceReference.
const REFERENCE_PATTERN = /[A-Za-z]+-[A-Za-z0-9-]*\d/;

const normalizeRef = (value: string) => value.trim().toUpperCase();

function matchFileName(fileName: string, beneficiaries: Beneficiary[], aidLines: AidLine[]): { beneficiaryId: string | null; matchedBy: MatchKind } {
  const nik = fileName.match(NIK_PATTERN)?.[0];
  if (nik) {
    const byNik = beneficiaries.find((b) => b.identityBasis.kind === "NIK" && b.identityBasis.value === nik);
    if (byNik) return { beneficiaryId: byNik.id, matchedBy: "nik" };
  }
  const ref = fileName.match(REFERENCE_PATTERN)?.[0];
  if (ref) {
    const normalized = normalizeRef(ref);
    const byRef = aidLines.find((line) => line.evidenceReference && normalizeRef(line.evidenceReference) === normalized);
    if (byRef) return { beneficiaryId: byRef.beneficiaryId, matchedBy: "referensi" };
  }
  return { beneficiaryId: null, matchedBy: null };
}

const matchLabel: Record<Exclude<MatchKind, null>, string> = {
  nik: "cocok lewat NIK",
  referensi: "cocok lewat referensi",
  manual: "dipilih manual",
};

export function BeneficiaryIdentityBulkUpload({ requests, proposalId, beneficiaries, aidLines, onUploaded }: {
  requests: PrivateRequests; proposalId: string; beneficiaries: Beneficiary[]; aidLines: AidLine[]; onUploaded: () => void;
}) {
  const inputId = useId();
  const [matches, setMatches] = useState<MatchedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pager = usePage(matches.length);
  const paged = pageOf(matches, pager.page);

  if (beneficiaries.length === 0) return null;

  function pickFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const next = Array.from(fileList).map((file) => {
      const { beneficiaryId, matchedBy } = matchFileName(file.name, beneficiaries, aidLines);
      return { file, beneficiaryId, matchedBy };
    });
    setMatches(next);
    setFailed([]);
    setError(null);
  }

  function setManualMatch(index: number, beneficiaryId: string) {
    setMatches((prev) => prev.map((m, i) => (i === index ? { ...m, beneficiaryId: beneficiaryId || null, matchedBy: beneficiaryId ? "manual" : null } : m)));
  }

  const matchedCount = matches.filter((m) => m.beneficiaryId).length;
  const unmatchedCount = matches.length - matchedCount;

  async function uploadAll() {
    setUploading(true);
    setProgress(0);
    const failures: string[] = [];
    const ready = matches.filter((m) => m.beneficiaryId);
    for (let i = 0; i < ready.length; i++) {
      const m = ready[i];
      try {
        const contentBase64 = await readFileBase64(m.file);
        await uploadProposalDocument(requests, proposalId, {
          category: "BENEFICIARY_IDENTITY",
          beneficiaryId: m.beneficiaryId,
          fileName: m.file.name,
          mimeType: m.file.type || "application/octet-stream",
          contentBase64,
        });
      } catch {
        failures.push(m.file.name);
      }
      setProgress(i + 1);
    }
    setFailed(failures);
    setUploading(false);
    if (failures.length < ready.length) onUploaded();
    if (failures.length === 0) setMatches([]);
  }

  return (
    <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 text-xs">
      <div>
        <p className="font-semibold text-stone-800">Unggah KTP/KK Massal</p>
        <p className="mt-0.5 text-stone-600">
          Pilih semua berkas sekaligus. Setiap berkas dicocokkan otomatis ke mustahik dari NIK (16 digit) atau kode
          referensi bukti pada nama berkasnya (mis. <code>3280112212900010.jpg</code> atau <code>SKTM-2026-007.jpg</code>).
        </p>
      </div>

      <div>
        <label htmlFor={inputId} className="sr-only">Pilih berkas identitas</label>
        <input
          id={inputId}
          type="file"
          multiple
          accept="image/*,application/pdf"
          disabled={uploading}
          onChange={(e) => pickFiles(e.target.files)}
          className="block w-full text-xs file:mr-3 file:rounded-lg file:border file:border-stone-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium"
        />
      </div>

      {matches.length > 0 && (
        <>
          <p className="text-stone-700">
            {matches.length} berkas dipilih · <span className="text-emerald-800">{matchedCount} cocok</span>
            {unmatchedCount > 0 && <span className="text-amber-800"> · {unmatchedCount} belum cocok, pilih manual di bawah</span>}
          </p>

          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {paged.map(({ item: m, index: i }) => (
              <li key={`${m.file.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="flex items-center gap-1.5 text-stone-700">
                  {m.beneficiaryId ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                  )}
                  <span className="truncate" title={m.file.name}>{m.file.name}</span>
                </span>
                {m.beneficiaryId ? (
                  <span className="text-stone-600">
                    {beneficiaries.find((b) => b.id === m.beneficiaryId)?.name || "Penerima"}
                    <span className="text-stone-400"> · {matchLabel[m.matchedBy ?? "manual"]}</span>
                  </span>
                ) : (
                  <select
                    aria-label={`Pilih penerima untuk berkas ${m.file.name}`}
                    value=""
                    onChange={(e) => setManualMatch(i, e.target.value)}
                    className="rounded border border-stone-300 px-2 py-1 text-xs"
                  >
                    <option value="">Pilih penerima…</option>
                    {beneficiaries.map((b, bi) => (
                      <option key={b.id} value={b.id}>{b.name || `Penerima ${bi + 1}`}</option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
          <Pager label="Berkas" page={pager.page} pageCount={pager.pageCount} onChange={pager.setPage} />

          {failed.length > 0 && (
            <p role="alert" className="text-red-700">
              {failed.length} berkas gagal diunggah: {failed.join(", ")}. Berkas lain yang cocok sudah tersimpan; coba lagi untuk yang gagal.
            </p>
          )}
          {error && <p role="alert" className="text-red-700">{error}</p>}

          <Button type="button" size="sm" disabled={uploading || matchedCount === 0} onClick={uploadAll}>
            {uploading ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Mengunggah {progress}/{matchedCount}…</>
            ) : (
              <><UploadCloud className="mr-1.5 h-3.5 w-3.5" /> Unggah {matchedCount} Berkas Cocok</>
            )}
          </Button>
        </>
      )}
    </div>
  );
}
