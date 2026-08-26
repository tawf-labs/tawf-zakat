import React, { useState, useEffect, useCallback } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { QrCode, Wallet, Shield, Copy, Check, ExternalLink, Lock, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { depositUSDCOnChain, approveUSDCOnChain, getUSDCAllowance, getUSDCBalance } from "../../lib/web3Client";
import { useWallet } from "../../lib/WalletContext";
import { parseUnits, formatUnits } from "viem";
import { payWithSnap } from "../../lib/snapClient";

export function DonateSection() {
  const { address, formattedAddress, isConnected } = useWallet();

  const [activeTab, setActiveTab] = useState<"fiat" | "usdc">("fiat");

  // Fiat State
  const [donorName, setDonorName] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [zakatType, setZakatType] = useState("Zakat Maal");
  const [amountIDR, setAmountIDR] = useState("1000000");
  const [loading, setLoading] = useState(false);
  const [fiatInvoice, setFiatInvoice] = useState<any>(null);
  const [copiedSalt, setCopiedSalt] = useState(false);
  const [timeLeft, setTimeLeft] = useState(900); // 15 mins in seconds

  // Web3 State
  const [usdcAmount, setUsdcAmount] = useState("100");
  const [usdcAnonymous, setUsdcAnonymous] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [currentAllowance, setCurrentAllowance] = useState<bigint>(0n);
  const [isApproving, setIsApproving] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const [web3Status, setWeb3Status] = useState<string | null>(null);
  const [web3Error, setWeb3Error] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);

  const presetAmountsIDR = [
    { label: "Rp 250 Rb", value: "250000" },
    { label: "Rp 500 Rb", value: "500000" },
    { label: "Rp 1 Juta", value: "1000000" },
    { label: "Rp 2.5 Juta", value: "2500000" },
    { label: "Rp 5 Juta", value: "5000000" },
  ];

  // Timer countdown when invoice is active
  useEffect(() => {
    if (!fiatInvoice || fiatInvoice.status === "PAID" || fiatInvoice.status === "BATCHED") return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [fiatInvoice]);

  // Smart Polling for payment status
  useEffect(() => {
    if (!fiatInvoice || fiatInvoice.status === "PAID" || fiatInvoice.status === "BATCHED") return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:3001/api/donations/status/${fiatInvoice.trxId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.donation && (data.donation.status === "PAID" || data.donation.status === "BATCHED")) {
            setFiatInvoice((prev: any) => ({
              ...prev,
              status: data.donation.status,
              paidAt: data.donation.paidAt,
              batchId: data.donation.batchId,
            }));
          }
        }
      } catch (err) {
        // Silent error during polling
      }
    }, 2500);

    return () => clearInterval(pollInterval);
  }, [fiatInvoice]);

  // Refresh USDC Balance and Allowance
  const refreshUSDCState = useCallback(async () => {
    if (!address) return;
    try {
      const [bal, allow] = await Promise.all([
        getUSDCBalance(address),
        getUSDCAllowance(address),
      ]);
      setUsdcBalance(parseFloat(formatUnits(bal, 6)).toFixed(2));
      setCurrentAllowance(allow);
    } catch (err) {
      console.warn("Failed to check USDC balance/allowance:", err);
    }
  }, [address]);

  useEffect(() => {
    if (isConnected && address) {
      refreshUSDCState();
    }
  }, [isConnected, address, refreshUSDCState]);

  const targetAmountBigInt = parseUnits(usdcAmount || "0", 6);
  const needsApproval = currentAllowance < targetAmountBigInt;

  const handleApprove = async () => {
    setIsApproving(true);
    setWeb3Status("Membuka MetaMask... Mohon setujui batas izin (Allowance) USDC.");
    setWeb3Error(null);

    try {
      await approveUSDCOnChain(Number(usdcAmount));
      setWeb3Status("Izin USDC Berhasil Disetujui di Sepolia! Sekarang Anda dapat menyetor donasi.");
      await refreshUSDCState();
    } catch (err: any) {
      setWeb3Status(null);
      setWeb3Error(err.shortMessage || err.message || "Persetujuan izin USDC dibatalkan di MetaMask.");
    } finally {
      setIsApproving(false);
    }
  };

  const handleUsdcDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsApproval) {
      await handleApprove();
      return;
    }

    setIsDepositing(true);
    setWeb3Status("Membuka MetaMask... Mohon konfirmasi transaksi setoran donasi USDC.");
    setWeb3Error(null);
    setTxHash(null);

    try {
      const res = await depositUSDCOnChain(Number(usdcAmount), usdcAnonymous);
      setWeb3Status("Donasi USDC Berhasil Diterima & Terkunci di Vault Sepolia L1!");
      setTxHash(res.txHash);
      setExplorerUrl(res.explorerUrl);
      await refreshUSDCState();
    } catch (err: any) {
      setWeb3Status(null);
      setWeb3Error(err.shortMessage || err.message || "Transaksi setoran dibatalkan di MetaMask.");
    } finally {
      setIsDepositing(false);
    }
  };

  const handleFiatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch("http://localhost:3001/api/donations/fiat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorName: isAnonymous ? "Hamba Allah" : donorName || "Muzakki",
          isAnonymous,
          amountIDR: Number(amountIDR),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setFiatInvoice(data.invoice);
        setTimeLeft(900);

        if (data.invoice?.snapToken) {
          setTimeout(() => {
            triggerSnapModal(data.invoice.snapToken);
          }, 300);
        }
      } else {
        const randomSalt = `salt_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
        const randomTrx = `TRX-20260826-${Math.floor(1000 + Math.random() * 9000)}`;
        setFiatInvoice({
          trxId: randomTrx,
          donorName: isAnonymous ? "Hamba Allah" : donorName || "Muzakki",
          isAnonymous,
          salt: randomSalt,
          amountIDR: Number(amountIDR),
          timestamp: new Date().toISOString(),
          status: "PENDING",
          paymentMethod: "QRIS",
          qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=MOCK-QRIS-${randomTrx}`,
        });
        setTimeLeft(900);
      }
    } catch (err) {
      const randomSalt = `salt_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
      const randomTrx = `TRX-20260826-${Math.floor(1000 + Math.random() * 9000)}`;
      setFiatInvoice({
        trxId: randomTrx,
        donorName: isAnonymous ? "Hamba Allah" : donorName || "Muzakki",
        isAnonymous,
        salt: randomSalt,
        amountIDR: Number(amountIDR),
        timestamp: new Date().toISOString(),
        status: "PENDING",
        paymentMethod: "QRIS",
        qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=MOCK-QRIS-${randomTrx}`,
      });
      setTimeLeft(900);
    } finally {
      setLoading(false);
    }
  };

  const triggerSnapModal = (token?: string) => {
    const snapToken = token || fiatInvoice?.snapToken;
    if (!snapToken) {
      if (fiatInvoice?.redirectUrl) {
        window.open(fiatInvoice.redirectUrl, "_blank");
      }
      return;
    }

    payWithSnap(snapToken, {
      onSuccess: function (result: any) {
        setFiatInvoice((prev: any) => ({
          ...prev,
          status: "PAID",
          paidAt: result.transaction_time || new Date().toISOString(),
        }));
      },
      onPending: function (result: any) {
        console.log("Snap Pending:", result);
      },
      onError: function (result: any) {
        console.warn("Snap Error:", result);
      },
      onClose: function () {
        console.log("Snap Modal Closed");
      },
    });
  };

  const handleResetDonation = () => {
    setFiatInvoice(null);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSalt(true);
    setTimeout(() => setCopiedSalt(false), 2000);
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <section id="donate" className="py-16 px-6 max-w-5xl mx-auto">
      <div className="text-center mb-10">
        <span className="text-xs uppercase tracking-[0.25em] text-[#C5A869] font-semibold block mb-2">
          Dual-Gate Inflow Architecture
        </span>
        <h2 className="text-3xl md:text-5xl font-serif font-medium text-[#0F3D30]">
          Salurkan Zakat Anda Secara Transparan
        </h2>
        <p className="text-sm md:text-base text-[#555555] max-w-2xl mx-auto mt-3">
          Pilih jalur donasi yang Anda inginkan. Dana masuk secara terprogram dialokasikan minimal 87.5% untuk Mustahik dan maksimal 12.5% untuk Amil.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex justify-center mb-8">
        <div className="bg-[#0F3D30]/5 p-1.5 rounded-full inline-flex border border-[#0F3D30]/10">
          <button
            onClick={() => {
              setActiveTab("fiat");
              setFiatInvoice(null);
            }}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "fiat"
                ? "bg-[#0F3D30] text-[#F9F6F0] shadow-xs"
                : "text-[#555555] hover:text-[#0F3D30]"
            }`}
          >
            <QrCode className="w-4 h-4" /> Jalur Fiat (QRIS / VA)
          </button>
          <button
            onClick={() => setActiveTab("usdc")}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "usdc"
                ? "bg-[#0F3D30] text-[#F9F6F0] shadow-xs"
                : "text-[#555555] hover:text-[#0F3D30]"
            }`}
          >
            <Wallet className="w-4 h-4" /> Jalur Web3 (USDC Vault)
          </button>
        </div>
      </div>

      {/* Tab 1: Fiat Inflow */}
      {activeTab === "fiat" && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          <div className="md:col-span-7">
            <Card elevated>
              <h3 className="font-serif text-2xl text-[#0F3D30] font-semibold mb-2">
                Formulir Donasi Zakat Fiat
              </h3>
              <p className="text-xs text-[#555555] mb-6">
                Pembayaran fisik diproses via QRIS/VA dan diagregasi harian ke Merkle Root Ethereum L1.
              </p>

              <form onSubmit={handleFiatSubmit} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1A] uppercase tracking-wider mb-2">
                    Jenis Zakat / Infaq
                  </label>
                  <select
                    value={zakatType}
                    onChange={(e) => setZakatType(e.target.value)}
                    className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                  >
                    <option value="Zakat Maal">Zakat Maal (Harta / Penghasilan)</option>
                    <option value="Zakat Fitrah">Zakat Fitrah</option>
                    <option value="Infaq & Sedekah">Infaq & Sedekah</option>
                    <option value="Fidyah">Fidyah</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wider">
                      Nama Muzakki
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-[#0F3D30] font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isAnonymous}
                        onChange={(e) => setIsAnonymous(e.target.checked)}
                        className="rounded accent-[#0F3D30]"
                      />
                      Mode Hamba Allah (Private)
                    </label>
                  </div>
                  <input
                    type="text"
                    disabled={isAnonymous}
                    value={isAnonymous ? "Hamba Allah (Nama Disamarkan)" : donorName}
                    onChange={(e) => setDonorName(e.target.value)}
                    placeholder="Masukkan nama lengkap Anda..."
                    className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30] disabled:bg-stone-200 disabled:text-stone-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1A] uppercase tracking-wider mb-2">
                    Nominal Zakat (IDR)
                  </label>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {presetAmountsIDR.map((item) => (
                      <button
                        type="button"
                        key={item.value}
                        onClick={() => setAmountIDR(item.value)}
                        className={`py-2 px-2 text-xs rounded-lg border font-medium transition-all cursor-pointer ${
                          amountIDR === item.value
                            ? "bg-[#0F3D30] text-[#F9F6F0] border-[#0F3D30]"
                            : "bg-[#F9F6F0] text-[#1A1A1A] border-[#0F3D30]/10 hover:border-[#0F3D30]/30"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-3 text-sm font-semibold text-[#555555]">
                      Rp
                    </span>
                    <input
                      type="number"
                      value={amountIDR}
                      onChange={(e) => setAmountIDR(e.target.value)}
                      placeholder="0"
                      className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl pl-12 pr-4 py-2.5 text-base font-semibold text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                    />
                  </div>
                </div>

                <div className="bg-[#F9F6F0] rounded-xl p-3 border border-[#0F3D30]/10 text-xs flex justify-between items-center text-[#555555]">
                  <div>
                    <span className="font-semibold text-emerald-800">Mustahik Vault (87.5%):</span>{" "}
                    Rp {((Number(amountIDR) * 875) / 1000).toLocaleString("id-ID")}
                  </div>
                  <div>
                    <span className="font-semibold text-amber-800">Amil (Maks 12.5%):</span>{" "}
                    Rp {((Number(amountIDR) * 125) / 1000).toLocaleString("id-ID")}
                  </div>
                </div>

                <Button type="submit" disabled={loading} className="w-full py-3.5">
                  {loading ? "Memproses Donasi..." : "Lanjutkan Pembayaran QRIS"}
                </Button>
              </form>
            </Card>
          </div>

          <div className="md:col-span-5">
            {!fiatInvoice ? (
              <Card className="text-center p-8 flex flex-col items-center justify-center bg-stone-50 border-dashed">
                <div className="w-16 h-16 rounded-full bg-[#C5A869]/10 text-[#C5A869] flex items-center justify-center mb-4">
                  <QrCode className="w-8 h-8" />
                </div>
                <h4 className="font-serif text-xl font-semibold text-[#0F3D30] mb-2">
                  Siap Bayar via QRIS
                </h4>
                <p className="text-xs text-[#555555] leading-relaxed">
                  Isi formulir di sebelah kiri untuk menghasilkan QRIS dinamis dan Kuitansi Kriptografis rahasia Anda.
                </p>
              </Card>
            ) : fiatInvoice.status === "PENDING" ? (
              <Card elevated className="border-2 border-[#C5A869] bg-[#FAFAF8]">
                <div className="flex items-center justify-between border-b border-[#0F3D30]/10 pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
                    <span className="font-serif font-bold text-sm text-[#0F3D30]">
                      BAYAR VIA QRIS DINAMIS
                    </span>
                  </div>
                  <Badge variant="warning">PENDING ({formatTimer(timeLeft)})</Badge>
                </div>

                <div className="bg-white p-4 rounded-xl border border-stone-200 text-center mb-4 shadow-inner">
                  <div className="w-48 h-48 mx-auto bg-white rounded-lg flex items-center justify-center p-2 border border-stone-100 shadow-xs">
                    <img
                      src={fiatInvoice.qrUrl}
                      alt="QRIS Code"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <p className="text-[10px] text-stone-500 mt-2 font-mono">
                    NMID: ID102026TAWFZAKAT01 • {fiatInvoice.trxId}
                  </p>
                  <p className="text-base font-bold text-[#0F3D30] mt-1">
                    Rp {Number(fiatInvoice.amountIDR).toLocaleString("id-ID")}
                  </p>

                  <div className="flex gap-2 justify-center mt-3 pt-2 border-t border-stone-100">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(fiatInvoice.qrUrl)}
                      className="text-[11px] font-semibold text-[#0F3D30] hover:text-[#1A5242] bg-[#0F3D30]/5 hover:bg-[#0F3D30]/10 px-2.5 py-1 rounded-md border border-[#0F3D30]/15 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" /> Salin QR URL
                    </button>
                    {fiatInvoice.qrString && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(fiatInvoice.qrString)}
                        className="text-[11px] font-semibold text-[#0F3D30] hover:text-[#1A5242] bg-[#0F3D30]/5 hover:bg-[#0F3D30]/10 px-2.5 py-1 rounded-md border border-[#0F3D30]/15 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" /> Salin QR String
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  {fiatInvoice.snapToken && (
                    <Button
                      type="button"
                      onClick={() => triggerSnapModal()}
                      className="w-full py-2.5 bg-[#0F3D30] hover:bg-[#1A5242] text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-xs"
                    >
                      💳 Buka Pop-up Pembayaran Midtrans Snap
                    </Button>
                  )}

                  {fiatInvoice.redirectUrl && (
                    <a
                      href={fiatInvoice.redirectUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all text-center border border-emerald-300"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Buka Halaman Pembayaran Midtrans (Tab Baru) ↗
                    </a>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <a
                      href="https://simulator.sandbox.midtrans.com/bca/va/index"
                      target="_blank"
                      rel="noreferrer"
                      className="py-1.5 px-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all text-center border border-stone-200"
                    >
                      <ExternalLink className="w-3 h-3" /> VA Simulator ↗
                    </a>
                    <a
                      href="https://simulator.sandbox.midtrans.com/qris/index"
                      target="_blank"
                      rel="noreferrer"
                      className="py-1.5 px-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all text-center border border-stone-200"
                    >
                      <ExternalLink className="w-3 h-3" /> QRIS Simulator ↗
                    </a>
                  </div>
                </div>

                <div className="bg-amber-50 rounded-xl p-3 border border-amber-200/60 text-xs text-amber-900 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-amber-600 animate-spin shrink-0" />
                  <span className="text-[11px] leading-tight">
                    Sistem sedang memantau pembayaran dari server Midtrans... Halaman otomatis beralih begitu terkonfirmasi.
                  </span>
                </div>
              </Card>
            ) : (
              <Card elevated className="border-2 border-[#0F3D30] bg-[#FAFAF8]">
                <div className="flex items-center justify-between border-b border-[#0F3D30]/10 pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span className="font-serif font-bold text-sm text-[#0F3D30]">
                      KUITANSI DIGITAL MUZAKKI
                    </span>
                  </div>
                  <Badge variant="success">
                    {fiatInvoice.status === "BATCHED"
                      ? `Tercatat di Batch #${fiatInvoice.batchId || 1}`
                      : "PAID (Antrian Batch L1)"}
                  </Badge>
                </div>

                <div className="bg-white p-4 rounded-xl border border-stone-200 text-center mb-4 shadow-inner">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-2">
                    <Check className="w-6 h-6 stroke-[3]" />
                  </div>
                  <h4 className="font-serif text-lg font-bold text-[#0F3D30]">
                    Pembayaran Berhasil!
                  </h4>
                  <p className="text-xs text-stone-500 font-mono">
                    {fiatInvoice.trxId}
                  </p>
                  <p className="text-base font-bold text-[#0F3D30] mt-1">
                    Rp {Number(fiatInvoice.amountIDR).toLocaleString("id-ID")}
                  </p>
                </div>

                <div className="bg-[#0F3D30]/5 border border-[#0F3D30]/15 rounded-xl p-3.5 mb-4">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#0F3D30] mb-1">
                    <Lock className="w-3.5 h-3.5 text-[#C5A869]" /> Secret Salt (Kunci Verifikasi Mandiri)
                  </div>
                  <p className="text-[11px] text-[#555555] mb-2 leading-tight">
                    Simpan Secret Salt ini! Kunci ini tidak diketahui publik dan digunakan untuk memvalidasi Merkle proof donasi Anda di menu Verifikasi.
                  </p>
                  <div className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border text-xs font-mono">
                    <span className="truncate mr-2 text-stone-800">{fiatInvoice.salt}</span>
                    <button
                      onClick={() => copyToClipboard(fiatInvoice.salt)}
                      className="text-[#0F3D30] hover:text-[#1A5242] shrink-0 cursor-pointer"
                    >
                      {copiedSalt ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="text-xs space-y-1.5 border-t border-[#0F3D30]/10 pt-3">
                  <div className="flex justify-between">
                    <span className="text-[#555555]">Transaction ID:</span>
                    <span className="font-mono font-bold text-[#0F3D30]">{fiatInvoice.trxId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#555555]">Nama Muzakki:</span>
                    <span className="font-medium text-[#1A1A1A]">{fiatInvoice.donorName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#555555]">Waktu:</span>
                    <span className="text-[#555555]">{new Date(fiatInvoice.paidAt || fiatInvoice.timestamp).toLocaleTimeString("id-ID")} WIB</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#0F3D30]/10 space-y-2">
                  <a
                    href="#verify"
                    className="block text-center text-xs font-bold uppercase tracking-wider text-[#0F3D30] hover:underline"
                  >
                    Uji Bukti Merkle Sekarang ➔
                  </a>
                  <button
                    type="button"
                    onClick={handleResetDonation}
                    className="w-full text-center text-xs text-stone-500 hover:text-stone-700 underline cursor-pointer"
                  >
                    Buat Donasi Baru
                  </button>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Web3 USDC Inflow */}
      {activeTab === "usdc" && (
        <div className="max-w-2xl mx-auto">
          <Card elevated>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-serif text-2xl text-[#0F3D30] font-semibold">
                  Direct Web3 USDC Deposit
                </h3>
                <p className="text-xs text-[#555555]">
                  Penyetoran aset riil langsung ke Smart Contract Custodial Vault di Ethereum Sepolia.
                </p>
              </div>
              <Badge variant="info">Sepolia USDC Vault</Badge>
            </div>

            {!isConnected || !address ? (
              <div className="text-center py-8 bg-[#F9F6F0] rounded-2xl border border-dashed border-[#0F3D30]/20 p-6">
                <Wallet className="w-12 h-12 text-[#0F3D30] mx-auto mb-3" />
                <h4 className="font-serif text-lg font-semibold text-[#0F3D30] mb-2">
                  Hubungkan Dompet Web3 Anda
                </h4>
                <p className="text-xs text-[#555555] max-w-sm mx-auto mb-6">
                  Gunakan tombol "Connect Wallet" di bagian kanan atas halaman untuk menghubungkan MetaMask Anda di jaringan Sepolia.
                </p>
              </div>
            ) : (
              <form onSubmit={handleUsdcDeposit} className="space-y-5">
                <div className="bg-[#0F3D30]/5 rounded-xl p-3.5 flex justify-between items-center text-xs border border-[#0F3D30]/10">
                  <div>
                    <span className="text-[#555555] block">Dompet Terhubung:</span>
                    <span className="font-mono font-bold text-[#0F3D30]">{formattedAddress || address}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[#555555] block">Saldo Sepolia USDC:</span>
                    <span className="font-mono font-bold text-[#0F3D30]">
                      {usdcBalance !== null ? `${usdcBalance} USDC` : "Memuat..."}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wider">
                      Nominal Setoran (USDC)
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-[#0F3D30] font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={usdcAnonymous}
                        onChange={(e) => setUsdcAnonymous(e.target.checked)}
                        className="rounded accent-[#0F3D30]"
                      />
                      Mode Hamba Allah (Private)
                    </label>
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-3 text-sm font-semibold text-[#555555]">
                      $
                    </span>
                    <input
                      type="number"
                      value={usdcAmount}
                      onChange={(e) => setUsdcAmount(e.target.value)}
                      placeholder="100"
                      min="1"
                      className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl pl-8 pr-16 py-2.5 text-base font-semibold text-[#1A1A1A] focus:outline-none focus:border-[#0F3D30]"
                    />
                    <span className="absolute right-4 top-3 text-xs font-bold text-[#0F3D30]">
                      USDC
                    </span>
                  </div>
                  {usdcBalance !== null && parseFloat(usdcBalance) < Number(usdcAmount) && (
                    <div className="text-[11px] text-amber-700 mt-1.5 flex items-center justify-between">
                      <span>Saldo USDC testnet Anda tidak mencukupi (${usdcBalance} USDC).</span>
                      <a
                        href="https://faucet.circle.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="underline font-bold inline-flex items-center gap-0.5 text-[#0F3D30]"
                      >
                        Klaim Faucet Circle <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
                  <Shield className="w-4 h-4 text-amber-700 shrink-0" />
                  <div>
                    <strong>Invariant Split:</strong> $
                    {((Number(usdcAmount) * 87.5) / 100).toFixed(2)} terkunci di Mustahik Vault, $
                    {((Number(usdcAmount) * 12.5) / 100).toFixed(2)} ke Amil Treasury.
                  </div>
                </div>

                {/* 2-Step Allowance / Deposit Action */}
                {needsApproval ? (
                  <Button
                    type="button"
                    onClick={handleApprove}
                    disabled={isApproving}
                    className="w-full py-3.5 bg-amber-800 hover:bg-amber-900 text-white"
                  >
                    {isApproving ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Menunggu Persetujuan Allowance di MetaMask...
                      </span>
                    ) : (
                      `Step 1: Setujui Izin Transfer ${usdcAmount} USDC (Approve Allowance)`
                    )}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={isDepositing}
                    className="w-full py-3.5 bg-[#0F3D30] hover:bg-[#1A5242] text-white"
                  >
                    {isDepositing ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Menunggu Konfirmasi Setoran di MetaMask...
                      </span>
                    ) : (
                      `Step 2: Setor ${usdcAmount} USDC ke Vault L1 (Sepolia)`
                    )}
                  </Button>
                )}

                {web3Status && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900 space-y-2">
                    <div className="font-bold flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-emerald-600" /> {web3Status}
                    </div>
                    {txHash && (
                      <div className="font-mono text-[11px] truncate flex items-center justify-between">
                        <span>TxHash: <span className="text-emerald-700">{txHash}</span></span>
                        {explorerUrl && (
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[#0F3D30] font-bold hover:underline"
                          >
                            Etherscan <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {web3Error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-900 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block mb-0.5">Transaksi Gagal di MetaMask:</strong>
                      <span>{web3Error}</span>
                    </div>
                  </div>
                )}
              </form>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
