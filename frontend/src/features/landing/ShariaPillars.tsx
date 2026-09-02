import React from "react";
import { Container } from "../../components/layout/Container";
import { ShieldCheck, UserCheck, Scale, FileSpreadsheet, Lock, CheckCircle2 } from "lucide-react";
import { Badge } from "../../components/ui/Badge";

export function ShariaPillars() {
  const pillars = [
    {
      step: "01",
      role: "Amil Operasional",
      icon: UserCheck,
      title: "Pengajuan & Survei Mustahik",
      description:
        "Amil melakukan verifikasi lapangan kelayakan mustahik sesuai 8 Asnaf, mengunggah berkas SKTM dan metadata survei yang terlindungi privasinya.",
      badge: "Tahap 1: Intake",
    },
    {
      step: "02",
      role: "Dewan Pengawas Syariah (DPS)",
      icon: Scale,
      title: "Otorisasi Fikih & Safe Multisig",
      description:
        "Komite ulama DPS menelaah dokumen penyaluran. Dana bantuan tidak dapat dicairkan tanpa persetujuan kuorum minimal 2 dari 3 ustadz pengawas.",
      badge: "Tahap 2: Hak Veto Fikih",
    },
    {
      step: "03",
      role: "Auditor Independen",
      icon: FileSpreadsheet,
      title: "Audit BAST & Opini WTP",
      description:
        "Auditor independen memeriksa bukti mutasi bank dan Berita Acara Serah Terima (BAST), lalu menerbitkan atestasi kepatuhan akuntansi PSAK 109.",
      badge: "Tahap 3: Ex-Post Audit",
    },
  ];

  return (
    <section className="py-20 bg-white border-y border-[#dbe7dd]/60">
      <Container>
        {/* Section Heading */}
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <Badge variant="sharia">Integritas 3 Lapis</Badge>
          <h2 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-[#17332c]">
            Pengawasan Berlapis untuk Menjaga Amanah Zakat
          </h2>
          <p className="text-base text-[#5e7a70] leading-relaxed">
            Tidak ada satu pihak pun yang dapat menyalahgunakan atau mencairkan dana zakat secara sepihak. Sistem kami memisahkan kewenangan secara tegas sesuai prinsip tata kelola syariah modern.
          </p>
        </div>

        {/* 3 Pillars Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-14">
          {pillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.step}
                className="relative rounded-3xl border border-[#dbe7dd] bg-[#f4f8f3]/50 p-7 hover:bg-[#f4f8f3] hover:border-[#1b765e]/30 transition-all group flex flex-col justify-between shadow-2xs"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-serif text-2xl font-bold text-[#1b765e]/40 group-hover:text-[#1b765e] transition-colors">
                      {pillar.step}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#1b765e] bg-white px-2.5 py-1 rounded-full border border-[#dbe7dd]">
                      {pillar.badge}
                    </span>
                  </div>

                  <div className="w-12 h-12 rounded-2xl bg-white border border-[#dbe7dd] flex items-center justify-center text-[#1b765e] shadow-2xs group-hover:scale-110 transition-transform">
                    <Icon className="w-6 h-6" />
                  </div>

                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#1b765e]">
                      {pillar.role}
                    </span>
                    <h3 className="font-serif text-lg font-bold text-[#17332c] mt-1">
                      {pillar.title}
                    </h3>
                  </div>

                  <p className="text-sm text-[#5e7a70] leading-relaxed">
                    {pillar.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Sharia Invariant Box */}
        <div className="mt-12 rounded-3xl border border-[#c4ed70] bg-[#f4f8f3] p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xs">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#1b765e] text-[#c4ed70] flex items-center justify-center shrink-0">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-serif text-lg font-bold text-[#17332c]">
                Jaminan Hak Amil Terkunci Sistem (Maksimal 12.5%)
              </h4>
              <p className="text-sm text-[#5e7a70] mt-1 max-w-2xl leading-relaxed">
                Smart contract mengunci batas atas hak operasional amil maksimal <strong>1/8 (12.5%)</strong> sesuai batasan syariah BAZNAS. Minimal <strong>87.5%</strong> mutlak tidak dapat dialihkan selain untuk hak mustahik.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <div className="px-5 py-3 rounded-2xl bg-white border border-[#dbe7dd] text-center shadow-2xs">
              <span className="block text-[11px] font-semibold text-[#5e7a70] uppercase tracking-wider">
                Alokasi Mustahik
              </span>
              <span className="font-serif text-2xl font-bold text-[#1b765e]">
                Min. 87.5%
              </span>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
