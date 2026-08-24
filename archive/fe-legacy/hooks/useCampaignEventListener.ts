'use client'

import { useEffect, useRef } from 'react'
import { usePublicClient } from 'wagmi'
import { CONTRACT_ADDRESSES } from '@/lib/abi'

/**
 * Hook that listens for CampaignCreated events from the contract
 * Uses getLogs polling instead of watchContractEvent to avoid RPC filter expiration
 *
 * NOTE: This hook logs on-chain events for monitoring
 * All campaign data is stored on-chain or via IPFS (no database needed)
 */
export const useCampaignEventListener = () => {
  const publicClient = usePublicClient()
  const lastBlockRef = useRef<bigint>(BigInt(0))
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const isInitializedRef = useRef(false)

  useEffect(() => {
    // Guard against multiple initializations
    if (isInitializedRef.current) return
    if (!publicClient) return

    isInitializedRef.current = true

    const setupListener = async () => {
      try {
        console.log('Setting up campaign event listener...')

        // Get the initial block number
        const currentBlock = await publicClient.getBlockNumber()
        lastBlockRef.current = currentBlock

        // Poll for events every 15 seconds instead of using filters (which expire on Ethereum Sepolia)
        intervalRef.current = setInterval(async () => {
          try {
            const latestBlock = await publicClient.getBlockNumber()

            if (latestBlock <= lastBlockRef.current) {
              return // No new blocks
            }

            console.log(
              `Polling CampaignCreated events: blocks ${lastBlockRef.current} → ${latestBlock}`
            )
            const logs = await (publicClient as any).getLogs({
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
              fromBlock: lastBlockRef.current + BigInt(1),
              toBlock: latestBlock,
            })

            lastBlockRef.current = latestBlock

            if (logs.length > 0) {
              console.log(`Found ${logs.length} CampaignPoolCreated event(s)`)
            }

            // Process each event - just log, no database needed
            for (const log of logs) {
              const poolId = log.args?.poolId as bigint
              const proposalId = log.args?.proposalId as bigint
              const campaignType = log.args?.campaignType as number

              console.log('CampaignPoolCreated event detected:', {
                poolId: poolId.toString(),
                proposalId: proposalId.toString(),
                campaignType: campaignType === 1 ? 'Zakat' : 'Normal',
              })
            }
          } catch (pollError) {
            console.error('Error polling for events:', pollError)
          }
        }, 15000) // Poll every 15 seconds

        console.log('Campaign event listener setup complete')
      } catch (err) {
        console.error('Failed to setup event listener:', err)
      }
    }

    setupListener()

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        console.log('Campaign event listener stopped')
      }
    }
  }, [publicClient])
}
