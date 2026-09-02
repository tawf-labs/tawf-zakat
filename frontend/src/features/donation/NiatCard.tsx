import React from "react";
import { BookOpen, Sparkles } from "lucide-react";

interface NiatCardProps {
  zakatType: string;
}

export function NiatCard({ zakatType }: NiatCardProps) {
  const niatMap: Record<
    string,
    { title: string; arabic: string; latin: string; translation: string }
  > = {
    "Zakat Maal": {
      title: "Niat Zakat Maal (Harta / Tabungan)",
      arabic: "نَوَيْتُ أَنْ أُخْرِجَ زَكَاةَ مَالِي فَرْضًا لِلَّهِ تَعَالَى",
      latin: "Nawaitu an ukhrija zakaata maali fardhan lillaahi ta'aala.",
      translation:
        "Aku berniat mengeluarkan zakat hartaku, fardhu karena Allah Ta'ala.",
    },
    "Zakat Penghasilan": {
      title: "Niat Zakat Penghasilan (Profesi)",
      arabic: "نَوَيْتُ أَنْ أُخْرِجَ زَكَاةَ كَسْبِي فَرْضًا لِلَّهِ تَعَالَى",
      latin: "Nawaitu an ukhrija zakaata kasbii fardhan lillaahi ta'aala.",
      translation:
        "Aku berniat mengeluarkan zakat dari hasil penghasilanku, fardhu karena Allah Ta'ala.",
    },
    "Zakat Fitrah": {
      title: "Niat Zakat Fitrah (Diri Sendiri)",
      arabic: "نَوَيْتُ أَنْ أُخْرِجَ زَكَاةَ الْفِطْرِ عَنْ نَفْسِي فَرْضًا لِلَّهِ تَعَالَى",
      latin: "Nawaitu an ukhrija zakaatal fithri 'an nafsii fardhan lillaahi ta'aala.",
      translation:
        "Aku berniat mengeluarkan zakat fitrah untuk diriku sendiri, fardhu karena Allah Ta'ala.",
    },
    Infaq: {
      title: "Doa Menunaikan Infaq & Sedekah",
      arabic: "رَبَّنَا تَقَبَّلْ مِنَّا إِنَّكَ أَنْتَ السَّمِيعُ الْعَلِيمُ",
      latin: "Rabbanaa taqabbal minnaa innaka antas samii'ul 'aliim.",
      translation:
        "Ya Tuhan kami, terimalah amal dari kami, sungguh Engkaulah Yang Maha Mendengar lagi Maha Mengetahui.",
    },
  };

  const currentNiat = niatMap[zakatType] || niatMap["Zakat Maal"];

  return (
    <div className="rounded-3xl border border-[#c4ed70]/80 bg-[#f4f8f3] p-6 sm:p-7 space-y-4 shadow-2xs">
      <div className="flex items-center justify-between border-b border-[#dbe7dd] pb-3">
        <div className="flex items-center gap-2 text-[#1b765e]">
          <BookOpen className="w-4 h-4" />
          <h4 className="font-serif text-sm font-bold uppercase tracking-wider text-[#17332c]">
            {currentNiat.title}
          </h4>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full">
          <Sparkles className="w-3 h-3" /> Sunnah Dibaca
        </span>
      </div>

      <div className="text-right py-2">
        <p className="font-serif text-xl sm:text-2xl font-bold text-[#17332c] leading-loose tracking-wide">
          {currentNiat.arabic}
        </p>
      </div>

      <div className="space-y-1.5 pt-1 border-t border-[#dbe7dd]/60 text-xs">
        <p className="italic text-[#1b765e] font-medium leading-relaxed">
          &quot;{currentNiat.latin}&quot;
        </p>
        <p className="text-[#5e7a70] leading-relaxed">
          <strong>Artinya:</strong> {currentNiat.translation}
        </p>
      </div>
    </div>
  );
}
