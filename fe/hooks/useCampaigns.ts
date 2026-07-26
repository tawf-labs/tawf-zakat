"use client";

import { useEffect, useState, useCallback } from "react";
import { useReadContracts } from "wagmi";
import { CONTRACT_ADDRESSES, ZKTCoreABI } from "@/lib/abi";
import { getAllCampaignPools, getCampaignPool, calculateDaysLeft, type CampaignData } from "@/lib/contract-client";
import { campaigns as demoCampaigns } from "@/data/campaigns";

// Campaign structure (UI-friendly)
export interface Campaign {
  id: number;
  poolId: number;
  title: string;
  description: string;
  imageUrl: string;
  image: string;
  organizationName: string;
  organizationAddress: string;
  category: string;
  location: string;
  raised: number;
  goal: number;
  donors: number;
  daysLeft: number;
  isActive: boolean;
  isVerified: boolean;
  startDate: number;
  endDate: number;
  campaignType: number;
  imageUrls: string[];
  tags: string[];
  metadataURI?: string;
  // NEW: Storytelling fields
  familiesHelped?: number;
  // URL slug for clean campaign links
  slug?: string;
}

/**
 * Hook to fetch all campaign pools from ZKTCore contract
 */
export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch campaigns using contract client
  const fetchCampaigns = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    // If running with mocks enabled, return local demo data
    try {
      if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_USE_MOCKS === "1") {
        const converted: Campaign[] = demoCampaigns.map((d) => ({
          id: d.id,
          poolId: d.id,
          title: d.title,
          description: "",
          imageUrl: d.image,
          image: d.image,
          organizationName: d.organizationName,
          organizationAddress: "",
          category: d.category,
          location: d.location || "",
          raised: d.raised,
          goal: d.goal,
          donors: d.donors,
          daysLeft: d.daysLeft,
          isActive: true,
          isVerified: d.isVerified ?? false,
          startDate: Date.now(),
          endDate: Date.now() + (d.daysLeft || 0) * 24 * 60 * 60 * 1000,
          campaignType: 0,
          imageUrls: d.image ? [d.image] : [],
          tags: [],
          familiesHelped: d.familiesHelped,
          slug: d.slug,
        }));

        setCampaigns(converted);
        setIsLoading(false);
        return;
      }
    } catch (err) {
      // fallback to normal flow if env access fails
      console.warn("Mock campaigns check failed, continuing to contract fetch.", err);
    }
    try {
      const contractCampaigns = await getAllCampaignPools();

      if (contractCampaigns && contractCampaigns.length > 0) {
        const convertedCampaigns: Campaign[] = contractCampaigns.map((c) => ({
          id: c.poolId,
          poolId: c.poolId,
          title: c.title,
          description: c.description,
          imageUrl: c.imageUrl,
          image: c.imageUrl,
          organizationName: c.organizationName,
          organizationAddress: c.organizer,
          category: c.category,
          location: c.location,
          raised: c.raised,
          goal: c.goal,
          donors: c.donors,
          daysLeft: calculateDaysLeft(c.endTime),
          isActive: c.isActive,
          isVerified: c.isVerified,
          startDate: c.createdAt,
          endDate: c.endTime,
          campaignType: c.campaignType,
          imageUrls: c.imageUrls,
          tags: c.tags,
          metadataURI: c.metadataURI,
        }));

        setCampaigns(convertedCampaigns);
        setIsLoading(false);
        return;
      }
    } catch (err) {
      console.warn("Contract campaigns fetch error, falling back to demo data:", err);
    }

    // Fallback to local demo data when contract pools are empty or unavailable
    const converted: Campaign[] = demoCampaigns.map((d) => ({
      id: d.id,
      poolId: d.id,
      title: d.title,
      description: `${d.title} - Campaign by ${d.organizationName}.`,
      imageUrl: d.image,
      image: d.image,
      organizationName: d.organizationName,
      organizationAddress: "0x71C839A2e8419F23a0781D92F3918a2879F492F1",
      category: d.category,
      location: d.location || "Indonesia",
      raised: d.raised,
      goal: d.goal,
      donors: d.donors,
      daysLeft: d.daysLeft,
      isActive: true,
      isVerified: d.isVerified ?? true,
      startDate: Date.now(),
      endDate: Date.now() + (d.daysLeft || 0) * 24 * 60 * 60 * 1000,
      campaignType: 0,
      imageUrls: d.image ? [d.image] : [],
      tags: [d.category],
      familiesHelped: d.familiesHelped,
      slug: d.slug,
    }));

    setCampaigns(converted);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  // Refetch campaigns
  const refetch = useCallback(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  return {
    campaigns,
    isLoading,
    error,
    refetch,
  };
}

// Hook for single campaign (by poolId)
export function useCampaign(poolId: number) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCampaign = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const contractCampaign = await getCampaignPool(poolId);

      if (contractCampaign) {
        const convertedCampaign: Campaign = {
          id: contractCampaign.poolId,
          poolId: contractCampaign.poolId,
          title: contractCampaign.title,
          description: contractCampaign.description,
          imageUrl: contractCampaign.imageUrl,
          image: contractCampaign.imageUrl,
          organizationName: contractCampaign.organizationName,
          organizationAddress: contractCampaign.organizer,
          category: contractCampaign.category,
          location: contractCampaign.location,
          raised: contractCampaign.raised,
          goal: contractCampaign.goal,
          donors: contractCampaign.donors,
          daysLeft: calculateDaysLeft(contractCampaign.endTime),
          isActive: contractCampaign.isActive,
          isVerified: contractCampaign.isVerified,
          startDate: contractCampaign.createdAt,
          endDate: contractCampaign.endTime,
          campaignType: contractCampaign.campaignType,
          imageUrls: contractCampaign.imageUrls,
          tags: contractCampaign.tags,
          metadataURI: contractCampaign.metadataURI,
        };
        setCampaign(convertedCampaign);
      } else {
        setCampaign(null);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error");
      setError(error);
      console.error("Error fetching campaign:", error);
    } finally {
      setIsLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    if (poolId > 0) {
      fetchCampaign();
    }
  }, [poolId, fetchCampaign]);

  const refetch = useCallback(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  return {
    campaign,
    isLoading,
    error,
    refetch,
  };
}
