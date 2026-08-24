"use client";

import { useCallback, useState } from "react";
import { useAccount } from "wagmi";
import { uploadFilesToPinata } from "@/lib/pinata-client";
import { toast } from "@/components/ui/use-toast";
import { useCreateCampaignOnChain } from "./useCreateCampaignOnChain";

interface CreateCampaignParams {
  campaignId: string;
  title: string;
  description: string;
  category: string;
  location: string;
  goal: number;
  organizationName: string;
  organizationVerified: boolean;
  imageFiles: File[];
  tags: string[];
  startTime: number;
  endTime: number;
  isEmergency?: boolean;
  zakatChecklistItems?: string[];
  milestones?: { description: string; targetAmount: number }[];
}

interface CampaignMetadata {
  title: string;
  description: string;
  category: string;
  location: string;
  goal: number;
  organizationName: string;
  organizationVerified: boolean;
  imageUrls: string[];
  tags: string[];
  startTime: number;
  endTime: number;
}

export const useCreateCampaign = () => {
  const { address, isConnected } = useAccount();
  const { createCampaignOnChain, isLoading: isOnChainLoading } =
    useCreateCampaignOnChain();

  const [isLoading, setIsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState<string>("");

  const createCampaign = useCallback(
    async (params: CreateCampaignParams) => {
      if (!address || !isConnected) {
        toast({
          title: "Error",
          description: "Please connect your wallet first",
          variant: "destructive",
        });
        return null;
      }

      setIsLoading(true);
      setUploadProgress(0);

      try {
        // ============================================
        // STEP 1: Upload images to IPFS/Pinata
        // ============================================
        setCurrentStep("Uploading images...");
        setUploadProgress(20);

        let imageUrls: string[] = [];
        if (params.imageFiles.length > 0) {
          imageUrls = await uploadFilesToPinata(params.imageFiles);
          console.log("Images uploaded:", imageUrls);
        }

        // ============================================
        // STEP 2: Upload metadata to IPFS
        // ============================================
        setCurrentStep("Uploading metadata...");
        setUploadProgress(40);

        const metadata = {
          campaignId: params.campaignId,
          title: params.title,
          description: params.description,
          category: params.category,
          location: params.location,
          goal: params.goal,
          organizationName: params.organizationName,
          organizationVerified: params.organizationVerified,
          imageUrls,
          tags: params.tags,
          startTime: params.startTime,
          endTime: params.endTime,
          milestones: params.milestones, // Include milestones in metadata
        };

        // Upload metadata JSON to IPFS
        const metadataBlob = new Blob([JSON.stringify(metadata)], {
          type: "application/json",
        });
        const metadataFile = new File([metadataBlob], "metadata.json", {
          type: "application/json",
        });
        const metadataUploads = await uploadFilesToPinata([metadataFile]);
        const metadataURI = `ipfs://${metadataUploads[0]}`;

        console.log("Metadata uploaded:", metadataURI);

        // ============================================
        // STEP 3: Create proposal on blockchain
        // ============================================
        setCurrentStep("Creating proposal on blockchain...");
        setUploadProgress(60);

        // Format milestones for contract (convert number to bigint wei)
        const milestoneInputs = params.milestones?.map((m) => ({
          description: m.description,
          targetAmount: BigInt(Math.floor(m.targetAmount * 1e18)),
        }));

        const onChainResult = await createCampaignOnChain({
          title: params.title,
          description: params.description,
          fundingGoal: params.goal,
          isEmergency: params.isEmergency || false,
          zakatChecklistItems: params.zakatChecklistItems || [],
          metadataURI,
          milestoneInputs,
        });

        if (!onChainResult) {
          throw new Error("Failed to create proposal on blockchain");
        }

        console.log("On-chain creation successful:", onChainResult);

        // ============================================
        // STEP 4: Complete
        // ============================================
        setCurrentStep("Complete!");
        setUploadProgress(100);

        toast({
          title: "Success",
          description: "Proposal created successfully on blockchain",
        });

        return {
          metadataURI,
          txHash: onChainResult.txHash,
        };
      } catch (error) {
        console.error("Proposal creation failed:", error);

        // Detailed error message
        let errorMessage = "Failed to create proposal";
        if (error instanceof Error) {
          errorMessage = error.message;
        }

        toast({
          title: "Proposal Creation Failed",
          description: errorMessage,
          variant: "destructive",
        });

        return null;
      } finally {
        setIsLoading(false);
        setUploadProgress(0);
        setCurrentStep("");
      }
    },
    [address, isConnected, createCampaignOnChain],
  );

  return {
    createCampaign,
    isLoading: isLoading || isOnChainLoading,
    uploadProgress,
    currentStep,
  };
};
