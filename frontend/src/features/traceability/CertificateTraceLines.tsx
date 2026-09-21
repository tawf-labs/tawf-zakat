import type { CertificateLineView } from "../../../../shared/activity-trace";
import { REPLACEMENT_LABELS } from "../certificates/certificateLabels";
import { certificateLineLabel } from "./traceClient";

/** Issuer/content identify what was attested; validity describes whether it still stands. */
export function CertificateTraceLines({ lines }: { lines: CertificateLineView[] }) {
  if (lines.length === 0) return <p className="text-xs text-stone-700">Belum ada sertifikat tahap yang disiapkan untuk kegiatan ini.</p>;
  return (
    <ul className="space-y-3">
      {lines.map((line) => (
        <li key={line.certificateId} className="min-w-0 space-y-1.5 text-xs text-stone-800">
          <p>
            <span className="font-semibold">{certificateLineLabel(line)}</span>
            {line.published && <span className="text-stone-600"> · versi {line.published.version}</span>}
          </p>
          {!line.published && line.issuance.reason && <p className="text-amber-900">{line.issuance.reason}</p>}
          {line.published && (
            <>
              {line.published.replacementState && line.published.replacementState !== "NONE" && (
                <p className="text-amber-900">{REPLACEMENT_LABELS[line.published.replacementState]}</p>
              )}
              <dl className="space-y-1 text-stone-600">
                <div><dt>Penerbit</dt><dd className="break-all font-mono">{line.published.issuer}</dd></div>
                <div><dt>Keterikatan isi</dt><dd className="break-all font-mono">{line.published.contentDigest}</dd></div>
              </dl>
              <a href={line.published.verifierPath}
                className="inline-flex min-h-11 items-center rounded-lg px-2 text-emerald-800 underline hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
                Periksa sertifikat versi {line.published.version}
              </a>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
