import { HeartHandshake, Layers, Lock, Users } from "lucide-react";
import { formatNominal } from "../contributions/contributionClient";
import { allocationPercent } from "../activities/activityClient";
import type { DonorActivityAllocation } from "./donorClient";
import { Notice } from "./DonorNotice";

type DonorAllocationListProps = {
  allocations: DonorActivityAllocation[] | undefined;
  error: string | null;
};

export function DonorAllocationList({ allocations, error }: DonorAllocationListProps) {
  return (
    <section aria-labelledby="donor-allocations-heading" className="rounded-3xl border border-tawf-green-10 bg-white p-6 sm:p-8 shadow-sm space-y-6">
      <div className="flex items-center gap-3 border-b border-tawf-green-10 pb-4">
        <HeartHandshake className="w-5 h-5 text-tawf-green-light" aria-hidden />
        <div>
          <h4 id="donor-allocations-heading" className="font-serif text-lg font-bold text-tawf-green">
            Alokasi ke Kegiatan Penyaluran
          </h4>
          <p className="text-xs text-tawf-muted">Bagian kontribusi Anda yang dialokasikan lembaga ke kegiatan penyaluran.</p>
        </div>
      </div>

      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : !allocations ? (
        <p className="text-xs text-tawf-muted">Memuat alokasi...</p>
      ) : allocations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-tawf-green-10 p-8 text-center space-y-2">
          <Layers className="w-8 h-8 text-tawf-muted mx-auto opacity-50" aria-hidden />
          <p className="text-sm font-semibold text-tawf-green">Belum Ada Alokasi Kegiatan</p>
          <p className="text-xs text-tawf-muted max-w-md mx-auto">
            Kontribusi ini belum dialokasikan ke kegiatan penyaluran tertentu.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {allocations.map((item) => (
            <AllocationCard key={item.allocationId} item={item} />
          ))}
        </ul>
      )}

      <p className="text-[11px] text-tawf-muted flex items-center gap-1.5 border-t border-tawf-green-10 pt-4">
        <Lock className="w-3.5 h-3.5" aria-hidden />
        <span>Identitas penerima manfaat dan donatur lain tidak ditampilkan.</span>
      </p>
    </section>
  );
}

function AllocationCard({ item }: { item: DonorActivityAllocation }) {
  const { activity } = item;
  const percent = allocationPercent({
    targetAmount: activity.targetAmount,
    targetIsPartial: activity.targetIsPartial,
    totalAllocatedAmount: activity.pooled.totalAllocatedAmount,
  });
  const pooled = formatNominal(activity.pooled.totalAllocatedAmount, activity.currencyUnit);
  const target = formatNominal(activity.targetAmount, activity.currencyUnit);

  return (
    <li className="rounded-2xl border border-tawf-green-10 p-5 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h5 className="font-serif text-base font-bold text-tawf-green">{activity.name}</h5>
        <div className="text-left sm:text-right">
          <span className="text-[11px] text-tawf-muted block">Dari kontribusi Anda</span>
          <span className="text-sm font-bold text-tawf-green">{formatNominal(item.amountExact, item.currencyUnit)}</span>
        </div>
      </div>
      {activity.description && <p className="text-xs text-tawf-muted leading-relaxed">{activity.description}</p>}

      <div className="rounded-xl bg-[#f4f8f3] p-4 border border-tawf-green-10 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
          <span className="font-semibold text-tawf-green">Pendanaan gabungan kegiatan</span>
          <span className="font-mono font-bold text-tawf-green-light">
            {pooled} / {target}
            {percent !== null && ` (${Math.min(100, percent)}%)`}
          </span>
        </div>
        {percent !== null ? (
          <div className="w-full h-2.5 rounded-full bg-[#dbe7dd] overflow-hidden" role="progressbar" aria-valuenow={Math.min(100, percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Pendanaan gabungan kegiatan">
            <div className="h-full rounded-full bg-tawf-green-light" style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
        ) : (
          <p className="text-[11px] text-tawf-muted">
            Target belum mencakup seluruh kebutuhan (sebagian berupa barang tanpa nilai rupiah), jadi persentase tidak ditampilkan.
          </p>
        )}
        <p className="text-[11px] text-tawf-muted">Didanai bersama oleh {activity.pooled.allocationCount} alokasi kontribusi.</p>
      </div>

      <BeneficiaryShares item={item} />

      {item.reason && (
        <p className="text-xs text-tawf-muted border-t border-tawf-green-10 pt-3">
          <span className="font-semibold text-tawf-green">Dasar alokasi: </span>
          {item.reason}
        </p>
      )}
    </li>
  );
}

/**
 * Where this donor's rupiah landed, per mustahik (ADR-0037).
 *
 * Pseudonyms and asnaf only, with the activity's own region label. What the server
 * withholds to protect recipients is said plainly, not left as an empty list, and the
 * screen never pretends the split is a physical earmark.
 */
function BeneficiaryShares({ item }: { item: DonorActivityAllocation }) {
  const beneficiaries = item.beneficiaries;
  if (!beneficiaries) return null;

  const hasUnassigned = beneficiaries.unassignedExact !== "0";
  const region = beneficiaries.regionLabel?.trim();

  return (
    <div className="space-y-3 border-t border-tawf-green-10 pt-4">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-tawf-green-light" aria-hidden />
        <h6 className="text-xs font-semibold text-tawf-green">Sampai ke mustahik</h6>
      </div>

      {beneficiaries.withheldReason ? (
        <p className="text-[11px] text-tawf-muted leading-relaxed">{beneficiaries.withheldReason}</p>
      ) : beneficiaries.shares.length === 0 ? (
        <p className="text-[11px] text-tawf-muted leading-relaxed">
          Bagian kontribusi ini belum dirinci ke penerima tertentu.
        </p>
      ) : (
        <ul className="space-y-2">
          {beneficiaries.shares.map((share, index) => (
            <li
              key={`${share.beneficiaryPseudonym}-${share.fillSequence}-${index}`}
              className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 text-xs"
            >
              <span className="text-tawf-green">
                <span className="font-semibold">{share.beneficiaryPseudonym}</span>
                <span className="text-tawf-muted">
                  {" · "}
                  {asnafLabel(share.asnaf)}
                  {region ? ` · ${region}` : ""}
                </span>
              </span>
              <span className="font-mono text-tawf-green-light">
                {formatNominal(share.shareExact, item.currencyUnit)}
                <span className="text-tawf-muted">
                  {" dari "}
                  {formatNominal(share.aidLineApprovedExact, item.currencyUnit)}
                  {share.isFull ? " (penuh)" : " (sebagian)"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasUnassigned && (
        <p className="text-[11px] text-tawf-muted leading-relaxed">
          {formatNominal(beneficiaries.unassignedExact, item.currencyUnit)} belum dirinci ke penerima tertentu: melebihi
          kebutuhan yang tersisa pada kegiatan ini, atau berupa bantuan yang nilainya belum ditetapkan.
        </p>
      )}

      <p className="text-[11px] text-tawf-muted leading-relaxed">{beneficiaries.disclaimer}</p>
    </div>
  );
}

/** `FAKIR` as the word a donor reads, without inventing a category the server did not send. */
function asnafLabel(asnaf: string): string {
  const trimmed = asnaf.trim();
  if (!trimmed) return "Asnaf tidak tercatat";
  return trimmed
    .split(/[\s_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
