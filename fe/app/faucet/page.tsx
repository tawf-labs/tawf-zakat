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
import { useLanguage } from "@/components/providers/language-provider";
import { useEffect, useState } from "react";

export default function FaucetPage() {
  const { t } = useLanguage()
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
        description: t('faucet.notEligibleMessage'),
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
          <CardTitle className="text-3xl">{t('faucet.title')}</CardTitle>
          <CardDescription>
            {t('faucet.description')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Current Balance */}
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">{t('faucet.yourBalance')}</p>
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
                  t('faucet.checkingEligibility')
                ) : canClaim ? (
                  t('faucet.eligibleMessage')
                ) : countdown !== null ? (
                  <>
                    {t('faucet.nextClaimIn')} <strong>{formatCountdown(countdown)}</strong>
                  </>
                ) : (
                  t('faucet.notEligibleMessage')
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                {t('faucet.notConnected')}
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
                {isClaimPending ? t('faucet.claiming') : t('faucet.confirming')}
              </>
            ) : isConfirmed ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {t('faucet.claimedSuccess')}
              </>
            ) : (
              t('faucet.claimButton')
            )}
          </Button>

          {/* Transaction Hash */}
          {txHash && (
            <div className="text-center text-sm">
              <p className="text-muted-foreground mb-1">{t('faucet.transactionHash')}</p>
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
                {claimError.message || t('faucet.claimFailed')}
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
          <CardTitle className="text-3xl">{t('faucet.governanceTitle')}</CardTitle>
          <CardDescription>
            {t('faucet.governanceDescription')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Current Balance */}
          <div className="bg-purple-50 rounded-lg p-4 text-center">
            <p className="text-sm text-purple-700 mb-1">{t('faucet.yourVotingPower')}</p>
            <p className="text-2xl font-bold text-purple-900">{formattedVotingPower} vZKT</p>
          </div>

          <div className="text-sm text-muted-foreground text-center">
            {t('faucet.votingPowerInfo')}
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
                {t('faucet.requesting')}
              </>
            ) : (
              t('faucet.requestButton')
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Info */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm space-y-2">
        <p className="font-semibold text-blue-900 dark:text-blue-100">{t('faucet.info')}</p>
        <ul className="list-disc list-inside text-blue-800 dark:text-blue-200 space-y-1">
          <li>{t('faucet.infoLine1')}</li>
          <li>{t('faucet.infoLine2')}</li>
          <li>{t('faucet.infoLine3')}</li>
          <li>{t('faucet.infoLine4')}</li>
        </ul>
      </div>
    </div>
  );
}
