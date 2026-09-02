'use client';

import { useState, useEffect, useRef } from 'react';
import { usePublicClient } from 'wagmi';
import { CONTRACT_ADDRESSES, formatTimestamp, formatIDRX } from '@/lib/abi';

export type TransactionType = 'all' | 'donation' | 'campaign' | 'proposal' | 'vote' | 'pool';

export interface ExplorerTransaction {
  id: string;
  hash: string;
  type: TransactionType;
  from: string;
  to?: string;
  amount?: string;
  amountRaw?: bigint;
  timestamp: number;
  blockNumber: bigint;
  description: string;
  status: 'success' | 'pending' | 'failed';
}

interface UseExplorerTransactionsOptions {
  search?: string;
  type?: TransactionType;
  pollInterval?: number;
  fromBlock?: bigint;
}

/**
 * Hook to fetch real blockchain events for the explorer
 * Uses getLogs polling to avoid RPC filter expiration
 */
export function useExplorerTransactions(options: UseExplorerTransactionsOptions = {}) {
  const {
    search = '',
    type = 'all',
    pollInterval = 30000, // 30 seconds default
    fromBlock,
  } = options;

  const [transactions, setTransactions] = useState<ExplorerTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const publicClient = usePublicClient();
  const lastBlockRef = useRef<bigint>(fromBlock || BigInt(0));
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const fetchTransactions = async () => {
      if (!publicClient) return;

      try {
        setIsLoading(true);

        // Get current block if not provided
        const currentBlock = fromBlock || await publicClient.getBlockNumber();

        // Set the starting block for subsequent fetches
        if (lastBlockRef.current === BigInt(0) && !fromBlock) {
          // Set to ~1000 blocks ago for initial fetch
          lastBlockRef.current = currentBlock > BigInt(1000) ? currentBlock - BigInt(1000) : BigInt(0);
        }

        // Fetch logs for all relevant events
        const [donationLogs, poolCreatedLogs, proposalCreatedLogs, voteLogs, fundWithdrawnLogs] = await Promise.all([
          // DonationReceived events
          (publicClient as any).getLogs({
            address: CONTRACT_ADDRESSES.ZKTCore as `0x${string}`,
            event: {
              name: 'DonationReceived',
              type: 'event',
              inputs: [
                { indexed: true, name: 'poolId', type: 'uint256' },
                { indexed: true, name: 'donor', type: 'address' },
                { indexed: false, name: 'amount', type: 'uint256' },
                { indexed: false, name: 'receiptTokenId', type: 'uint256' },
              ],
            },
            fromBlock: lastBlockRef.current,
            toBlock: 'latest',
          }).catch(() => []),

          // CampaignPoolCreated events
          (publicClient as any).getLogs({
            address: CONTRACT_ADDRESSES.ZKTCore as `0x${string}`,
            event: {
              name: 'CampaignPoolCreated',
              type: 'event',
              inputs: [
                { indexed: true, name: 'poolId', type: 'uint256' },
                { indexed: true, name: 'proposalId', type: 'uint256' },
                { indexed: false, name: 'campaignType', type: 'uint8' },
              ],
            },
            fromBlock: lastBlockRef.current,
            toBlock: 'latest',
          }).catch(() => []),

          // ProposalCreated events
          (publicClient as any).getLogs({
            address: CONTRACT_ADDRESSES.ZKTCore as `0x${string}`,
            event: {
              name: 'ProposalCreated',
              type: 'event',
              inputs: [
                { indexed: true, name: 'proposalId', type: 'uint256' },
                { indexed: true, name: 'organizer', type: 'address' },
                { indexed: false, name: 'title', type: 'string' },
              ],
            },
            fromBlock: lastBlockRef.current,
            toBlock: 'latest',
          }).catch(() => []),

          // VoteCast events
          (publicClient as any).getLogs({
            address: CONTRACT_ADDRESSES.ZKTCore as `0x${string}`,
            event: {
              name: 'VoteCast',
              type: 'event',
              inputs: [
                { indexed: true, name: 'proposalId', type: 'uint256' },
                { indexed: true, name: 'voter', type: 'address' },
                { indexed: false, name: 'support', type: 'uint8' },
                { indexed: false, name: 'weight', type: 'uint256' },
              ],
            },
            fromBlock: lastBlockRef.current,
            toBlock: 'latest',
          }).catch(() => []),

          // FundsWithdrawn events
          (publicClient as any).getLogs({
            address: CONTRACT_ADDRESSES.ZKTCore as `0x${string}`,
            event: {
              name: 'FundsWithdrawn',
              type: 'event',
              inputs: [
                { indexed: true, name: 'poolId', type: 'uint256' },
                { indexed: true, name: 'organizer', type: 'address' },
                { indexed: false, name: 'amount', type: 'uint256' },
              ],
            },
            fromBlock: lastBlockRef.current,
            toBlock: 'latest',
          }).catch(() => []),
        ]);

        // Get block info for timestamps
        const blockNumbers = new Set<bigint>();
        [...donationLogs, ...poolCreatedLogs, ...proposalCreatedLogs, ...voteLogs, ...fundWithdrawnLogs].forEach(log => {
          blockNumbers.add(log.blockNumber);
        });

        const blockTimestamps = new Map<bigint, number>();
        await Promise.all(
          Array.from(blockNumbers).map(async (blockNumber) => {
            try {
              const block = await publicClient.getBlock({ blockNumber });
              blockTimestamps.set(blockNumber, Number(block.timestamp));
            } catch {
              blockTimestamps.set(blockNumber, Math.floor(Date.now() / 1000));
            }
          })
        );

        // Format all logs into transactions
        const formattedTransactions: ExplorerTransaction[] = [];

        // Process donation logs
        for (const log of donationLogs) {
          const poolId = log.args?.poolId as bigint;
          const donor = log.args?.donor as string;
          const amount = log.args?.amount as bigint;
          const timestamp = blockTimestamps.get(log.blockNumber) || Math.floor(Date.now() / 1000);

          formattedTransactions.push({
            id: `donation-${log.transactionHash}-${log.logIndex}`,
            hash: log.transactionHash,
            type: 'donation',
            from: donor,
            to: CONTRACT_ADDRESSES.ZKTCore,
            amount: formatIDRX(amount),
            amountRaw: amount,
            timestamp,
            blockNumber: log.blockNumber,
            description: `Donation to Pool #${poolId.toString()}`,
            status: 'success',
          });
        }

        // Process pool created logs
        for (const log of poolCreatedLogs) {
          const poolId = log.args?.poolId as bigint;
          const proposalId = log.args?.proposalId as bigint;
          const campaignType = log.args?.campaignType as number;
          const timestamp = blockTimestamps.get(log.blockNumber) || Math.floor(Date.now() / 1000);

          formattedTransactions.push({
            id: `pool-${log.transactionHash}-${log.logIndex}`,
            hash: log.transactionHash,
            type: 'pool',
            from: CONTRACT_ADDRESSES.ZKTCore,
            to: CONTRACT_ADDRESSES.ZKTCore,
            timestamp,
            blockNumber: log.blockNumber,
            description: `Created ${campaignType === 1 ? 'Zakat' : 'Normal'} Pool #${poolId.toString()} from Proposal #${proposalId.toString()}`,
            status: 'success',
          });
        }

        // Process proposal created logs
        for (const log of proposalCreatedLogs) {
          const proposalId = log.args?.proposalId as bigint;
          const organizer = log.args?.organizer as string;
          const title = log.args?.title as string;
          const timestamp = blockTimestamps.get(log.blockNumber) || Math.floor(Date.now() / 1000);

          formattedTransactions.push({
            id: `proposal-${log.transactionHash}-${log.logIndex}`,
            hash: log.transactionHash,
            type: 'proposal',
            from: organizer,
            to: CONTRACT_ADDRESSES.ZKTCore,
            timestamp,
            blockNumber: log.blockNumber,
            description: `Created proposal: ${title}`,
            status: 'success',
          });
        }

        // Process vote logs
        for (const log of voteLogs) {
          const proposalId = log.args?.proposalId as bigint;
          const voter = log.args?.voter as string;
          const support = log.args?.support as number;
          const weight = log.args?.weight as bigint;
          const timestamp = blockTimestamps.get(log.blockNumber) || Math.floor(Date.now() / 1000);

          const supportLabel = support === 1 ? 'FOR' : support === 0 ? 'AGAINST' : 'ABSTAIN';

          formattedTransactions.push({
            id: `vote-${log.transactionHash}-${log.logIndex}`,
            hash: log.transactionHash,
            type: 'vote',
            from: voter,
            to: CONTRACT_ADDRESSES.ZKTCore,
            timestamp,
            blockNumber: log.blockNumber,
            description: `Voted ${supportLabel} on Proposal #${proposalId.toString()} (${weight.toString()} votes)`,
            status: 'success',
          });
        }

        // Process fund withdrawn logs
        for (const log of fundWithdrawnLogs) {
          const poolId = log.args?.poolId as bigint;
          const organizer = log.args?.organizer as string;
          const amount = log.args?.amount as bigint;
          const timestamp = blockTimestamps.get(log.blockNumber) || Math.floor(Date.now() / 1000);

          formattedTransactions.push({
            id: `withdrawal-${log.transactionHash}-${log.logIndex}`,
            hash: log.transactionHash,
            type: 'campaign',
            from: CONTRACT_ADDRESSES.ZKTCore,
            to: organizer,
            amount: formatIDRX(amount),
            amountRaw: amount,
            timestamp,
            blockNumber: log.blockNumber,
            description: `Withdrew funds from Pool #${poolId.toString()}`,
            status: 'success',
          });
        }

        // Sort by timestamp (newest first) and block number
        formattedTransactions.sort((a, b) => {
          if (b.timestamp !== a.timestamp) {
            return b.timestamp - a.timestamp;
          }
          return Number(b.blockNumber - a.blockNumber);
        });

        // Update last block ref
        const latestBlock = await publicClient.getBlockNumber();
        lastBlockRef.current = latestBlock;

        setTransactions(formattedTransactions);
        setError(null);
      } catch (err) {
        console.error('Error fetching explorer transactions:', err);
        setError(err as Error);
      } finally {
        setIsLoading(false);
      }
    };

    // Initial fetch
    fetchTransactions();

    // Set up polling
    if (pollInterval > 0) {
      intervalRef.current = setInterval(fetchTransactions, pollInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [publicClient, pollInterval]);

  // Filter transactions based on search and type
  const filteredTransactions = transactions.filter(tx => {
    const matchesType = type === 'all' || tx.type === type;
    const matchesSearch = search === '' ||
      tx.hash.toLowerCase().includes(search.toLowerCase()) ||
      tx.from.toLowerCase().includes(search.toLowerCase()) ||
      tx.to?.toLowerCase().includes(search.toLowerCase()) ||
      tx.description.toLowerCase().includes(search.toLowerCase());
    return matchesType && matchesSearch;
  });

  // Calculate stats
  const totalDonations = transactions
    .filter(tx => (tx.type === 'donation' || tx.type === 'campaign') && tx.amountRaw)
    .reduce((sum, tx) => sum + (tx.amountRaw || BigInt(0)), BigInt(0));

  const activeCampaigns = transactions.filter(tx => tx.type === 'pool').length;
  const totalProposals = transactions.filter(tx => tx.type === 'proposal').length;

  return {
    transactions: filteredTransactions,
    allTransactions: transactions,
    isLoading,
    error,
    stats: {
      totalDonated: totalDonations,
      totalTransactions: transactions.length,
      activeCampaigns,
      totalProposals,
    },
    refetch: () => {
      isInitializedRef.current = false;
    },
  };
}
