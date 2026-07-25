'use client';

import { useCallback, useState } from 'react';
import { useReadContract, useWriteContract, useAccount } from 'wagmi';
import { CONTRACT_ADDRESSES, ZKTCoreABI } from '@/lib/abi';
import { toast } from '@/components/ui/use-toast';

export enum FallbackStatus {
    None = 0,
    Proposed = 1,
    Approved = 2
}

export interface FallbackPool {
    pool: string;
    status: FallbackStatus;
    proposedAt: bigint;
    proposer: string;
    reasoning: string;
}

export function useFallbackPools() {
    const { isConnected } = useAccount();
    const [isLoading, setIsLoading] = useState(false);
    const { writeContractAsync } = useWriteContract();

    // Read: All Fallback Pools
    const { data: allPools, refetch: refetchAll } = useReadContract({
        address: CONTRACT_ADDRESSES.ZKTCore,
        abi: ZKTCoreABI,
        functionName: 'getAllFallbackPools',
    });

    const proposeFallbackPool = useCallback(async (poolAddress: string, reasoning: string) => {
        if (!isConnected) {
            toast({ title: 'Error', description: 'Wallet not connected', variant: 'destructive' });
            return;
        }
        setIsLoading(true);
        try {
            const hash = await writeContractAsync({
                address: CONTRACT_ADDRESSES.ZKTCore,
                abi: ZKTCoreABI,
                functionName: 'proposeFallbackPool',
                args: [poolAddress as `0x${string}`, reasoning],
            });
            toast({ title: 'Pool Proposed', description: 'Fallback pool has been proposed for review.' });
            return hash;
        } catch (error: any) {
            console.error("Error proposing pool:", error);
            toast({ title: 'Error', description: error?.message || 'Failed to propose pool', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [isConnected, writeContractAsync]);

    const vetFallbackPool = useCallback(async (poolAddress: string) => {
        if (!isConnected) {
            toast({ title: 'Error', description: 'Wallet not connected', variant: 'destructive' });
            return;
        }
        setIsLoading(true);
        try {
            const hash = await writeContractAsync({
                address: CONTRACT_ADDRESSES.ZKTCore,
                abi: ZKTCoreABI,
                functionName: 'vetFallbackPool',
                args: [poolAddress as `0x${string}`],
            });
            toast({ title: 'Pool Approved', description: 'Fallback pool has been approved.' });
            return hash;
        } catch (error: any) {
            console.error("Error vetting pool:", error);
            toast({ title: 'Error', description: error?.message || 'Failed to approve pool', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [isConnected, writeContractAsync]);
    
    const setDefaultFallbackPool = useCallback(async (poolAddress: string) => {
        if (!isConnected) {
            toast({ title: 'Error', description: 'Wallet not connected', variant: 'destructive' });
            return;
        }
        setIsLoading(true);
        try {
            const hash = await writeContractAsync({
                address: CONTRACT_ADDRESSES.ZKTCore,
                abi: ZKTCoreABI,
                functionName: 'setDefaultFallbackPool',
                args: [poolAddress as `0x${string}`],
            });
            toast({ title: 'Default Set', description: 'System default fallback pool updated.' });
            return hash;
        } catch (error: any) {
            console.error("Error setting default:", error);
            toast({ title: 'Error', description: error?.message || 'Failed to set default pool', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [isConnected, writeContractAsync]);

    return {
        allPools: allPools as string[] || [],
        proposeFallbackPool,
        vetFallbackPool,
        setDefaultFallbackPool,
        isLoading,
        refetch: refetchAll
    };
}

export function useFallbackPoolDetails(poolAddress: string) {
    const { data, isLoading } = useReadContract({
        address: CONTRACT_ADDRESSES.ZKTCore,
        abi: ZKTCoreABI,
        functionName: 'getFallbackPool',
        args: [poolAddress as `0x${string}`],
        query: { enabled: !!poolAddress }
    });
    
    const row = data as any;
    const fallbackPool: FallbackPool | null = data ? {
        pool: row[0],
        status: row[1],
        proposedAt: row[2],
        proposer: row[3],
        reasoning: row[4]
    } : null;

    return { data: fallbackPool, isLoading };
}
