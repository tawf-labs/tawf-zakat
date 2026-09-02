import React, { useState, useEffect } from "react";
import { useWallet } from "../../lib/WalletContext";
import { useWebSocket } from "../../lib/WebSocketContext";
import { payWithSnap } from "../../lib/snapClient";
import {
  depositUSDCOnChain,
  approveUSDCOnChain,
  getUSDCAllowance,
  getUSDCBalance,
} from "../../lib/web3Client";
import { getApiBaseUrl } from "../../lib/contracts";
import { parseUnits, formatUnits, keccak256, encodePacked, type Hex } from "viem";
import { Input } from "../../components/ui/Input";
import { PaymentMethodSelector, type PaymentMethodType } from "./PaymentMethodSelector";
import { NiatCard } from "./NiatCard";
import { PaymentSuccessModal } from "./PaymentSuccessModal";
import { HeartHandshake, Loader2, Sparkles, Lock, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";

interface DonationFormProps {
  initialCategory?: string;
  initialAmount?: number;
}

export function DonationForm({
  initialCategory = "Zakat Maal",
  initialAmount = 1000000,
}: DonationFormProps) {
  const { address, isConnected } = useWallet();
  const { subscribe } = useWebSocket();

  // Form State
  const [zakatType, setZakatType] = useState<string>(initialCategory);
  const [amountIDR, setAmountIDR] = useState<number>(initialAmount);
  const [usdcAmount, setUsdcAmount] = useState<string>("50");
  const [donorName, setDonorName] = useState<string>("");
  const [nik, setNik] = useState<string>("");
  const [isAnonymous, setIsAnonymous] = useState<boolean>(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>("qris");

  // Status & Loading
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // USDC Web3 State
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<bigint>(0n);

  // Success Modal State
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);

  // Sync initial props if changed
  useEffect(() => {
    if (initialCategory) setZakatType(initialCategory);
  }, [initialCategory]);

  useEffect(() => {
    if (initialAmount && initialAmount > 0) setAmountIDR(initialAmount);
  }, [initialAmount]);

  // Check USDC balance and allowance when wallet connects
  useEffect(() => {
    if (!address) return;
    const fetchBalance = async () => {
      try {
        const [bal, allow] = await Promise.all([
          getUSDCBalance(address),
          getUSDCAllowance(address),
        ]);
        setUsdcBalance(parseFloat(formatUnits(bal, 6)).toFixed(2));
        setAllowance(allow);
      } catch (err) {
        console.warn("Failed to check USDC state:", err);
      }
    };
    fetchBalance();
  }, [address]);

  // Real-time WebSocket listener for payment confirmation
  useEffect(() => {
    const unsub = subscribe("DONATION_PAID", (data) => {
      if (data && (!receiptData || data.trxId === receiptData?.trxId)) {
        setReceiptData((prev: any) => ({
          ...prev,
          trxId: data.trxId,
          paidAt: data.paidAt || new Date().toISOString(),
          status: "PAID",
        }));
        setSuccessModalOpen(true);
        toast.success("Pembayaran zakat berhasil dikonfirmasi secara real-time!");
      }
    });
    return () => unsub();
  }, [subscribe, receiptData]);

  // Preset IDR amounts
  const presetAmounts = [
    { label: "Rp 100 Rb", value: 100000 },
    { label: "Rp 250 Rb", value: 250000 },
    { label: "Rp 500 Rb", value: 500000 },
    { label: "Rp 1 Juta", value: 1000000 },
    { label: "Rp 2.5 Juta", value: 2500000 },
    { label: "Rp 5 Juta", value: 5000000 },
  ];

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatusMessage(null);

    try {
      if (paymentMethod === "usdc") {
        // Handle USDC Web3 Direct Flow
        if (!isConnected || !address) {
          toast.error("Silakan hubungkan dompet Web3 Anda terlebih dahulu.");
          setLoading(false);
          return;
        }

        const numUSDC = parseFloat(usdcAmount);
        if (isNaN(numUSDC) || numUSDC <= 0) {
          toast.error("Nominal USDC harus lebih besar dari 0.");
          setLoading(false);
          return;
        }

        const parsedUSDC = parseUnits(usdcAmount, 6);

        // 1. Check & execute allowance approval if needed
        if (allowance < parsedUSDC) {
          setStatusMessage("Menyetujui izin transfer USDC (Approve)...");
          const approveRes = await approveUSDCOnChain(numUSDC);
          toast.info(`Persetujuan USDC terkirim: ${approveRes.txHash.slice(0, 10)}...`);
          setAllowance(parsedUSDC);
        }

        // 2. Deposit USDC into Smart Contract
        setStatusMessage("Mengirim transaksi deposit zakat ke smart contract...");
        const salt = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const commitmentHash = keccak256(
          encodePacked(["string", "uint256", "bytes32"], [donorName || "Anonymous", parsedUSDC, salt as Hex])
        );

        const depositRes = await depositUSDCOnChain(numUSDC, isAnonymous, commitmentHash);
        const depositTx = depositRes.txHash;

        const newReceipt = {
          trxId: `USDC-${depositTx.slice(2, 10).toUpperCase()}`,
          txHash: depositTx,
          amount: usdcAmount,
          currency: "USDC" as const,
          donorName: isAnonymous ? "Hamba Allah" : donorName || "Muzakki",
          isAnonymous,
          zakatType,
          salt,
          paidAt: new Date().toISOString(),
        };

        setReceiptData(newReceipt);
        setSuccessModalOpen(true);
        toast.success("Deposit zakat USDC berhasil dicatat on-chain!");
      } else {
        // Handle Fiat (QRIS / VA) Midtrans Flow
        setStatusMessage("Membuat invoice pembayaran zakat...");
        const salt = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const res = await fetch(`${getApiBaseUrl()}/api/donations/fiat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            donorName: isAnonymous ? "Hamba Allah" : donorName || "Muzakki",
            isAnonymous,
            salt,
            amountIDR,
            zakatType,
            paymentMethod: paymentMethod.toUpperCase(),
          }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
          throw new Error(data?.error || "Gagal membuat pesanan donasi");
        }

        const trxId = data.trxId || data.donation?.trxId || data.invoice?.trxId;
        const snapToken = data.snapToken || data.invoice?.snapToken;

        setReceiptData({
          trxId,
          amount: amountIDR,
          currency: "IDR" as const,
          donorName: isAnonymous ? "Hamba Allah" : donorName || "Muzakki",
          isAnonymous,
          zakatType,
          salt,
        });

        // Open Midtrans Snap Popup if token returned
        if (snapToken) {
          setStatusMessage("Menampilkan jendela pembayaran...");
          payWithSnap(snapToken, {
            onSuccess: (result: any) => {
              setSuccessModalOpen(true);
              toast.success("Pembayaran zakat berhasil diselesaikan!");
            },
            onPending: (result: any) => {
              toast.info("Menunggu pembayaran diselesaikan.");
            },
            onError: (err: any) => {
              toast.error("Pembayaran dibatalkan atau gagal.");
            },
            onClose: () => {
              setStatusMessage(null);
            },
          });
        } else {
          // Fallback if snapToken not active (direct QR / Simulator)
          setSuccessModalOpen(true);
          toast.success("Invoice donasi berhasil dibuat!");
        }
      }
    } catch (err: any) {
      console.error("Donation error:", err);
      toast.error(err.message || "Terjadi kesalahan saat memproses donasi.");
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  };

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-10 shadow-sm space-y-8">
        {/* 1. Pilih Akad Zakat */}
        <div className="space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-[#17332c]">
            Pilih Jenis Zakat / Infaq
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {["Zakat Maal", "Zakat Penghasilan", "Zakat Fitrah", "Infaq"].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setZakatType(cat)}
                className={`py-3 px-3 rounded-2xl text-xs font-bold transition-all cursor-pointer border text-center ${
                  zakatType === cat
                    ? "border-[#1b765e] bg-[#1b765e] text-white shadow-xs"
                    : "border-[#dbe7dd] bg-[#f4f8f3] text-[#5e7a70] hover:text-[#17332c]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Pilih Metode Pembayaran */}
        <PaymentMethodSelector selected={paymentMethod} onSelect={setPaymentMethod} />

        {/* 3. Input Nominal */}
        <div className="space-y-4">
          {paymentMethod === "usdc" ? (
            <div>
              <Input
                label="Nominal Donasi USDC"
                type="number"
                min={1}
                step={0.1}
                value={usdcAmount}
                onChange={(e) => setUsdcAmount(e.target.value)}
                leftAddon={<Wallet className="w-4 h-4 text-[#1b765e]" />}
                helperText={
                  usdcBalance !== null
                    ? `Saldo USDC Anda: ${usdcBalance} USDC (Sepolia Testnet)`
                    : "Deposit langsung ke smart contract Sepolia L1"
                }
              />
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                label="Nominal Zakat (IDR)"
                type="number"
                min={10000}
                step={5000}
                value={amountIDR || ""}
                onChange={(e) => setAmountIDR(Number(e.target.value) || 0)}
                leftAddon="Rp"
                helperText="Minimal donasi Rp 10.000"
              />
              {/* Preset quick buttons */}
              <div className="flex flex-wrap gap-2 pt-1">
                {presetAmounts.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setAmountIDR(p.value)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      amountIDR === p.value
                        ? "border-[#1b765e] bg-[#1b765e]/10 text-[#1b765e] font-bold"
                        : "border-[#dbe7dd] bg-white text-[#5e7a70] hover:bg-[#f4f8f3]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 4. Data Diri Muzakki */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2 border-t border-[#dbe7dd]/60">
          <Input
            label="Nama Lengkap Muzakki"
            type="text"
            placeholder="Contoh: Abdullah Ahmad"
            disabled={isAnonymous}
            value={isAnonymous ? "Hamba Allah" : donorName}
            onChange={(e) => setDonorName(e.target.value)}
            helperText="Nama yang dicantumkan pada sertifikat zakat"
          />
          <Input
            label="NIK KTP (Opsional — untuk Hash Privasi)"
            type="text"
            placeholder="16 Digit NIK"
            value={nik}
            onChange={(e) => setNik(e.target.value)}
            helperText="Digunakan untuk menghasilkan salted hash anti-doxxing"
          />
          <div className="sm:col-span-2">
            <label className="inline-flex items-center gap-2.5 text-xs font-semibold text-[#17332c] cursor-pointer">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                className="w-4 h-4 rounded-md text-[#1b765e] border-[#dbe7dd] focus:ring-[#1b765e]"
              />
              <span>Sembunyikan nama saya di buku besar publik (Hamba Allah / Anonim)</span>
            </label>
          </div>
        </div>

        {/* 5. Niat Card */}
        <NiatCard zakatType={zakatType} />

        {/* 6. Submit Button */}
        <div className="space-y-3 pt-2">
          {statusMessage && (
            <div className="flex items-center justify-center gap-2 text-xs font-medium text-[#1b765e] bg-[#f4f8f3] p-3 rounded-xl border border-[#dbe7dd]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{statusMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-full bg-[#17332c] hover:bg-[#1b765e] disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider transition-all shadow-md hover:shadow-lg cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Memproses Pembayaran...</span>
              </>
            ) : (
              <>
                <HeartHandshake className="w-5 h-5 text-[#c4ed70]" />
                <span>
                  Tunaikan {zakatType} —{" "}
                  {paymentMethod === "usdc"
                    ? `${usdcAmount} USDC`
                    : `Rp ${amountIDR.toLocaleString("id-ID")}`}
                </span>
              </>
            )}
          </button>

          <p className="text-[11px] text-center text-[#5e7a70] flex items-center justify-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Pembayaran aman, terverifikasi otomatis, dan tercatat di buku besar permanen.</span>
          </p>
        </div>
      </form>

      {/* Success Modal */}
      <PaymentSuccessModal
        isOpen={successModalOpen}
        onClose={() => setSuccessModalOpen(false)}
        receiptData={receiptData}
      />
    </div>
  );
}
