"use client";

import React, { useState } from 'react';
import { Award, FileText, Vote, Wallet, ShieldCheck, Download, ExternalLink, TrendingUp, CheckCircle2, XCircle, Clock, Settings } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/providers/language-provider';
import { useDonationReceipts } from '@/hooks/useDonationReceipts';

interface NFTReceipt {
  id: string;
  receiptNumber: string;
  amount: string;
  category: string;
  date: string;
  campaign: string;
  address: string;
}

type SidebarTab = 'overview' | 'tax-reports' | 'governance-dao' | 'wallet-settings';

/** IDRX is an 18-decimal ERC-20; receipts store raw token units. */
const IDRX_DECIMALS = 18;

function formatIdrx(amount: bigint): string {
  const value = Number(formatUnits(amount, IDRX_DECIMALS));
  return `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr || '—';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const DonorDashboard: React.FC = () => {
  const { t } = useLanguage();
  const { address, isConnected } = useAccount();
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('overview');
  const [activeTab, setActiveTab] = useState<'receipts' | 'history' | 'governance'>('receipts');

  // Real on-chain DonationReceiptNFT reads (balanceOf -> tokenOfOwnerByIndex ->
  // getReceiptData). This page previously rendered a hardcoded array, so it
  // showed four identical "$50.00 USD" receipts regardless of chain state.
  const { receipts: onChainReceipts, isLoading: isLoadingReceipts, error: receiptsError } =
    useDonationReceipts();

  const receipts: NFTReceipt[] = onChainReceipts.map((r) => ({
    id: r.tokenId.toString(),
    receiptNumber: r.tokenId.toString(),
    amount: formatIdrx(r.amount),
    category: 'Zakat',
    date: r.timestamp
      ? new Date(Number(r.timestamp) * 1000).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '—',
    campaign: `Pool #${r.poolId.toString()}`,
    address: shortenAddress(r.donor),
  }));

  return (
    <div className="min-h-screen bg-white">
      <main className="flex-1 py-4 sm:py-8">
        <div className="container px-4 mx-auto">
          <div className="flex flex-col md:flex-row gap-6 md:gap-8">
            {/* Sidebar */}
            <aside className="w-full md:w-64 flex-shrink-0 space-y-6">
              {/* Profile Card */}
              <div className="bg-card text-card-foreground rounded-xl border border-black/60 shadow-sm">
                <div className="p-4 sm:p-6 flex flex-col items-center text-center">
                  <div className="relative flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 overflow-hidden rounded-full mb-4 border-2 border-black/20">
                    <div className="aspect-square h-full w-full bg-white flex items-center justify-center text-xl sm:text-2xl font-bold text-primary border-black">
                      JD
                    </div>
                  </div>
                  <h2 className="font-bold text-lg sm:text-xl">John Doe</h2>
                  <p className="text-sm text-muted-foreground mb-4">@johndoe</p>
                  <div className="flex items-center gap-2 bg-white/50 px-3 py-1.5 rounded-full text-xs font-mono text-muted-foreground mb-4 sm:mb-6">
                    <Wallet className="h-3 w-3" />
                    0x71C...92F
                  </div>
                  <Button variant="outline" className="btn-touch-target w-full">
                    {t("dashboard.editProfile")}
                  </Button>
                </div>
              </div>

              {/* Navigation */}
              <nav className="space-y-1">
                <Button
                  variant="ghost"
                  onClick={() => setSidebarTab('overview')}
                  className={`btn-touch-target w-full justify-start ${sidebarTab === 'overview' ? 'bg-secondary/50 font-semibold' : ''}`}
                >
                  <Award className="mr-2 h-4 w-4" />
                  {t("dashboard.overview")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSidebarTab('tax-reports')}
                  className={`btn-touch-target w-full justify-start ${sidebarTab === 'tax-reports' ? 'bg-secondary/50 font-semibold' : ''}`}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  {t("dashboard.taxReports")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSidebarTab('governance-dao')}
                  className={`btn-touch-target w-full justify-start ${sidebarTab === 'governance-dao' ? 'bg-secondary/50 font-semibold' : ''}`}
                >
                  <Vote className="mr-2 h-4 w-4" />
                  {t("dashboard.governanceDao")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSidebarTab('wallet-settings')}
                  className={`btn-touch-target w-full justify-start ${sidebarTab === 'wallet-settings' ? 'bg-secondary/50 font-semibold' : ''}`}
                >
                  <Settings className="mr-2 h-4 w-4" />
                  {t("dashboard.walletSettings")}
                </Button>
              </nav>
            </aside>

            {/* Main Content */}
            <div className="flex-1 space-y-6 sm:space-y-8">
              {/* Overview Tab */}
              {sidebarTab === 'overview' && (
                <>
              {/* Stats Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                <div className="text-card-foreground rounded-xl border shadow-sm bg-white/5 border-black p-4 sm:p-6">
                  <div className="text-sm font-medium text-muted-foreground mb-2">{t("dashboard.totalDonated")}</div>
                  <div className="text-xl sm:text-2xl font-bold text-primary">$1,250.00</div>
                  <p className="text-xs text-muted-foreground mt-1">+12% from last month</p>
                </div>
                <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-4 sm:p-6">
                  <div className="text-sm font-medium text-muted-foreground mb-2">{t("dashboard.campaignsSupported")}</div>
                  <div className="text-xl sm:text-2xl font-bold">14</div>
                  <p className="text-xs text-muted-foreground mt-1">Across 3 categories</p>
                </div>
                <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-4 sm:p-6">
                  <div className="text-sm font-medium text-muted-foreground mb-2">{t("dashboard.governancePower")}</div>
                  <div className="text-xl sm:text-2xl font-bold text-purple-600">850 vZKT</div>
                  <p className="text-xs text-muted-foreground mt-1">Top 15% of donors</p>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex flex-col gap-2 w-full">
                {/* Tab List */}
                <div className="inline-flex items-center w-full justify-start border-b border-black/60 overflow-x-auto hide-scrollbar-mobile">
                  <button
                    onClick={() => setActiveTab('receipts')}
                    className={`btn-touch-target inline-flex h-full items-center justify-center gap-1.5 border-b-2 text-sm font-medium whitespace-nowrap transition-all px-2 sm:px-0 py-3 ${
                      activeTab === 'receipts'
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t("dashboard.myNftReceipts")}
                  </button>
                  <button
                    onClick={() => setActiveTab('history')}
                    className={`btn-touch-target inline-flex h-full items-center justify-center gap-1.5 border-b-2 text-sm font-medium whitespace-nowrap transition-all px-2 sm:px-0 py-3 ${
                      activeTab === 'history'
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t("dashboard.donationHistory")}
                  </button>
                  <button
                    onClick={() => setActiveTab('governance')}
                    className={`btn-touch-target inline-flex h-full items-center justify-center gap-1.5 border-b-2 text-sm font-medium whitespace-nowrap transition-all px-2 sm:px-0 py-3 ${
                      activeTab === 'governance'
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t("dashboard.daoProposals")}
                  </button>
                </div>

                {/* Tab Content */}
                <div className="pt-4 sm:pt-6">
                  {activeTab === 'receipts' && !isConnected && (
                    <div className="rounded-xl border border-black/20 bg-muted/30 p-8 text-center">
                      <Wallet className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                      <p className="text-sm text-muted-foreground">
                        Connect your wallet to see your donation receipts.
                      </p>
                    </div>
                  )}
                  {activeTab === 'receipts' && isConnected && isLoadingReceipts && (
                    <div className="rounded-xl border border-black/20 bg-muted/30 p-8 text-center">
                      <Clock className="mx-auto h-8 w-8 text-muted-foreground mb-3 animate-pulse" />
                      <p className="text-sm text-muted-foreground">Loading receipts from chain…</p>
                    </div>
                  )}
                  {activeTab === 'receipts' && isConnected && !isLoadingReceipts && receiptsError && (
                    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center">
                      <XCircle className="mx-auto h-8 w-8 text-destructive mb-3" />
                      <p className="text-sm text-destructive">
                        Could not read receipts from the DonationReceiptNFT contract.
                      </p>
                    </div>
                  )}
                  {activeTab === 'receipts' && isConnected && !isLoadingReceipts && !receiptsError && receipts.length === 0 && (
                    <div className="rounded-xl border border-black/20 bg-muted/30 p-8 text-center">
                      <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No donation receipts yet. Your receipt NFT appears here after your first donation.
                      </p>
                    </div>
                  )}
                  {activeTab === 'receipts' && receipts.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                      {receipts.map((receipt) => (
                        <div
                          key={receipt.id}
                          className="bg-white text-card-foreground rounded-xl border shadow-sm overflow-hidden border-black/60 hover:shadow-md transition-shadow group cursor-pointer"
                        >
                          {/* Receipt Visual */}
                          <div className="relative aspect-square bg-secondary p-6 flex flex-col items-center justify-center border-b border-black/60">
                            <div className="absolute inset-0 opacity-10 bg-white [background-size:16px_16px]"></div>
                            <div className="h-16 w-16 rounded-full bg-white/10 flex items-center justify-center text-primary mb-4 shadow-sm group-hover:scale-110 transition-transform">
                              <ShieldCheck className="h-8 w-8" />
                            </div>
                            <div className="text-center relative z-10">
                              <div className="font-mono text-xs text-muted-foreground mb-1">
                                RECEIPT #{receipt.receiptNumber}
                              </div>
                              <div className="font-bold text-lg">{receipt.amount}</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {receipt.category} • {receipt.date}
                              </div>
                            </div>
                            <span className="inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium absolute top-3 right-3 bg-white/80 backdrop-blur text-foreground border-border/50 shadow-sm">
                              {t("campaign.verified")}
                            </span>
                          </div>

                          {/* Receipt Info */}
                          <div className="p-3 sm:p-4">
                            <h3 className="font-semibold truncate text-sm">{receipt.campaign}</h3>
                            <div className="flex justify-between items-center mt-3 sm:mt-4">
                              <span className="text-xs font-mono text-muted-foreground">
                                {receipt.address}
                              </span>
                              <button className="btn-touch-target inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground rounded-md h-11 w-11 sm:h-8 sm:w-8 p-0">
                                <Download className="h-4 w-4" />
                                <span className="sr-only">Download receipt</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {activeTab === 'history' && (
                    <div className="space-y-4 sm:space-y-6">
                      {/* Monthly Summary */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                        <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-3 sm:p-4">
                          <div className="text-sm text-muted-foreground mb-1">{t("dashboard.thisMonth")}</div>
                          <div className="text-xl sm:text-2xl font-bold">Rp 790.000</div>
                          <div className="flex items-center gap-1 text-xs text-green-600 mt-1">
                            <TrendingUp className="h-3 w-3" />
                            +25% vs last month
                          </div>
                        </div>
                        <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-3 sm:p-4">
                          <div className="text-sm text-muted-foreground mb-1">{t("dashboard.totalImpact")}</div>
                          <div className="text-xl sm:text-2xl font-bold">542 people</div>
                          <div className="text-xs text-muted-foreground mt-1">Directly helped</div>
                        </div>
                        <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-3 sm:p-4">
                          <div className="text-sm text-muted-foreground mb-1">{t("dashboard.categories")}</div>
                          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
                            <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-primary/10 text-primary border-primary/20">Zakat</span>
                            <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 border-purple-200">Education</span>
                            <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 border-blue-200">Health</span>
                          </div>
                        </div>
                      </div>

                      {/* Transaction History Table */}
                      <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm">
                        <div className="p-4 sm:p-6">
                          <h3 className="font-semibold text-base sm:text-lg mb-4">{t("dashboard.recentDonations")}</h3>
                          <div className="table-wrapper-mobile rounded-lg border border-border">
                            <table className="w-full min-w-[600px]">
                              <thead>
                                <tr className="border-b border-border bg-muted/30">
                                  <th className="text-left text-xs sm:text-sm font-medium text-muted-foreground py-3 px-3 sm:px-4">{t("dashboard.date")}</th>
                                  <th className="text-left text-xs sm:text-sm font-medium text-muted-foreground py-3 px-3 sm:px-4">{t("dashboard.campaignColumn")}</th>
                                  <th className="text-left text-xs sm:text-sm font-medium text-muted-foreground py-3 px-3 sm:px-4">{t("dashboard.amount")}</th>
                                  <th className="text-left text-xs sm:text-sm font-medium text-muted-foreground py-3 px-3 sm:px-4">{t("dashboard.type")}</th>
                                  <th className="text-left text-xs sm:text-sm font-medium text-muted-foreground py-3 px-3 sm:px-4">{t("dashboard.transaction")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-b border-border hover:bg-accent/50">
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm">Nov 20, 2025</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-medium">Emergency Relief Fund</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-semibold">Rp 158.000</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4">
                                    <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-primary/10 text-primary border-primary/20">Zakat</span>
                                  </td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4">
                                    <a href="#" className="inline-flex items-center gap-1 text-xs sm:text-sm text-primary hover:underline">
                                      0x7f3d...a21c
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </td>
                                </tr>
                                <tr className="border-b border-border hover:bg-accent/50">
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm">Nov 18, 2025</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-medium">Children Education Fund</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-semibold">Rp 316.000</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4">
                                    <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 border-purple-200">Education</span>
                                  </td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4">
                                    <a href="#" className="inline-flex items-center gap-1 text-xs sm:text-sm text-primary hover:underline">
                                      0x9e2a...b34f
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </td>
                                </tr>
                                <tr className="border-b border-border hover:bg-accent/50">
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm">Nov 15, 2025</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-medium">Clean Water Initiative</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-semibold">Rp 158.000</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4">
                                    <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 border-blue-200">Health</span>
                                  </td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4">
                                    <a href="#" className="inline-flex items-center gap-1 text-xs sm:text-sm text-primary hover:underline">
                                      0x4c8e...d92a
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </td>
                                </tr>
                                <tr className="border-b border-border hover:bg-accent/50">
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm">Nov 12, 2025</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-medium">Emergency Relief Fund</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-semibold">Rp 79.000</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4">
                                    <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-primary/10 text-primary border-primary/20">Zakat</span>
                                  </td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4">
                                    <a href="#" className="inline-flex items-center gap-1 text-xs sm:text-sm text-primary hover:underline">
                                      0x1b5f...e87d
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </td>
                                </tr>
                                <tr className="hover:bg-accent/50">
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm">Nov 8, 2025</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-medium">Medical Equipment Fund</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-semibold">Rp 79.000</td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4">
                                    <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 border-blue-200">Health</span>
                                  </td>
                                  <td className="py-3 sm:py-4 px-3 sm:px-4">
                                    <a href="#" className="inline-flex items-center gap-1 text-xs sm:text-sm text-primary hover:underline">
                                      0x6a9c...f13b
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          {/* Mobile scroll indicator */}
                          <div className="md:hidden mt-2 text-xs text-muted-foreground text-center">
                            Swipe to see more →
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {activeTab === 'governance' && (
                    <div className="space-y-6">
                      {/* Voting Power Card */}
                      <div className="bg-gradient-to-br from-purple-50 to-white text-card-foreground rounded-xl border border-purple-200 shadow-sm p-6">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold text-lg mb-2">{t("dashboard.yourVotingPower")}</h3>
                            <div className="text-3xl font-bold text-purple-600 mb-2">850 vZKT</div>
                            <p className="text-sm text-muted-foreground mb-4">{t("dashboard.soulboundTokens")}</p>
                            <div className="flex gap-4 text-sm">
                              <div>
                                <div className="text-muted-foreground">{t("dashboard.proposalsVoted")}</div>
                                <div className="font-semibold">12</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">{t("dashboard.participationRate")}</div>
                                <div className="font-semibold">85%</div>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="inline-flex items-center rounded-md border px-3 py-1 text-sm font-medium bg-purple-100 text-purple-700 border-purple-200">Top 15%</span>
                          </div>
                        </div>
                      </div>

                      {/* Active Proposals */}
                      <div>
                        <h3 className="font-semibold text-lg mb-4">{t("dashboard.activeProposals")}</h3>
                        <div className="space-y-4">
                          {/* Proposal 1 */}
                          <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-6">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-green-100 text-green-700 border-green-200">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Active
                                  </span>
                                  <span className="text-xs text-muted-foreground">Proposal #17</span>
                                </div>
                                <h4 className="font-semibold text-base mb-2">Increase Education Fund Allocation to 35%</h4>
                                <p className="text-sm text-muted-foreground mb-4">
                                  Proposal to increase the percentage of total donations allocated to education-related campaigns from 25% to 35%, focusing on underprivileged children's access to quality education.
                                </p>
                              </div>
                            </div>
                            <div className="space-y-3">
                              <div>
                                <div className="flex justify-between text-sm mb-1">
                                  <span className="text-muted-foreground">For: 2,450 vZKT (68%)</span>
                                  <span className="text-muted-foreground">Against: 1,150 vZKT (32%)</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                  <div className="bg-green-500 h-2" style={{ width: '68%' }}></div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-2 border-t border-border">
                                <span className="text-xs text-muted-foreground">{t("dashboard.endsIn")} 3 days</span>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="btn-touch-target bg-green-500 hover:bg-green-600 text-white border-green-600 min-h-[44px]"
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                    {t("dashboard.voteFor")}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="btn-touch-target bg-white border-black hover:bg-gray-50 min-h-[44px]"
                                  >
                                    <XCircle className="h-4 w-4" />
                                    {t("dashboard.voteAgainst")}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Proposal 2 */}
                          <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-6">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-green-100 text-green-700 border-green-200">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Active
                                  </span>
                                  <span className="text-xs text-muted-foreground">Proposal #16</span>
                                </div>
                                <h4 className="font-semibold text-base mb-2">Implement Quarterly Impact Reports</h4>
                                <p className="text-sm text-muted-foreground mb-4">
                                  Require all organizations to submit detailed quarterly impact reports with measurable outcomes and beneficiary testimonials to increase transparency.
                                </p>
                              </div>
                            </div>
                            <div className="space-y-3">
                              <div>
                                <div className="flex justify-between text-sm mb-1">
                                  <span className="text-muted-foreground">For: 3,120 vZKT (82%)</span>
                                  <span className="text-muted-foreground">Against: 685 vZKT (18%)</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                  <div className="bg-green-500 h-2" style={{ width: '82%' }}></div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-2 border-t border-border">
                                <span className="text-xs text-muted-foreground">{t("dashboard.endsIn")} 5 days</span>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="btn-touch-target bg-green-500 hover:bg-green-600 text-white border-green-600 min-h-[44px]"
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                    {t("dashboard.voteFor")}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="btn-touch-target bg-white border-black hover:bg-gray-50 min-h-[44px]"
                                  >
                                    <XCircle className="h-4 w-4" />
                                    {t("dashboard.voteAgainst")}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Proposal 3 */}
                          <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-6 opacity-60">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 border-blue-200">
                                    Passed
                                  </span>
                                  <span className="text-xs text-muted-foreground">Proposal #15</span>
                                </div>
                                <h4 className="font-semibold text-base mb-2">Add Emergency Response Category</h4>
                                <p className="text-sm text-muted-foreground mb-4">
                                  Create a new campaign category for emergency disaster response with expedited approval process for verified relief organizations.
                                </p>
                              </div>
                            </div>
                            <div className="space-y-3">
                              <div>
                                <div className="flex justify-between text-sm mb-1">
                                  <span className="text-muted-foreground">For: 4,200 vZKT (91%)</span>
                                  <span className="text-muted-foreground">Against: 415 vZKT (9%)</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                  <div className="bg-blue-500 h-2" style={{ width: '91%' }}></div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-2 border-t border-border">
                                <span className="text-xs text-muted-foreground">Ended Nov 10, 2025</span>
                                <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 border-blue-200">
                                  Implemented
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* How to Earn More Voting Power */}
                      <div className="bg-purple-50 text-card-foreground rounded-xl border border-purple-200 p-6">
                        <h4 className="font-semibold mb-3">{t("dashboard.howToEarnMore")}</h4>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          <li className="flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                            <span>Make donations to any campaign (1 vZKT per 10,000 IDRX donated)</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                            <span>Participate in governance votes (5 vZKT bonus per vote)</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                            <span>Maintain consistent monthly donations (10% bonus vZKT)</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              </>
              )}

              {/* Tax Reports Tab */}
              {sidebarTab === 'tax-reports' && (
                <>
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">{t("dashboard.taxReports")}</h1>
                    <p className="text-muted-foreground">{t("dashboard.downloadTaxReports")}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white rounded-xl border border-black shadow-sm p-6">
                      <div className="text-sm text-muted-foreground mb-1">{t("dashboard.totalDeductible")} (2025)</div>
                      <div className="text-2xl font-bold">Rp 19.750.000</div>
                      <p className="text-xs text-muted-foreground mt-1">Across 45 donations</p>
                    </div>
                    <div className="bg-white rounded-xl border border-black shadow-sm p-6">
                      <div className="text-sm text-muted-foreground mb-1">{t("dashboard.taxBenefitEstimate")}</div>
                      <div className="text-2xl font-bold text-green-600">Rp 4.937.500</div>
                      <p className="text-xs text-muted-foreground mt-1">At 25% {t("dashboard.taxRate")}</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-black shadow-sm">
                    <div className="p-6 border-b border-border">
                      <h3 className="font-semibold text-lg">{t("dashboard.annualReports")}</h3>
                      <p className="text-sm text-muted-foreground mt-1">Download comprehensive tax reports by year</p>
                    </div>
                    <div className="p-6 space-y-4">
                      {['2025', '2024', '2023'].map((year) => (
                        <div key={year} className="flex items-center justify-between border border-border rounded-lg p-4 hover:bg-accent/50 transition-colors">
                          <div>
                            <div className="font-semibold">{year} {t("dashboard.taxYear")}</div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {year === '2025' ? t("dashboard.inProgressYtd") : t("dashboard.complete")}
                            </div>
                          </div>
                          <Button variant="outline" className="border-black hover:bg-gray-50">
                            <Download className="h-4 w-4 mr-2" />
                            {t("dashboard.downloadPdf")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
                    <h4 className="font-semibold mb-3">{t("dashboard.taxDeductionInfo")}</h4>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <span>{t("dashboard.taxInfo1")}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <span>{t("dashboard.taxInfo2")}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <span>{t("dashboard.taxInfo3")}</span>
                      </li>
                    </ul>
                  </div>
                </>
              )}

              {/* Governance DAO Tab */}
              {sidebarTab === 'governance-dao' && (
                <>
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">{t("dashboard.governanceDao")}</h1>
                    <p className="text-muted-foreground">{t("dashboard.participateInPlatform")}</p>
                  </div>

                  <div className="bg-gradient-to-br from-purple-50 to-white rounded-xl border border-purple-200 shadow-sm p-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-lg mb-2">{t("dashboard.yourVotingPower")}</h3>
                        <div className="text-3xl font-bold text-purple-600 mb-2">850 vZKT</div>
                        <p className="text-sm text-muted-foreground mb-4">{t("dashboard.soulboundTokens")}</p>
                      </div>
                      <span className="inline-flex items-center rounded-md border px-3 py-1 text-sm font-medium bg-purple-100 text-purple-700 border-purple-200">Top 15%</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-xl border border-black shadow-sm p-6">
                      <div className="text-sm text-muted-foreground mb-1">{t("dashboard.proposalsVoted")}</div>
                      <div className="text-2xl font-bold">12</div>
                    </div>
                    <div className="bg-white rounded-xl border border-black shadow-sm p-6">
                      <div className="text-sm text-muted-foreground mb-1">{t("dashboard.participationRate")}</div>
                      <div className="text-2xl font-bold">85%</div>
                    </div>
                    <div className="bg-white rounded-xl border border-black shadow-sm p-6">
                      <div className="text-sm text-muted-foreground mb-1">{t("dashboard.activeProposals")}</div>
                      <div className="text-2xl font-bold">3</div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-black shadow-sm">
                    <div className="p-6 border-b border-border">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-lg">{t("dashboard.activeProposals")}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{t("dashboard.voteOnDecisions")}</p>
                        </div>
                        <a href="/governance" className="text-sm text-primary hover:underline">{t("dashboard.viewAll")}</a>
                      </div>
                    </div>
                    <div className="p-6 space-y-4">
                      <div className="border border-border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-700 border-green-200">
                            Active
                          </span>
                          <span className="text-xs text-muted-foreground">{t("dashboard.endsIn")} 3 days</span>
                        </div>
                        <h4 className="font-semibold mb-2">Increase Education Fund Allocation to 35%</h4>
                        <div className="flex justify-between text-sm text-muted-foreground mb-2">
                          <span>For: 2,450 vZKT (68%)</span>
                          <span>Against: 1,150 vZKT (32%)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div className="bg-green-500 h-2 rounded-full" style={{ width: '68%' }}></div>
                        </div>
                      </div>
                      <div className="border border-border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-700 border-green-200">
                            Active
                          </span>
                          <span className="text-xs text-muted-foreground">{t("dashboard.endsIn")} 5 days</span>
                        </div>
                        <h4 className="font-semibold mb-2">Implement Quarterly Impact Reports</h4>
                        <div className="flex justify-between text-sm text-muted-foreground mb-2">
                          <span>For: 3,120 vZKT (82%)</span>
                          <span>Against: 685 vZKT (18%)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div className="bg-green-500 h-2 rounded-full" style={{ width: '82%' }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Wallet Settings Tab */}
              {sidebarTab === 'wallet-settings' && (
                <>
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">{t("dashboard.walletSettings")}</h1>
                    <p className="text-muted-foreground">{t("dashboard.manageWallet")}</p>
                  </div>

                  <div className="bg-white rounded-xl border border-black shadow-sm">
                    <div className="p-6 border-b border-border">
                      <h3 className="font-semibold text-lg">{t("dashboard.connectedWallet")}</h3>
                      <p className="text-sm text-muted-foreground mt-1">Your currently connected wallet address</p>
                    </div>
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-4 p-4 bg-accent/30 rounded-lg">
                        <div>
                          <div className="text-sm text-muted-foreground mb-1">{t("dashboard.walletAddress")}</div>
                          <div className="font-mono font-semibold text-primary break-all">
                            {address ?? 'Not connected'}
                          </div>
                        </div>
                        <Button variant="outline" className="border-black hover:bg-gray-50">
                          {t("dashboard.disconnect")}
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 border border-border rounded-lg">
                          <div className="text-sm text-muted-foreground mb-1">{t("dashboard.network")}</div>
                          <div className="font-semibold">Ethereum Sepolia</div>
                        </div>
                        <div className="p-4 border border-border rounded-lg">
                          <div className="text-sm text-muted-foreground mb-1">{t("dashboard.balance")}</div>
                          <div className="font-semibold">15,800,000 IDRX</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-black shadow-sm">
                    <div className="p-6 border-b border-border">
                      <h3 className="font-semibold text-lg">{t("dashboard.notificationPreferences")}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{t("dashboard.chooseNotified")}</p>
                    </div>
                    <div className="p-6 space-y-4">
                      {[
                        { label: t("dashboard.donationConfirmations"), desc: t("dashboard.donationConfirmationsDesc") },
                        { label: t("dashboard.newProposals"), desc: t("dashboard.newProposalsDesc") },
                        { label: t("dashboard.campaignUpdates"), desc: t("dashboard.campaignUpdatesDesc") },
                        { label: t("dashboard.taxReportNotifications"), desc: t("dashboard.taxReportNotificationsDesc") }
                      ].map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-4 border border-border rounded-lg">
                          <div>
                            <div className="font-semibold">{item.label}</div>
                            <div className="text-sm text-muted-foreground mt-1">{item.desc}</div>
                          </div>
                          <Button size="sm">
                            {t("dashboard.enabled")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DonorDashboard;