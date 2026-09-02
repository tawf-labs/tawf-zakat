import React from "react";
import { Link } from "@tanstack/react-router";
import { HeartHandshake, ArrowRight, ShieldCheck, Users, Sparkles } from "lucide-react";
import { Container } from "../../components/layout/Container";
import { Badge } from "../../components/ui/Badge";
import { Progress } from "../../components/ui/Progress";

export function FeaturedPrograms() {
  const campaigns = [
    {
      id: "pangan-dhuafa",
      asnaf: "Fakir & Miskin",
      title: "Paket Sembako & Ketahanan Pangan Keluarga Prasejahtera",
      description: "Penyaluran beras, minyak, dan kebutuhan pokok bagi keluarga mustahik di pelosok daerah terdampak krisis ekonomi.",
      targetIDR: 50000000,
      collectedIDR: 38500000,
      beneficiaries: 120,
      location: "Jawa Barat & Banten",
      tagColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    {
      id: "beasiswa-santri",
      asnaf: "Fisabilillah",
      title: "Beasiswa Pendidikan & Perlengkapan Belajar Santri Yatim",
      description: "Bantuan SPP, seragam, dan kitab santri dhuafa penghafal Al-Qur'an di pondok pesantren pedesaan.",
      targetIDR: 35000000,
      collectedIDR: 29800000,
      beneficiaries: 45,
      location: "Jawa Tengah & DI Yogyakarta",
      tagColor: "bg-blue-50 text-blue-700 border-blue-200",
    },
    {
      id: "modal-usaha-mikro",
      asnaf: "Gharimin & Mustahik",
      title: "Pemberdayaan Modal Usaha Tanpa Riba Pedagang Kecil",
      description: "Inisiasi modal usaha produktif dan pelunasan jeratan hutang darurat untuk pedagang kaki lima prasejahtera.",
      targetIDR: 40000000,
      collectedIDR: 21500000,
      beneficiaries: 30,
      location: "Jabodetabek",
      tagColor: "bg-amber-50 text-amber-700 border-amber-200",
    },
  ];

  return (
    <section className="py-20 bg-[#f4f8f3]/40 border-b border-[#dbe7dd]/60">
      <Container>
        {/* Section Heading */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div className="space-y-3 max-w-2xl">
            <Badge variant="sharia">Program 8 Asnaf Terverifikasi</Badge>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-[#17332c]">
              Program Penyaluran yang Siap Menerima Zakat Anda
            </h2>
            <p className="text-base text-[#5e7a70]">
              Setiap program telah melewati telaah fikih oleh Dewan Pengawas Syariah (DPS) dan dilengkapi dokumentasi serah terima (BAST).
            </p>
          </div>
          <Link
            to="/transparansi"
            className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#1b765e] hover:underline underline-offset-4"
          >
            <span>Lihat Semua Program & BAST</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Campaign Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {campaigns.map((camp) => {
            const percentage = Math.min(100, Math.round((camp.collectedIDR / camp.targetIDR) * 100));

            return (
              <div
                key={camp.id}
                className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-7 shadow-xs hover:shadow-md transition-all flex flex-col justify-between space-y-6"
              >
                <div className="space-y-4">
                  {/* Top Badge & Sharia Verified Mark */}
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full border ${camp.tagColor}`}>
                      Asnaf: {camp.asnaf}
                    </span>
                    <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Verifikasi DPS</span>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <h3 className="font-serif text-xl font-bold text-[#17332c] leading-snug">
                    {camp.title}
                  </h3>
                  <p className="text-xs text-[#5e7a70] leading-relaxed line-clamp-3">
                    {camp.description}
                  </p>

                  {/* Beneficiaries info */}
                  <div className="flex items-center gap-2 text-xs text-[#5e7a70] pt-1">
                    <Users className="w-4 h-4 text-[#1b765e]" />
                    <span>Target: <strong>{camp.beneficiaries} Mustahik</strong> ({camp.location})</span>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#5e7a70]">Terkumpul</span>
                      <span className="font-bold text-[#17332c]">{percentage}%</span>
                    </div>
                    <Progress value={percentage} />
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-[#1b765e] font-bold">
                        Rp {camp.collectedIDR.toLocaleString("id-ID")}
                      </span>
                      <span className="text-[#5e7a70]">
                        Target: Rp {camp.targetIDR.toLocaleString("id-ID")}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Donate CTA */}
                <div className="pt-2">
                  <Link
                    to="/donasi"
                    search={{
                      campaign: camp.id,
                      category: "infaq",
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#17332c] hover:bg-[#1b765e] text-white font-bold text-xs uppercase tracking-wider transition-colors shadow-2xs"
                  >
                    <HeartHandshake className="w-4 h-4" />
                    <span>Salurkan ke Program Ini</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
