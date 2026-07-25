"use client";

import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT_ADDRESSES, MockIDRXABI, formatIDRX } from "@/lib/abi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Droplet, CheckCircle2, XCircle, Clock, Vote } from "lucide-react";
import { useIDRXBalance } from "@/hooks/useIDRXBalance";
import { useVotingPower } from "@/hooks/useVotingPower";
import { handleTransactionError, handleWalletError } from "@/lib/errors";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";

export default function FaucetPage() {
  const { address, isConnected } = useAccount();
  const { balance, formattedBalance, refetch: refetchBalance } = useIDRXBalance();
  const { 
    formattedVotingPower, 
    requestVotingPower, 
    isRequesting: isRequestingVotingPower,
    refetch: refetchVotingPower 
  } = useVotingPower();
  
  const { toast } = useToast();
  const [countdown, setCountdown] = useState<number | null>(null);

  // Check if user can claim from faucet
  const {
    data: canClaim,
    isLoading: isCheckingEligibility,
    refetch: refetchEligibility,
  } = useReadContract({
    address: CONTRACT_ADDRESSES.MockIDRX,
    abi: MockIDRXABI,
    functionName: "canClaimFaucet",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 10_000, // Check every 10 seconds
    },
  });

  // Get last claim timestamp for countdown
  const { data: lastClaimTime } = useReadContract({
    address: CONTRACT_ADDRESSES.MockIDRX,
    abi: MockIDRXABI,
    functionName: "timeUntilNextClaim",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !canClaim,
    },
  });

  // Calculate countdown
  useEffect(() => {
    if (!lastClaimTime || canClaim) {
      setCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const lastClaim = Number(lastClaimTime);
      const nextClaimTime = lastClaim + 24 * 60 * 60; // 24 hours in seconds
      const now = Math.floor(Date.now() / 1000);
      const remaining = nextClaimTime - now;

      if (remaining <= 0) {
        setCountdown(null);
        refetchEligibility();
      } else {
        setCountdown(remaining);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [lastClaimTime, canClaim, refetchEligibility]);

  // Faucet claim transaction
  const {
    writeContract,
    data: txHash,
    isPending: isClaimPending,
    error: claimError,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash: txHash,
    });

  // Handle claim
  const handleClaim = async () => {
    if (!isConnected) {
      const msg = handleWalletError(new Error("not-connected"));
      toast({
        title: "Wallet Error",
        description: msg,
        variant: "destructive",
      });
      return;
    }

    if (!canClaim) {
      toast({
        title: "Cannot Claim",
        description: "You must wait 24 hours between claims",
        variant: "destructive",
      });
      return;
    }

    try {
      writeContract({
        address: CONTRACT_ADDRESSES.MockIDRX,
        abi: MockIDRXABI,
        functionName: "faucet",
        args: [],
      });
    } catch (error) {
      const txErrMsg = handleTransactionError(error);
      toast({
        title: "Transaction Error",
        description: txErrMsg,
        variant: "destructive",
      });
    }
  };

  const handleClaimVotingPower = async () => {
    await requestVotingPower();
    refetchVotingPower();
  };

  // Handle transaction confirmation
  useEffect(() => {
    if (isConfirmed) {
      toast({
        title: "Faucet Claimed!",
        description: "MockIDRX tokens have been sent to your wallet",
      });
      refetchBalance();
      refetchEligibility();
    }
  }, [isConfirmed, toast, refetchBalance, refetchEligibility]);

  // Format countdown
  const formatCountdown = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-8">
      {/* IDRX Faucet */}
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <Droplet className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-3xl">MockIDRX Faucet</CardTitle>
          <CardDescription>
            Get free testnet MockIDRX tokens for testing donations on Ethereum Sepolia
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Current Balance */}
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">Your Balance</p>
            <p className="text-2xl font-bold">{formattedBalance} IDRX</p>
          </div>

          {/* Eligibility Status */}
          {isConnected ? (
            <Alert className={canClaim ? "border-green-500" : "border-yellow-500"}>
              {canClaim ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <Clock className="h-4 w-4 text-yellow-500" />
              )}
              <AlertDescription>
                {isCheckingEligibility ? (
                  "Checking eligibility..."
                ) : canClaim ? (
                  "You can claim from the faucet"
                ) : countdown !== null ? (
                  <>
                    Next claim available in: <strong>{formatCountdown(countdown)}</strong>
                  </>
                ) : (
                  "You must wait 24 hours between claims"
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                Please connect your wallet to use the faucet
              </AlertDescription>
            </Alert>
          )}

          {/* Claim Button */}
          <Button
            onClick={handleClaim}
            disabled={!isConnected || !canClaim || isClaimPending || isConfirming}
            className="w-full"
            size="lg"
          >
            {isClaimPending || isConfirming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isClaimPending ? "Claiming..." : "Confirming..."}
              </>
            ) : isConfirmed ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Claimed Successfully!
              </>
            ) : (
              "Claim MockIDRX"
            )}
          </Button>

          {/* Transaction Hash */}
          {txHash && (
            <div className="text-center text-sm">
              <p className="text-muted-foreground mb-1">Transaction Hash:</p>
              <a
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline break-all"
              >
                {txHash}
              </a>
            </div>
          )}

          {/* Error Display */}
          {claimError && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                {claimError.message || "Failed to claim from faucet"}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Voting Power Faucet */}
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
            <Vote className="w-8 h-8 text-purple-600" />
          </div>
          <CardTitle className="text-3xl">Governance Faucet</CardTitle>
          <CardDescription>
            Get vZKT tokens to participate in DAO voting and proposals
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Current Balance */}
          <div className="bg-purple-50 rounded-lg p-4 text-center">
            <p className="text-sm text-purple-700 mb-1">Your Voting Power</p>
            <p className="text-2xl font-bold text-purple-900">{formattedVotingPower} vZKT</p>
          </div>

          <div className="text-sm text-muted-foreground text-center">
            You need at least 100 vZKT to create proposals. Voting power is usually earned by donating, but you can claim some here for testing.
          </div>

          <Button
            onClick={handleClaimVotingPower}
            disabled={!isConnected || isRequestingVotingPower}
            className="w-full bg-purple-600 hover:bg-purple-700"
            size="lg"
          >
            {isRequestingVotingPower ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Requesting...
              </>
            ) : (
              "Request 100 vZKT"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Info */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm space-y-2">
        <p className="font-semibold text-blue-900 dark:text-blue-100">ℹ️ Faucet Information</p>
        <ul className="list-disc list-inside text-blue-800 dark:text-blue-200 space-y-1">
          <li>Claim limit: Once every 24 hours per address (MockIDRX)</li>
          <li>Network: Ethereum Sepolia</li>
          <li>Tokens are for testing purposes only</li>
          <li>Use tokens to donate to campaigns and test governance</li>
        </ul>
      </div>
    </div>
  );
}