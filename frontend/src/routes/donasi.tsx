import React, { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../components/layout/PageHeader";
import { Container } from "../components/layout/Container";
import { DonationForm, ZakatCalculator } from "../features/donation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/Tabs";
import { HeartHandshake, Calculator, ShieldCheck, Sparkles } from "lucide-react";

interface DonasiSearchParams {
  category?: string;
  amount?: number;
  campaign?: string;
}

export const Route = createFileRoute("/donasi")({
  validateSearch: (search: Record<string, unknown>): DonasiSearchParams => {
    return {
      category: typeof search.category === "string" ? search.category : undefined,
      amount: typeof search.amount === "number" ? search.amount : undefined,
      campaign: typeof search.campaign === "string" ? search.campaign : undefined,
    };
  },
  component: DonasiPage,
});

function DonasiPage() {
  const search = Route.useSearch();
  const [activeTab, setActiveTab] = useState<"form" | "calc">("form");

  const [formCategory, setFormCategory] = useState<string>(
    search.category === "maal"
      ? "Zakat Maal"
      : search.category === "penghasilan"
      ? "Zakat Penghasilan"
      : search.category === "fitrah"
      ? "Zakat Fitrah"
      : search.category === "infaq"
      ? "Infaq"
      : "Zakat Maal"
  );
  const [formAmount, setFormAmount] = useState<number>(search.amount || 1000000);

  const handleApplyFromCalculator = (category: string, amount: number) => {
    setFormCategory(category);
    setFormAmount(amount);
    setActiveTab("form");
  };

  return (
    <main className="min-h-screen bg-[#f4f8f3]/30 pb-20">
      <PageHeader
        badgeText="Tunaikan Kewajiban Zakat"
        title="Salurkan Zakat, Infaq & Sedekah"
        description="Pilih jenis akad zakat Anda. Perhitungan nisab otomatis sesuai ketentuan BAZNAS dengan metode pembayaran QRIS, Virtual Account, dan USDC."
      />

      <Container className="py-10 max-w-4xl">
        {/* Navigation Tabs */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex rounded-2xl bg-white p-1.5 border border-[#dbe7dd] shadow-xs">
            <button
              type="button"
              onClick={() => setActiveTab("form")}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === "form"
                  ? "bg-[#17332c] text-white shadow-xs"
                  : "text-[#5e7a70] hover:text-[#17332c]"
              }`}
            >
              <HeartHandshake className="w-4 h-4" />
              <span>Formulir Penyaluran</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("calc")}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === "calc"
                  ? "bg-[#17332c] text-white shadow-xs"
                  : "text-[#5e7a70] hover:text-[#17332c]"
              }`}
            >
              <Calculator className="w-4 h-4" />
              <span>Kalkulator Nisab</span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "form" ? (
          <DonationForm
            initialCategory={formCategory}
            initialAmount={formAmount}
          />
        ) : (
          <ZakatCalculator onApplyAmount={handleApplyFromCalculator} />
        )}
      </Container>
    </main>
  );
}
