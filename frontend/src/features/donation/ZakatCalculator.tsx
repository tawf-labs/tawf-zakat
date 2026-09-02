import React, { useState } from "react";
import { Calculator, CheckCircle2, AlertCircle, Sparkles, ArrowRight } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { Badge } from "../../components/ui/Badge";

interface ZakatCalculatorProps {
  onApplyAmount: (category: string, amount: number) => void;
}

export function ZakatCalculator({ onApplyAmount }: ZakatCalculatorProps) {
  const [calcType, setCalcType] = useState<"penghasilan" | "maal" | "fitrah">("penghasilan");

  // State inputs
  const [monthlyIncome, setMonthlyIncome] = useState<number>(10000000);
  const [monthlyExpense, setMonthlyExpense] = useState<number>(2000000);
  const [savingsWealth, setSavingsWealth] = useState<number>(100000000);
  const [familyMembers, setFamilyMembers] = useState<number>(4);

  // BAZNAS Standards
  const GOLD_PRICE_PER_GRAM = 1100000;
  const NISAB_GOLD_GRAMS = 85;
  const MONTHLY_NISAB_IDR = (GOLD_PRICE_PER_GRAM * NISAB_GOLD_GRAMS) / 12; // ~Rp 7.791.666
  const ANNUAL_NISAB_IDR = GOLD_PRICE_PER_GRAM * NISAB_GOLD_GRAMS; // Rp 93.500.000
  const RICE_PRICE_PER_SOK = 45000; // Standar BAZNAS 2.5 kg beras ~ Rp 45.000 / jiwa

  // Calculations
  const netIncome = Math.max(0, monthlyIncome - monthlyExpense);
  const isIncomeWajib = netIncome >= MONTHLY_NISAB_IDR;
  const incomeZakatDue = isIncomeWajib ? Math.round(netIncome * 0.025) : 0;

  const isMaalWajib = savingsWealth >= ANNUAL_NISAB_IDR;
  const maalZakatDue = isMaalWajib ? Math.round(savingsWealth * 0.025) : 0;

  const fitrahZakatDue = Math.max(1, familyMembers) * RICE_PRICE_PER_SOK;

  let calculatedAmount = 0;
  let categoryLabel = "Zakat Penghasilan";
  let isWajib = true;

  if (calcType === "penghasilan") {
    calculatedAmount = incomeZakatDue;
    categoryLabel = "Zakat Penghasilan";
    isWajib = isIncomeWajib;
  } else if (calcType === "maal") {
    calculatedAmount = maalZakatDue;
    categoryLabel = "Zakat Maal";
    isWajib = isMaalWajib;
  } else {
    calculatedAmount = fitrahZakatDue;
    categoryLabel = "Zakat Fitrah";
    isWajib = true;
  }

  return (
    <div className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#dbe7dd]/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#1b765e]/10 text-[#1b765e] flex items-center justify-center">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold text-[#17332c]">
              Kalkulator Nisab BAZNAS
            </h3>
            <p className="text-xs text-[#5e7a70]">
              Simulasi perhitungan zakat sesuai syariat Islam
            </p>
          </div>
        </div>
        <Badge variant="sharia">Standar 85g Emas</Badge>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCalcType("penghasilan")}
          className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            calcType === "penghasilan"
              ? "bg-[#17332c] text-white shadow-xs"
              : "bg-[#f4f8f3] text-[#5e7a70] hover:text-[#17332c] border border-[#dbe7dd]"
          }`}
        >
          Penghasilan
        </button>
        <button
          type="button"
          onClick={() => setCalcType("maal")}
          className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            calcType === "maal"
              ? "bg-[#17332c] text-white shadow-xs"
              : "bg-[#f4f8f3] text-[#5e7a70] hover:text-[#17332c] border border-[#dbe7dd]"
          }`}
        >
          Zakat Maal (Tabungan)
        </button>
        <button
          type="button"
          onClick={() => setCalcType("fitrah")}
          className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            calcType === "fitrah"
              ? "bg-[#17332c] text-white shadow-xs"
              : "bg-[#f4f8f3] text-[#5e7a70] hover:text-[#17332c] border border-[#dbe7dd]"
          }`}
        >
          Zakat Fitrah
        </button>
      </div>

      {/* Inputs per Tab */}
      <div className="space-y-4 pt-1">
        {calcType === "penghasilan" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Penghasilan Bulanan (Gaji + Tunjangan)"
              type="number"
              value={monthlyIncome || ""}
              onChange={(e) => setMonthlyIncome(Number(e.target.value) || 0)}
              leftAddon="Rp"
            />
            <Input
              label="Kebutuhan Pokok / Tanggungan Bulanan"
              type="number"
              value={monthlyExpense || ""}
              onChange={(e) => setMonthlyExpense(Number(e.target.value) || 0)}
              leftAddon="Rp"
            />
          </div>
        )}

        {calcType === "maal" && (
          <Input
            label="Total Simpanan Tabungan, Deposito & Emas (IDR)"
            type="number"
            value={savingsWealth || ""}
            onChange={(e) => setSavingsWealth(Number(e.target.value) || 0)}
            leftAddon="Rp"
            helperText="Telah mencapai haul (1 tahun kepemilikan)"
          />
        )}

        {calcType === "fitrah" && (
          <Input
            label="Jumlah Anggota Keluarga (Jiwa)"
            type="number"
            min={1}
            max={20}
            value={familyMembers || ""}
            onChange={(e) => setFamilyMembers(Number(e.target.value) || 1)}
            helperText="Standar Rp 45.000 / jiwa (setara 2.5 kg beras)"
          />
        )}
      </div>

      {/* Result Card */}
      <div className="rounded-2xl border border-[#1b765e]/20 bg-[#f4f8f3] p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="space-y-1 text-center sm:text-left">
          <div className="flex items-center justify-center sm:justify-start gap-1.5">
            {isWajib ? (
              <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Wajib Ditunaikan (2.5%)
              </span>
            ) : (
              <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Belum Mencapai Nisab (Dianjurkan Infaq)
              </span>
            )}
          </div>
          <div className="pt-1">
            <span className="text-[11px] font-semibold text-[#5e7a70] uppercase tracking-wider">
              Kewajiban Zakat Anda:
            </span>
            <p className="font-serif text-2xl font-bold text-[#17332c]">
              Rp {calculatedAmount.toLocaleString("id-ID")}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onApplyAmount(categoryLabel, calculatedAmount > 0 ? calculatedAmount : 50000)}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#17332c] hover:bg-[#1b765e] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs cursor-pointer"
        >
          <Sparkles className="w-4 h-4 text-[#c4ed70]" />
          <span>Terapkan ke Form Donasi</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
