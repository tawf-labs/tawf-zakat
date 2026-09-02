import React from "react";
import { QrCode, Building2, Wallet, CheckCircle2 } from "lucide-react";

export type PaymentMethodType = "qris" | "va" | "usdc";

interface PaymentMethodSelectorProps {
  selected: PaymentMethodType;
  onSelect: (method: PaymentMethodType) => void;
}

export function PaymentMethodSelector({ selected, onSelect }: PaymentMethodSelectorProps) {
  const methods = [
    {
      id: "qris" as PaymentMethodType,
      title: "QRIS Instant",
      description: "BCA, GoPay, OVO, ShopeePay, DANA, Livin', dll.",
      icon: QrCode,
      badge: "Paling Populer",
    },
    {
      id: "va" as PaymentMethodType,
      title: "Virtual Account",
      description: "BCA, Mandiri, BNI, BRI & Bank Permata.",
      icon: Building2,
      badge: "Otomatis",
    },
    {
      id: "usdc" as PaymentMethodType,
      title: "Web3 Direct USDC",
      description: "Deposit on-chain token USDC via MetaMask / Web3 Wallet.",
      icon: Wallet,
      badge: "Kripto On-Chain",
    },
  ];

  return (
    <div className="space-y-3">
      <label className="text-xs font-semibold uppercase tracking-wider text-[#17332c]">
        Pilih Metode Pembayaran
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {methods.map((m) => {
          const Icon = m.icon;
          const isSelected = selected === m.id;

          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m.id)}
              className={`relative text-left p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                isSelected
                  ? "border-[#1b765e] bg-[#f4f8f3] ring-2 ring-[#1b765e]/20 shadow-xs"
                  : "border-[#dbe7dd] bg-white hover:border-[#1b765e]/40 hover:bg-[#f4f8f3]/40"
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    isSelected
                      ? "bg-[#1b765e] text-white"
                      : "bg-[#f4f8f3] text-[#1b765e] border border-[#dbe7dd]"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                {isSelected ? (
                  <CheckCircle2 className="w-4 h-4 text-[#1b765e]" />
                ) : (
                  <span className="text-[10px] font-semibold text-[#5e7a70] uppercase tracking-wider">
                    {m.badge}
                  </span>
                )}
              </div>

              <div>
                <h4 className="font-serif text-sm font-bold text-[#17332c]">
                  {m.title}
                </h4>
                <p className="text-[11px] text-[#5e7a70] mt-0.5 leading-snug">
                  {m.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
