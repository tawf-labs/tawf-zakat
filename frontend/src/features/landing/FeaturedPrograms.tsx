import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HeartHandshake, ArrowRight, Users } from "lucide-react";
import { Container } from "../../components/layout/Container";
import { Badge } from "../../components/ui/Badge";
import { api, money, categories, campaignCoverSrc, type Campaign } from "../crowdfunding/client";

function CampaignPhoto({ campaign }: { campaign: Campaign }) {
  const [failed, setFailed] = useState(false);
  const url = campaignCoverSrc(campaign);
  return (
    <div className="aspect-[16/10] overflow-hidden rounded-2xl bg-[#f4f8f3] flex items-center justify-center">
      {url && !failed ? (
        <img src={url} alt={campaign.title} loading="lazy" referrerPolicy="no-referrer"
          className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <div className="flex flex-col items-center gap-2 text-[#5e7a70]">
          <HeartHandshake className="h-10 w-10" aria-hidden="true" />
          <span className="text-xs">Foto kampanye belum tersedia</span>
        </div>
      )}
    </div>
  );
}

export function FeaturedPrograms() {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["public-featured-campaigns"],
    queryFn: () => api<{ campaigns: Campaign[] }>("/campaigns", { public: true }),
    retry: false,
  });
  // Keep the landing concise; the complete public catalogue remains on /kampanye.
  const campaigns = (data?.campaigns ?? [])
    .filter((campaign) => campaign.status === "PUBLISHED" && Date.parse(campaign.endsAt) > Date.now())
    .slice(0, 3);
  const linkStyle = "inline-flex min-h-11 items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#1b765e] hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1b765e]";

  return (
    <section id="kampanye-infak" aria-labelledby="kampanye-infak-heading" className="py-16 sm:py-20 bg-[#f4f8f3]/40 border-b border-[#dbe7dd]/60">
      <Container>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div className="space-y-3 max-w-2xl">
            <Badge variant="success">Sedang Digalang</Badge>
            <h2 id="kampanye-infak-heading" className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-[#17332c]">
              Temukan Kebaikan yang Ingin Anda Dukung
            </h2>
            <p className="text-base text-[#5e7a70]">
              Kampanye infak dari individu dan organisasi yang telah diperiksa sebelum diterbitkan.
            </p>
          </div>
          <div className="flex flex-col items-start shrink-0">
            <Link to="/kampanye" className={linkStyle}>Lihat Semua Kampanye <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
            <Link to="/galang-dana" className={linkStyle}>Galang Dana <HeartHandshake className="w-4 h-4" aria-hidden="true" /></Link>
          </div>
        </div>

        {isPending ? (
          <p role="status" className="rounded-3xl border border-[#dbe7dd] bg-white p-8 text-[#5e7a70]">Memuat kampanye infak…</p>
        ) : isError ? (
          <div role="alert" className="rounded-3xl border border-[#dbe7dd] bg-white p-8 text-[#17332c]">
            <p>Kampanye belum dapat dimuat. Silakan coba lagi.</p>
            <button type="button" onClick={() => void refetch()} disabled={isFetching} className={`${linkStyle} mt-2 cursor-pointer disabled:opacity-50`}>
              {isFetching ? "Memuat ulang…" : "Coba Lagi"}
            </button>
          </div>
        ) : campaigns.length === 0 ? (
          <p role="status" className="rounded-3xl border border-[#dbe7dd] bg-white p-8 text-[#5e7a70]">Belum ada kampanye infak aktif. Kunjungi daftar kampanye untuk melihat kampanye yang telah diterbitkan.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {campaigns.map((campaign) => {
              const percentage = campaign.targetAmount > 0
                ? Math.max(0, Math.min(100, (campaign.collectedAmount / campaign.targetAmount) * 100)) : 0;
              return (
                <article key={campaign.id} className="min-w-0 rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-7 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between gap-6">
                  <div className="space-y-4 min-w-0">
                    <CampaignPhoto key={`${campaign.id}:${campaignCoverSrc(campaign)}`} campaign={campaign} />
                    <Badge variant="success">{categories[campaign.category] || "Infak"}</Badge>
                    <h3 className="font-serif text-xl font-bold text-[#17332c] leading-snug break-words">{campaign.title}</h3>
                    <p className="text-sm text-[#5e7a70] leading-relaxed line-clamp-3 break-words">{campaign.summary}</p>
                    <div className="flex items-start gap-2 text-xs text-[#5e7a70]">
                      <Users className="w-4 h-4 shrink-0 text-[#1b765e]" aria-hidden="true" />
                      <span className="break-words min-w-0">Penggalang: <strong>{campaign.organizer.organizationName || campaign.organizer.name}</strong></span>
                    </div>
                    <div className="space-y-2 pt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#5e7a70]">Terkumpul</span>
                        <span className="font-bold text-[#17332c]">{Math.round(percentage)}%</span>
                      </div>
                      <progress value={percentage} max={100} aria-label={`Kemajuan infak ${campaign.title}`}
                        className="block h-2 w-full overflow-hidden rounded-full accent-[#1b765e] [&::-webkit-progress-bar]:bg-[#e8f0e8] [&::-webkit-progress-value]:bg-[#1b765e] [&::-moz-progress-bar]:bg-[#1b765e]" />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
                        <span className="text-[#1b765e] font-bold">{money(campaign.collectedAmount)}</span>
                        <span className="text-[#5e7a70]">Target: {money(campaign.targetAmount)}</span>
                      </div>
                    </div>
                  </div>
                  <Link to="/kampanye/$campaignId" params={{ campaignId: campaign.id }}
                    aria-label={`Lihat Kampanye: ${campaign.title}`}
                    className="w-full min-h-11 inline-flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#17332c] hover:bg-[#1b765e] text-white font-bold text-xs uppercase tracking-wider transition-colors shadow-2xs focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1b765e]">
                    <HeartHandshake className="w-4 h-4" aria-hidden="true" /> Lihat Kampanye
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </Container>
    </section>
  );
}
