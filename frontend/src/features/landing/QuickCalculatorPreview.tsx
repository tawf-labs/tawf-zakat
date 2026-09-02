import React, { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Calculator, ArrowRight, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { Container } from "../../components/layout/Container";
import { Badge } from "../../components/ui/Badge";
import { Input } from "../../components/ui/Input";

export function QuickCalculatorPreview() {
  const [calcType, setCalcType] = useState<"penghasilan" | "maal">("penghasilan");
  const [income, setIncome] = useState<number>(10000000);
  const [expense, setExpense] = useState<number>(2000000);
  const [wealth, setWealth] = useState<number>(90000000);

  // Nisab Standards BAZNAS (Gold benchmark ~Rp 1.100.000 / gram)
  const GOLD_PRICE_PER_GRAM = 1100000;
  const NISAB_GOLD_GRAMS = 85;
  const MONTHLY_NISAB_IDR = (GOLD_PRICE_PER_GRAM * NISAB_GOLD_GRAMS) / 12; // ~Rp 7.791.666
  const ANNUAL_NISAB_IDR = GOLD_PRICE_PER_GRAM * NISAB_GOLD_GRAMS; // Rp 93.500.000

  // Income Zakat Calculation
  const netMonthlyIncome = Math.max(0, income - expense);
  const isIncomeWajib = netMonthlyIncome >= MONTHLY_NISAB_IDR;
  const monthlyZakatDue = isIncomeWajib ? Math.round(netMonthlyIncome * 0.025) : 0;

  // Maal Zakat Calculation
  const isMaalWajib = wealth >= ANNUAL_NISAB_IDR;
  const maalZakatDue = isMaalWajib ? Math.round(wealth * 0.025) : 0;

  const currentDue = calcType === "penghasilan" ? monthlyZakatDue : maalZakatDue;
  const isCurrentWajib = calcType === "penghasilan" ? isIncomeWajib : isMaalWajib;

  return (
    <section className="py-20 bg-white">
      <Container>
        <div className="max-w-4xl mx-auto">
          <div className="rounded-3xl border border-[#dbe7dd] bg-gradient-to-b from-[#f4f8f3] to-white p-6 sm:p-10 shadow-lg space-y-8">
            {/* Header */}
            <div className="text-center space-y-3">
              <Badge variant="sharia">Kalkulator Syariah BAZNAS</Badge>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#17332c]">
                Hitung Kewajiban Zakat Anda dalam 1 Menit
              </h2>
              <p className="text-sm text-[#5e7a70] max-w-xl mx-auto">
                Berdasarkan standar nisab emas 85 gram. Ketahui apakah penghasilan atau simpanan Anda sudah memenuhi syarat wajib zakat (2.5%).
              </p>
            </div>

            {/* Type Selector Tabs */}
            <div className="flex justify-center">
              <div className="inline-flex rounded-2xl bg-[#eaf3e8] p-1.5 border border-[#dbe7dd]">
                <button
                  type="button"
                  onClick={() => setCalcType("penghasilan")}
                  className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    calcType === "penghasilan"
                      ? "bg-white text-[#17332c] shadow-xs"
                      : "text-[#5e7a70] hover:text-[#17332c]"
                  }`}
                >
                  Zakat Penghasilan / Profesi
                </button>
                <button
                  type="button"
                  onClick={() => setCalcType("maal")}
                  className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    calcType === "maal"
                      ? "bg-white text-[#17332c] shadow-xs"
                      : "text-[#5e7a70] hover:text-[#17332c]"
                  }`}
                >
                  Zakat Maal (Tabungan & Harta)
                </button>
              </div>
            </div>

            {/* Form Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-white p-6 rounded-2xl border border-[#dbe7dd]">
              {calcType === "penghasilan" ? (
                <>
                  <Input
                    label="Penghasilan / Gaji Bulanan (IDR)"
                    type="number"
                    value={income || ""}
                    onChange={(e) => setIncome(Number(e.target.value) || 0)}
                    leftAddon="Rp"
                    helperText="Termasuk gaji pokok, tunjangan, dan bonus rutin"
                  />
                  <Input
                    label="Kebutuhan Pokok / Cicilan Bulanan (IDR)"
                    type="number"
                    value={expense || ""}
                    onChange={(e) => setExpense(Number(e.target.value) || 0)}
                    leftAddon="Rp"
                    helperText="Pengeluaran dasar sandang, pangan, & tanggungan"
                  />
                </>
              ) : (
                <div className="sm:col-span-2">
                  <Input
                    label="Total Tabungan, Deposito, Emas, & Investasi (IDR)"
                    type="number"
                    value={wealth || ""}
                    onChange={(e) => setWealth(Number(e.target.value) || 0)}
                    leftAddon="Rp"
                    helperText="Harta yang telah dimiliki dan mengendap selama 1 tahun hijriyah (haul)"
                  />
                </div>
              )}
            </div>

            {/* Results Box */}
            <div className="rounded-2xl border border-[#1b765e]/20 bg-[#1b765e]/5 p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="space-y-1 text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  {isCurrentWajib ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Sudah Mencapai Nisab (Wajib Zakat)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full">
                      <AlertCircle className="w-3.5 h-3.5" /> Belum Mencapai Nisab (Dianjurkan Infaq)
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#5e7a70] pt-1">
                  {calcType === "penghasilan"
                    ? `Nisab Bulanan: Rp ${Math.round(MONTHLY_NISAB_IDR).toLocaleString("id-ID")}`
                    : `Nisab Tahunan: Rp ${Math.round(ANNUAL_NISAB_IDR).toLocaleString("id-ID")}`}
                </p>
                <div className="pt-2">
                  <span className="text-xs font-semibold text-[#5e7a70] uppercase tracking-wider">
                    Kewajiban Zakat Anda (2.5%):
                  </span>
                  <p className="font-serif text-3xl font-bold text-[#17332c]">
                    Rp {currentDue.toLocaleString("id-ID")}
                    <span className="text-xs font-sans text-[#5e7a70] font-normal ml-1.5">
                      {calcType === "penghasilan" ? "/ bulan" : "/ tahun"}
                    </span>
                  </p>
                </div>
              </div>

              {/* Action Button */}
              <div className="shrink-0">
                <Link
                  to="/donasi"
                  search={{
                    category: calcType,
                    amount: currentDue > 0 ? currentDue : 100000,
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-[#17332c] px-7 py-3.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[#1b765e] shadow-md transition-all"
                >
                  <Sparkles className="w-4 h-4 text-[#c4ed70]" />
                  <span>Salurkan Jumlah Ini</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
