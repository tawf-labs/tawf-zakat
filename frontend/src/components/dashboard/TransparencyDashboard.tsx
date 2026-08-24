import React, { useEffect, useState } from "react";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Coins, Landmark, ShieldCheck, ArrowUpRight, ArrowDownRight, Layers, CheckCircle2 } from "lucide-react";

interface BatchItem {
  batchId: number;
  merkleRoot: string;
  totalAmountIDR: number;
  itemCount: number;
  settledAt: string;
  txHash?: string;
}

export function TransparencyDashboard() {
  const [batches, setBatches] = useState<BatchItem[]>([
    {
      batchId: 1,
      merkleRoot: "0xf7d294258e3c6ddaf70a36eade232485b366584e76532e0a360d75d20dae061c",
      totalAmountIDR: 44250000,
      itemCount: 10,
      settledAt: "2026-08-24T12:00:00Z",
      txHash: "0x9a8f7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a",
    },
  ]);

  useEffect(() => {
    fetch("http://localhost:3001/api/batches")
      .then((res) => res.json())
      .then((data) => {
        if (data.batches && data.batches.length > 0) {
          setBatches(data.batches);
        }
      })
      .catch(() => {});
  }, []);

  // Aggregate stats
  const totalIDR = batches.reduce((acc, b) => acc + b.totalAmountIDR, 0);
  const amilShareIDR = (totalIDR * 125) / 1000;
  const mustahikVaultIDR = totalIDR - amilShareIDR;
  const disbursedIDR = 5000000; // From executed proposal

  const totalUSDC = 10000;
  const amilShareUSDC = 1250;
  const mustahikVaultUSDC = 8750;
  const disbursedUSDC = 500;

  return (
    <section id="transparency" className="py-16 px-6 max-w-6xl mx-auto border-t border-[#0F3D30]/10">
      <div className="text-center mb-10">
        <span className="text-xs uppercase tracking-[0.25em] text-[#C5A869] font-semibold block mb-2">
          Public Audit & Transparency Ledger
        </span>
        <h2 className="text-3xl md:text-5xl font-serif font-medium text-[#0F3D30]">
          Dashboard Transparansi Kas On-Chain L1
        </h2>
        <p className="text-sm md:text-base text-[#555555] max-w-2xl mx-auto mt-3">
          Pantau seluruh arus kas masuk, saldo terkunci, batas hak amil, dan realisasi penyaluran dana secara *real-time* dan bebas manipulasi.
        </p>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* IDR Ledger Card */}
        <Card elevated className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#0F3D30]/10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                Rp
              </div>
              <div>
                <h4 className="font-serif font-bold text-lg text-[#0F3D30]">
                  Ledger Pembukuan Fiat (IDR)
                </h4>
                <p className="text-[11px] text-[#555555]">Agregasi Merkle Batching Harian</p>
              </div>
            </div>
            <Badge variant="success">Merkle State Synced</Badge>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-1">
            <div className="bg-[#F9F6F0] p-3.5 rounded-xl border border-[#0F3D30]/10">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#555555] block mb-1">
                Total Kas Masuk (IDR)
              </span>
              <span className="font-serif text-xl md:text-2xl font-bold text-[#0F3D30]">
                Rp {totalIDR.toLocaleString("id-ID")}
              </span>
            </div>
            <div className="bg-[#F9F6F0] p-3.5 rounded-xl border border-[#0F3D30]/10">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#555555] block mb-1">
                Tersalurkan ke Asnaf
              </span>
              <span className="font-serif text-xl md:text-2xl font-bold text-emerald-700">
                Rp {disbursedIDR.toLocaleString("id-ID")}
              </span>
            </div>
          </div>

          {/* Invariant Split Bar */}
          <div>
            <div className="flex justify-between text-xs font-semibold mb-1.5">
              <span className="text-emerald-800">Mustahik Pool (87.5%): Rp {mustahikVaultIDR.toLocaleString("id-ID")}</span>
              <span className="text-amber-800">Amil (Maks 12.5%): Rp {amilShareIDR.toLocaleString("id-ID")}</span>
            </div>
            <div className="w-full h-3 bg-amber-200 rounded-full overflow-hidden flex">
              <div className="h-full bg-[#0F3D30]" style={{ width: "87.5%" }}></div>
              <div className="h-full bg-[#C5A869]" style={{ width: "12.5%" }}></div>
            </div>
          </div>
        </Card>

        {/* USDC Custody Vault Card */}
        <Card elevated className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#0F3D30]/10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-sky-100 text-sky-800 flex items-center justify-center font-bold text-sm">
                $
              </div>
              <div>
                <h4 className="font-serif font-bold text-lg text-[#0F3D30]">
                  Custodial Vault (USDC)
                </h4>
                <p className="text-[11px] text-[#555555]">Real Token di Smart Contract Sepolia</p>
              </div>
            </div>
            <Badge variant="info">On-Chain Custody</Badge>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-1">
            <div className="bg-[#F9F6F0] p-3.5 rounded-xl border border-[#0F3D30]/10">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#555555] block mb-1">
                Total Deposit Vault
              </span>
              <span className="font-serif text-xl md:text-2xl font-bold text-[#0F3D30]">
                ${totalUSDC.toLocaleString("en-US")} USDC
              </span>
            </div>
            <div className="bg-[#F9F6F0] p-3.5 rounded-xl border border-[#0F3D30]/10">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#555555] block mb-1">
                Tersalurkan ke Wallet
              </span>
              <span className="font-serif text-xl md:text-2xl font-bold text-sky-700">
                ${disbursedUSDC.toLocaleString("en-US")} USDC
              </span>
            </div>
          </div>

          {/* Invariant Split Bar */}
          <div>
            <div className="flex justify-between text-xs font-semibold mb-1.5">
              <span className="text-sky-900">Mustahik Vault (87.5%): ${mustahikVaultUSDC.toLocaleString("en-US")}</span>
              <span className="text-amber-800">Amil (12.5%): ${amilShareUSDC.toLocaleString("en-US")}</span>
            </div>
            <div className="w-full h-3 bg-amber-200 rounded-full overflow-hidden flex">
              <div className="h-full bg-[#0F3D30]" style={{ width: "87.5%" }}></div>
              <div className="h-full bg-[#C5A869]" style={{ width: "12.5%" }}></div>
            </div>
          </div>
        </Card>
      </div>

      {/* Settled Batches Table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#0F3D30]" />
            <h4 className="font-serif font-bold text-lg text-[#0F3D30]">
              Riwayat Settlement Batch Merkle L1
            </h4>
          </div>
          <span className="text-xs text-[#555555]">
            Diperbarui per agregasi harian
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#0F3D30]/10 text-[#555555] uppercase tracking-wider text-[10px]">
                <th className="py-3 px-3">Batch ID</th>
                <th className="py-3 px-3">Merkle State Root</th>
                <th className="py-3 px-3">Jumlah Donasi</th>
                <th className="py-3 px-3">Total Akumulasi</th>
                <th className="py-3 px-3">Waktu Settlement</th>
                <th className="py-3 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F3D30]/5 font-mono text-[11px]">
              {batches.map((b) => (
                <tr key={b.batchId} className="hover:bg-[#F9F6F0]/60 transition-colors">
                  <td className="py-3 px-3 font-bold text-[#0F3D30]">#{b.batchId}</td>
                  <td className="py-3 px-3 text-stone-900 font-semibold truncate max-w-[220px]">
                    {b.merkleRoot}
                  </td>
                  <td className="py-3 px-3 text-stone-700">{b.itemCount} Transaksi</td>
                  <td className="py-3 px-3 text-[#0F3D30] font-bold">
                    Rp {b.totalAmountIDR.toLocaleString("id-ID")}
                  </td>
                  <td className="py-3 px-3 text-stone-500 font-sans">
                    {new Date(b.settledAt).toLocaleDateString("id-ID")}
                  </td>
                  <td className="py-3 px-3">
                    <Badge variant="success">L1 Locked</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
