import { createPublicClient, http, getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { CONTRACT_ADDRESSES, ZKTCoreABI, PoolManagerABI, ProposalManagerABI, ZakatEscrowManagerABI } from './abi';

// Create a public client for reading contract data
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com'),
});

// Campaign metadata type (stored on-chain via IPFS URI)
export interface CampaignMetadata {
  title: string;
  description: string;
  category: string;
  location: string;
  imageUrls: string[];
  tags: string[];
  organizationName: string;
  organizationVerified: boolean;
}

// Full campaign data from contract + IPFS
export interface CampaignData {
  poolId: number;
  proposalId: number;
  title: string;
  description: string;
  category: string;
  location: string;
  goal: number;
  organizationName: string;
  organizationVerified: boolean;
  imageUrl: string;
  imageUrls: string[];
  tags: string[];
  createdAt: number;
  endTime: number;
  raised: number;
  donors: number;
  isActive: boolean;
  isVerified: boolean;
  organizer: string;
  campaignType: number;
  metadataURI?: string;
}

// Fetch IPFS metadata from URI
export async function fetchIPFSMetadata(ipfsURI: string): Promise<CampaignMetadata | null> {
  try {
    // Convert ipfs:// URI to gateway URL
    const gatewayUrl = ipfsURI.replace('ipfs://', 'https://ipfs.io/ipfs/');

    const response = await fetch(gatewayUrl);
    if (!response.ok) {
      console.warn('Failed to fetch IPFS metadata:', response.statusText);
      return null;
    }

    const data = await response.json();
    return data as CampaignMetadata;
  } catch (error) {
    console.error('Error fetching IPFS metadata:', error);
    return null;
  }
}

// Get all campaign pools from contract (both Normal and Zakat)
export async function getAllCampaignPools(): Promise<CampaignData[]> {
  try {
    const campaigns: CampaignData[] = [];

    // 1. Fetch Normal Pools from PoolManager
    try {
      const normalPoolCount = await publicClient.readContract({
        address: getAddress(CONTRACT_ADDRESSES.PoolManager),
        abi: PoolManagerABI,
        functionName: 'poolCount',
      }) as bigint;

      const normalCount = Number(normalPoolCount);

      for (let i = 1; i <= normalCount; i++) {
        try {
          const pool = await publicClient.readContract({
            address: getAddress(CONTRACT_ADDRESSES.PoolManager),
            abi: PoolManagerABI,
            functionName: 'getPool',
            args: [BigInt(i)],
          }) as any;

          if (!pool || !pool.campaignTitle) continue;
          if (pool.poolId === 0n) continue;

          const proposal = await publicClient.readContract({
            address: getAddress(CONTRACT_ADDRESSES.ProposalManager),
            abi: ProposalManagerABI,
            functionName: 'getProposal',
            args: [BigInt(pool.proposalId)],
          }) as any;

          let metadata: CampaignMetadata = {
            title: pool.campaignTitle,
            description: proposal?.description || '',
            category: 'General',
            location: 'Indonesia',
            imageUrls: [],
            tags: [],
            organizationName: pool.organizer
              ? `${pool.organizer.slice(0, 6)}...${pool.organizer.slice(-4)}`
              : 'Unknown',
            organizationVerified: false,
          };

          if (proposal?.metadataURI && proposal.metadataURI.length > 0) {
            const ipfsMetadata = await fetchIPFSMetadata(proposal.metadataURI);
            if (ipfsMetadata) {
              metadata = { ...metadata, ...ipfsMetadata };
            }
          }

          const fundingGoal = Number(pool.fundingGoal || 0n) / 1e18;
          const raisedAmount = Number(pool.raisedAmount || 0n) / 1e18;
          const createdAt = Number(pool.createdAt || 0n);
          const endTime = createdAt + (90 * 24 * 60 * 60);

          campaigns.push({
            poolId: i,
            proposalId: Number(pool.proposalId),
            title: metadata.title,
            description: metadata.description,
            category: metadata.category,
            location: metadata.location,
            goal: fundingGoal,
            organizationName: metadata.organizationName,
            organizationVerified: metadata.organizationVerified,
            imageUrl: metadata.imageUrls[0] || 'https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=500',
            imageUrls: metadata.imageUrls,
            tags: metadata.tags,
            createdAt,
            endTime,
            raised: raisedAmount,
            donors: pool.donors?.length || 0,
            isActive: pool.isActive || false,
            isVerified: false,
            organizer: pool.organizer,
            campaignType: 0,
            metadataURI: proposal?.metadataURI,
          });
        } catch (error) {
          console.error(`Error fetching normal pool ${i}:`, error);
        }
      }
    } catch (e) {
      console.error('Error fetching normal pools:', e);
    }

    // 2. Fetch Zakat Pools from ZakatEscrowManager
    try {
      const zakatPoolCount = await publicClient.readContract({
        address: getAddress(CONTRACT_ADDRESSES.ZakatEscrowManager),
        abi: ZakatEscrowManagerABI,
        functionName: 'poolCount',
      }) as bigint;

      const zakatCount = Number(zakatPoolCount);

      for (let i = 1; i <= zakatCount; i++) {
        try {
          const pool = await publicClient.readContract({
            address: getAddress(CONTRACT_ADDRESSES.ZakatEscrowManager),
            abi: ZakatEscrowManagerABI,
            functionName: 'getPool',
            args: [BigInt(i)],
          }) as any;

          if (!pool || !pool.campaignTitle) continue;
          if (pool.poolId === 0n) continue;

          const proposal = await publicClient.readContract({
            address: getAddress(CONTRACT_ADDRESSES.ProposalManager),
            abi: ProposalManagerABI,
            functionName: 'getProposal',
            args: [BigInt(pool.proposalId)],
          }) as any;

          let metadata: CampaignMetadata = {
            title: pool.campaignTitle,
            description: proposal?.description || '',
            category: 'Zakat',
            location: 'Indonesia',
            imageUrls: [],
            tags: [],
            organizationName: pool.organizer
              ? `${pool.organizer.slice(0, 6)}...${pool.organizer.slice(-4)}`
              : 'Unknown',
            organizationVerified: true,
          };

          if (proposal?.metadataURI && proposal.metadataURI.length > 0) {
            const ipfsMetadata = await fetchIPFSMetadata(proposal.metadataURI);
            if (ipfsMetadata) {
              metadata = { ...metadata, ...ipfsMetadata };
            }
          }

          const fundingGoal = Number(pool.fundingGoal || 0n) / 1e18;
          const raisedAmount = Number(pool.raisedAmount || 0n) / 1e18;
          const createdAt = Number(pool.createdAt || 0n);
          const endTime = Number(pool.deadline || 0n);

          campaigns.push({
            poolId: i,
            proposalId: Number(pool.proposalId),
            title: metadata.title,
            description: metadata.description,
            category: metadata.category,
            location: metadata.location,
            goal: fundingGoal,
            organizationName: metadata.organizationName,
            organizationVerified: metadata.organizationVerified,
            imageUrl: metadata.imageUrls[0] || 'https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=500',
            imageUrls: metadata.imageUrls,
            tags: metadata.tags,
            createdAt,
            endTime,
            raised: raisedAmount,
            donors: pool.donors?.length || 0,
            isActive: pool.status === 0,
            isVerified: true,
            organizer: pool.organizer,
            campaignType: 1,
            metadataURI: proposal?.metadataURI,
          });
        } catch (error) {
          console.error(`Error fetching zakat pool ${i}:`, error);
        }
      }
    } catch (e) {
      console.error('Error fetching zakat pools:', e);
    }

    return campaigns;
  } catch (error) {
    console.error('Error fetching campaigns from contract:', error);
    return [];
  }
}

// Get single campaign by pool ID
export async function getCampaignPool(poolId: number): Promise<CampaignData | null> {
  try {
    let pool: any = null;
    let campaignType = 0; // Default to Normal

    // 1. Try PoolManager first
    try {
      pool = await publicClient.readContract({
        address: getAddress(CONTRACT_ADDRESSES.PoolManager),
        abi: PoolManagerABI,
        functionName: 'getPool',
        args: [BigInt(poolId)],
      }) as any;
    } catch (e) {
      // Ignore error, might be in Zakat manager
    }

    // 2. If not found or empty, try ZakatEscrowManager
    if (!pool || !pool.campaignTitle || pool.poolId === 0n) {
      try {
        pool = await publicClient.readContract({
          address: getAddress(CONTRACT_ADDRESSES.ZakatEscrowManager),
          abi: ZakatEscrowManagerABI,
          functionName: 'getPool',
          args: [BigInt(poolId)],
        }) as any;
        campaignType = 1; // Zakat
      } catch (e) {
        // Ignore error
      }
    }

    if (!pool || !pool.campaignTitle) return null;

    // Get proposal for metadata
    const proposal = await publicClient.readContract({
      address: getAddress(CONTRACT_ADDRESSES.ProposalManager),
      abi: ProposalManagerABI,
      functionName: 'getProposal',
      args: [BigInt(pool.proposalId)],
    }) as any;

    // Default metadata from contract data
    let metadata: CampaignMetadata = {
      title: pool.campaignTitle,
      description: proposal?.description || '',
      category: campaignType === 1 ? 'Zakat' : 'General',
      location: 'Indonesia',
      imageUrls: [],
      tags: [],
      organizationName: pool.organizer
        ? `${pool.organizer.slice(0, 6)}...${pool.organizer.slice(-4)}`
        : 'Unknown',
      organizationVerified: campaignType === 1,
    };

    // Try to fetch IPFS metadata if available
    if (proposal?.metadataURI && proposal.metadataURI.length > 0) {
      const ipfsMetadata = await fetchIPFSMetadata(proposal.metadataURI);
      if (ipfsMetadata) {
        metadata = { ...metadata, ...ipfsMetadata };
      }
    }

    const fundingGoal = Number(pool.fundingGoal || 0n) / 1e18;
    const raisedAmount = Number(pool.raisedAmount || 0n) / 1e18;
    const createdAt = Number(pool.createdAt || 0n);
    
    // Determine end time based on campaign type
    let endTime = 0;
    if (campaignType === 1) {
      // Zakat pool has deadline
      endTime = Number(pool.deadline || 0n);
    } else {
      // Normal pool default
      endTime = createdAt + (90 * 24 * 60 * 60);
    }

    return {
      poolId,
      proposalId: Number(pool.proposalId),
      title: metadata.title,
      description: metadata.description,
      category: metadata.category,
      location: metadata.location,
      goal: fundingGoal,
      organizationName: metadata.organizationName,
      organizationVerified: metadata.organizationVerified,
      imageUrl: metadata.imageUrls[0] || 'https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=500',
      imageUrls: metadata.imageUrls,
      tags: metadata.tags,
      createdAt,
      endTime,
      raised: raisedAmount,
      donors: pool.donors?.length || 0,
      isActive: pool.status !== undefined ? (pool.status === 0) : (pool.isActive || false),
      isVerified: campaignType === 1,
      organizer: pool.organizer,
      campaignType: campaignType,
      metadataURI: proposal?.metadataURI,
    };
  } catch (error) {
    console.error('Error fetching campaign from contract:', error);
    return null;
  }
}

// Helper function to calculate days left
export function calculateDaysLeft(endDate: number): number {
  const now = Math.floor(Date.now() / 1000);
  const daysLeft = Math.ceil((endDate - now) / 86400);
  return Math.max(daysLeft, 0);
}
