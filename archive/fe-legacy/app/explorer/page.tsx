"use client";

import React, { useState } from 'react';
import { Search, ExternalLink, Filter, TrendingUp, Users, Coins, Vote, Calendar, RefreshCw } from 'lucide-react';
import { CONTRACT_ADDRESSES, formatAddress, formatTimestamp, formatIDRX } from '@/lib/abi';
import { useExplorerTransactions, TransactionType } from '@/hooks/useExplorerTransactions';
import { useLanguage } from "@/components/providers/language-provider";

const ExplorerPage: React.FC = () => {
  const { t } = useLanguage()
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<TransactionType>('all');

  // Use real blockchain data
  const { transactions, allTransactions, isLoading, error, stats, refetch } = useExplorerTransactions({
    search: searchQuery,
    type: filterType,
    pollInterval: 30000, // 30 seconds
  });

  const getTypeIcon = (type: TransactionType) => {
    switch(type) {
      case 'donation': return <Coins className="h-4 w-4" />;
      case 'campaign': return <TrendingUp className="h-4 w-4" />;
      case 'proposal': return <Vote className="h-4 w-4" />;
      case 'vote': return <Users className="h-4 w-4" />;
      case 'pool': return <TrendingUp className="h-4 w-4" />;
      default: return null;
    }
  };

  const getBadgeLabel = (type: TransactionType): string => {
    switch(type) {
      case 'donation': return t('explorer.badge.donation');
      case 'campaign': return t('explorer.badge.campaign');
      case 'proposal': return t('explorer.badge.proposal');
      case 'vote': return t('explorer.badge.vote');
      case 'pool': return t('explorer.badge.poolCreated');
      default: return t('explorer.badge.all');
    }
  };

  const getTypeBadge = (type: TransactionType) => {
    const styles: Record<TransactionType, string> = {
      donation: 'bg-green-100 text-green-700 border-green-200',
      campaign: 'bg-blue-100 text-blue-700 border-blue-200',
      proposal: 'bg-purple-100 text-purple-700 border-purple-200',
      vote: 'bg-orange-100 text-orange-700 border-orange-200',
      pool: 'bg-teal-100 text-teal-700 border-teal-200',
      all: ''
    };

    return (
      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${styles[type]}`}>
        {getTypeIcon(type)}
        {getBadgeLabel(type)}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-white">
      <main className="flex-1 py-8">
        <div className="container px-4 mx-auto">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">{t('explorer.title')}</h1>
              <p className="text-muted-foreground">
                {t('explorer.subtitle')}
              </p>
            </div>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors"
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              {t('explorer.refresh')}
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                  <Coins className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{t('explorer.stats.totalDonated')}</div>
                  <div className="text-xl font-bold">{formatIDRX(stats.totalDonated)} IDRX</div>
                </div>
              </div>
            </div>

            <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{t('explorer.stats.activeCampaigns')}</div>
                  <div className="text-xl font-bold">{stats.activeCampaigns}</div>
                </div>
              </div>
            </div>

            <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <Vote className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{t('explorer.stats.totalProposals')}</div>
                  <div className="text-xl font-bold">{stats.totalProposals}</div>
                </div>
              </div>
            </div>

            <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{t('explorer.stats.transactions')}</div>
                  <div className="text-xl font-bold">{stats.totalTransactions}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Search and Filter */}
          <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm p-6 mb-6">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t('explorer.search.placeholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-10 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Filter */}
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as TransactionType)}
                  className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="all">{t('explorer.filter.all')}</option>
                  <option value="donation">{t('explorer.filter.donations')}</option>
                  <option value="pool">{t('explorer.filter.campaigns')}</option>
                  <option value="proposal">{t('explorer.filter.proposals')}</option>
                  <option value="vote">{t('explorer.filter.votes')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Transactions List */}
          <div className="bg-white text-card-foreground rounded-xl border border-black shadow-sm">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-lg">{t('explorer.transactions.title')}</h2>
                {isLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    {t('explorer.transactions.loading')}
                  </div>
                )}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-red-700">{t('explorer.transactions.error')}{error.message}</p>
                </div>
              )}

              {!isLoading && transactions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{t('explorer.transactions.empty')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="border border-border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          {/* Transaction Type and Hash */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {getTypeBadge(tx.type)}
                            <a
                              href={`https://sepolia.etherscan.io/tx/${tx.hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm font-mono text-primary hover:underline"
                            >
                              {formatAddress(tx.hash)}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium bg-green-100 text-green-700 border-green-200">
                              {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                            </span>
                          </div>

                          {/* Description */}
                          <p className="text-sm font-medium">{tx.description}</p>

                          {/* From/To Addresses */}
                          <div className="flex flex-col sm:flex-row gap-2 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <span>{t('explorer.transactions.from')}:</span>
                              <a
                                href={`https://sepolia.etherscan.io/address/${tx.from}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-primary hover:underline inline-flex items-center gap-1"
                              >
                                {formatAddress(tx.from)}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                            {tx.to && (
                              <>
                                <span className="hidden sm:inline">→</span>
                                <div className="flex items-center gap-1">
                                  <span>{t('explorer.transactions.to')}:</span>
                                  <a
                                    href={`https://sepolia.etherscan.io/address/${tx.to}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-primary hover:underline inline-flex items-center gap-1"
                                  >
                                    {formatAddress(tx.to)}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Amount and Time */}
                        <div className="flex flex-row md:flex-col items-start md:items-end justify-between md:justify-start gap-2">
                          {tx.amount && (
                            <div className="text-right">
                              <div className="text-sm font-semibold text-green-600">
                                {tx.amount} IDRX
                              </div>
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground text-right">
                            <div>{formatTimestamp(tx.timestamp)}</div>
                            <div className="font-mono">{t('explorer.block')} #{tx.blockNumber.toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Contract Information */}
          <div className="mt-6 bg-gray-50 text-card-foreground rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold mb-3">{t('explorer.contracts.title')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground mb-1">{t('explorer.contracts.zkcore')}</div>
                <a
                  href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.ZKTCore}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  {CONTRACT_ADDRESSES.ZKTCore}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">{t('explorer.contracts.mockidrx')}</div>
                <a
                  href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.MockIDRX}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  {CONTRACT_ADDRESSES.MockIDRX}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">{t('explorer.contracts.receiptNft')}</div>
                <a
                  href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.DonationReceiptNFT}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  {CONTRACT_ADDRESSES.DonationReceiptNFT}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ExplorerPage;
