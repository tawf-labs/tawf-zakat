import { originLabel, positionLabel, formatInstant, formatBlockInstant, conclusionLabel, scopeLabel, VERSION_STATE_LABELS } from "../workspace/evidenceText";
import { DISCREPANCY_LABELS } from "../reconciliation/format";
import { useEffect, useState } from "react";
import { getApiBaseUrl } from "../../lib/contracts";
import type { PublicReportSummary } from "../../../../shared/public-report";

const limitationText: Record<string, string> = {
  TRANSACTION_DETAIL_UNAVAILABLE: "Sumber berupa rekap tanpa rincian transaksi. Kecocokan total tidak membuktikan pembayaran individual.",
  ASNAF_UNAVAILABLE: "Penyaluran per asnaf tidak tersedia dari sumber ini.",
  DURATION_UNAVAILABLE: "Durasi penyaluran tidak tersedia dari sumber ini.",
  NARRATIVE_SEMANTICS_UNEXAMINED: "Makna narasi belum diperiksa; pemindai hanya memeriksa angka rupiah.",
  AMIL_UNEXAMINED: "Hak amil belum diperiksa karena kebijakan lembaga belum dikonfigurasi.",
};
const states: Record<string, string> = {
  INCLUDED: "Masuk blok; menunggu konfirmasi", CONFIRMED: "Tingkat konfirmasi tercapai", NONCANONICAL: "Blok berubah; penerbitan tidak lagi diakui",
  SUBMITTED: "Transaksi belum terbukti masuk blok", INVALID_EVENT: "Event tidak cocok", REVERTED: "Transaksi gagal", PREPARED: "Belum dikirim",
};
const money = (q: { amount: string; unit: string } | null) => q ? `${BigInt(q.amount).toLocaleString("id-ID")} ${q.unit === "USDC_6DP" ? "unit minor USDC (6 desimal)" : q.unit}` : "Tidak tersedia";
export function PublicReport({ packageId }: { packageId: string }) {
  const [summary, setSummary] = useState<PublicReportSummary | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false, running = false;
    setSummary(null); setUnavailable(false);
    async function read() {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/public/reports/${encodeURIComponent(packageId)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json();
        if (!cancelled) { setSummary(data.summary); setUnavailable(false); }
      } catch { if (!cancelled) { setUnavailable(true); setSummary(null); } }
      finally { running = false; }
    }
    if (packageId) void read();
    const timer = setInterval(() => { if (packageId) void read(); }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [packageId]);
  if (!packageId) return <p>Gunakan tautan ringkasan dari versi laporan yang diterbitkan.</p>;
  if (unavailable) return <p role="alert">Ringkasan versi terbit atau status terkini belum tersedia. Keberhasilan penerbitan belum dapat dipastikan.</p>;
  if (!summary) return <p role="status">Memuat ringkasan publik…</p>;
  const { content: c, anchor } = summary;
  const explorer = summary.network.chainId === 421614 ? "https://sepolia.arbiscan.io" : null;
  return <article className="space-y-5 rounded-xl border border-stone-200 bg-white p-6 text-stone-900">
    <h2 className="text-xl font-semibold">{c.institution.name}</h2>
    {c.institution.synthetic && <p>Data sintetis untuk pengujian; bukan laporan mitra.</p>}
    <p>{c.period.kind === "AKHIR_TAHUN" ? "Akhir tahun" : "Semester pertama"} {c.period.year} · Rekonsiliasi · {positionLabel(c.scope.balanceSheet)} · {c.scope.currencyUnit}</p>
    <p>Cakupan: {c.scope.levels.join(", ")} · Jenis dana: {c.scope.fundTypes.join(", ")}. Nama unit dan rincian sumber tersedia bagi pembaca berwenang.</p>
    <ul className="text-sm">{c.sources.map(s => <li key={s.role}>Sisi {s.role === "CLAIM" ? "klaim" : "sumber"}: {originLabel(s.origin)} · cut-off {formatInstant(s.cutOff)} · {s.transactionDetail === "NOT_AVAILABLE" ? "rincian transaksi tidak tersedia" : "rincian transaksi tersedia dalam snapshot"}</li>)}</ul>
    <dl className="grid gap-2 sm:grid-cols-2">
      <dt>Pencatatan bukti terpisah</dt><dd>{summary.recording.state === "RECORDED" ? "Terkonfirmasi" : "Belum terkonfirmasi"}</dd>
      <dt>Vonis validator</dt><dd>{summary.validator.outcome}</dd>
      <dt>Penerbitan lembaga</dt><dd role="status">{summary.publication.state === "PUBLISHED" ? "Laporan terbit" : "Penerbitan belum terkonfirmasi"}</dd>
      <dt>Atestasi auditor versi ini</dt><dd>{summary.attestations.entries.length === 0
        ? "Belum diperiksa; atestasi versi lain tidak berlaku di sini."
        : summary.attestations.entries.map(note => `${conclusionLabel(note.conclusion)} · ${scopeLabel(note.scope)}`).join("; ")}</dd>
      <dt>Status versi</dt><dd role="status">{VERSION_STATE_LABELS[summary.version.state] ?? "Status versi perlu diperiksa"}</dd>
      <dt>Berkas sumber</dt><dd>{summary.files.available} dari {summary.files.total} tersedia; {summary.files.missing + summary.files.unavailable} tidak tersedia; {summary.files.integrityFailed} tidak cocok.</dd>
    </dl>
    <section className="space-y-2"><h3 className="font-semibold">Temuan dan batas pemeriksaan</h3>
      <p>Selisih bersih: {money(c.findings.netDelta)}. Jumlah selisih absolut: {money(c.findings.absoluteDelta)}.</p>
      <p>Toleransi rekonsiliasi: {money(c.tolerance)}. Klaim draf tetap harus cocok persis.</p>
      <ul>{Object.entries(c.findings.counts).map(([kind, count]) => <li key={kind}>{DISCREPANCY_LABELS[kind as keyof typeof DISCREPANCY_LABELS] ?? "Temuan lainnya"}: {count}</li>)}</ul>
      <ul className="list-disc pl-5">{c.limitations.map(code => <li key={code}>{limitationText[code] ?? "Batas pemeriksaan lain tersedia dalam paket terbatas."}</li>)}</ul>
    </section>
    <section className="space-y-2"><h3 className="font-semibold">Riwayat versi resmi</h3>
      {summary.version.supersededByPackageId && <p role="status">Versi ini telah dikoreksi. Versi resmi terkini adalah paket {summary.version.supersededByPackageId}; halaman versi lama tetap tersedia dan tidak diganti.</p>}
      {summary.history.length === 0 ? <p>Belum ada versi resmi yang tercatat pada registry untuk laporan ini.</p>
        : <ol className="list-none space-y-2 text-sm">{summary.history.map(entry => <li key={entry.packageId} className="rounded border border-stone-200 p-3">
          <p className="font-semibold">{entry.official ? "Versi resmi terkini" : "Versi yang digantikan"}{entry.packageId === c.packageId ? " · halaman ini" : ""}</p>
          <p className="break-all text-xs">Paket {entry.packageId}<br />Referensi versi {entry.versionReference}
            {entry.predecessorPackageId ? <><br />Menyusul paket {entry.predecessorPackageId}</> : <><br />Versi pertama; tidak menyusul versi lain.</>}</p>
          <p className="break-all text-xs">Pengesah lembaga {entry.endorsements.institution}<br />Validator {entry.endorsements.validator}</p>
          <p className="text-xs">{entry.anchor ? `Diterima registry ${formatBlockInstant(entry.anchor.blockTimestamp)} · blok ${entry.anchor.blockNumber ?? "belum tersedia"} · konfirmasi ${entry.anchor.confirmations}/${entry.anchor.requiredConfirmations}` : "Bukti penerimaan transaksi tidak tersedia dari sumber ini."}</p>
          <p className="text-xs">Alasan koreksi: {entry.correctionReason ? "tersedia bagi pembaca berwenang" : "—"}. Atestasi auditor versi ini: {entry.attestations.count === 0 ? "belum diperiksa" : entry.attestations.entries.map(note => conclusionLabel(note.conclusion)).join(", ")}.</p>
        </li>)}</ol>}
      <p className="text-xs">Penomoran versi pada layar berasal dari judul lembaga dan bukan sumber kewenangan; urutan resmi berasal dari registry.</p>
    </section>
    <section className="space-y-2 break-all text-sm"><h3 className="font-semibold">Identitas dan referensi pemeriksaan</h3>
      <p>Paket {c.packageId}<br />Referensi laporan {c.reportReference}<br />Referensi versi resmi {c.versionReference}</p>
      <p>Commitment paket ({c.commitmentScheme}) {c.commitment}<br />Digest ringkasan publik {summary.summaryDigest}</p>
      <p>Kebijakan perhitungan {c.policy}</p>
      <p>{summary.network.name} · Chain {summary.network.chainId}<br />Registry {summary.network.registry}</p>
      {explorer && <a className="underline" href={`${explorer}/address/${summary.network.registry}`} target="_blank" rel="noreferrer">Buka registry di explorer</a>}
      {anchor && <><p>{states[anchor.state] ?? "Status perlu diperiksa"} · Konfirmasi {anchor.confirmations}/{anchor.requiredConfirmations}<br />Transaksi {anchor.transactionHash}<br />Blok {anchor.blockNumber} · {anchor.blockHash} · Log {anchor.logIndex}</p>
        {explorer && <a className="underline" href={`${explorer}/tx/${anchor.transactionHash}`} target="_blank" rel="noreferrer">Periksa transaksi</a>}</>}
      <p>Kebijakan konfirmasi {summary.network.confirmationPolicy}</p>
    </section>
    <p className="text-sm">{summary.trust}</p>
    {summary.attestations.entries.length > 0 && <p className="text-sm">{summary.attestations.basis}</p>}
    <p className="text-sm">Pembaca berwenang dapat membuka ruang kerja lembaga untuk mengunduh sumber dan paket pemeriksaan versi ini. Referensi laporan/versi berupa hash; judul bebas dan narasi tetap terbatas.</p>
  </article>;
}
