"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, Lock, Shield, Eye, EyeOff, Sparkles } from "lucide-react";
import { useWallet } from "@/components/providers/web3-provider";
import { useToast } from "@/hooks/use-toast";
import { parseAmount } from "@/lib/abi";
import { useCampaignStatus } from "@/hooks/useCampaignStatus";
import { usePrivateDonation } from "@/hooks/usePrivateDonation";
import {
  PRIVATE_DONATION_AVAILABLE,
  PRIVATE_DONATION_UNAVAILABLE_REASON,
} from "@/lib/aztec-private-donation";
import { ZakatCertificateModal } from "@/components/certificates/zakat-certificate-modal";
import { useLanguage } from "@/components/providers/language-provider";

interface DonationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string | number;
  campaignIdHash?: string;
  campaignTitle: string;
  campaignGoal: number;
  campaignRaised: number;
  onSuccess?: () => void;
}

export function DonationDialog({
  open,
  onOpenChange,
  campaignId,
  campaignIdHash,
  campaignTitle,
  campaignGoal,
  campaignRaised,
  onSuccess,
}: DonationDialogProps) {
  const [amount, setAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [showCertificateModal, setShowCertificateModal] = useState(false);
  const [lastDonationTx, setLastDonationTx] = useState<{
    hash: string;
    amount: number;
  } | null>(null);

  const { donate, isConnected, formattedIdrxBalance, isDonating } = useWallet();
  const { donateZK, isLoading: isPrivateDonating } = usePrivateDonation();
  const { toast } = useToast();
  const { address } = useAccount();
  const { t } = useLanguage();

  // Fetch campaign status to check if donations are allowed
  const { statusInfo, canDonate, isLoading: isLoadingStatus } = useCampaignStatus(
    campaignIdHash || (typeof campaignId === 'string' && campaignId.startsWith('0x') ? campaignId : null)
  );

  const handleDonate = async () => {
    // Check campaign status before attempting donation
    if (!canDonate && statusInfo) {
      toast({
        variant: "destructive",
        title: t('donation.campaignNotReady'),
        description: statusInfo.description || t('donation.campaignNotReadyDesc'),
      });
      return;
    }

    if (!isConnected) {
      toast({
        variant: "destructive",
        title: t('donation.walletNotConnected'),
        description: t('donation.connectWalletToDonate'),
      });
      return;
    }

    if (!amount || amount.trim() === "") {
      toast({
        variant: "destructive",
        title: t('donation.amountRequired'),
        description: t('donation.enterAmount'),
      });
      return;
    }

    const donationAmount = parseFloat(amount);
    if (!donationAmount || isNaN(donationAmount) || donationAmount <= 0) {
      toast({
        variant: "destructive",
        title: t('donation.invalidAmount'),
        description: t('donation.validAmountRequired'),
      });
      return;
    }

    // Check if amount exceeds balance
    const balance = parseFloat(formattedIdrxBalance || "0");
    if (donationAmount > balance) {
      toast({
        variant: "destructive",
        title: t('donation.insufficientBalance'),
        description: `You have ${balance.toLocaleString('id-ID')} IDRX available`,
      });
      return;
    }

    try {
      setIsProcessing(true);

      // Convert to BigInt (wei format)
      const amountInWei = parseAmount(donationAmount.toString());

      // Determine if campaignId is a hash (0x...) or numeric
      let poolId: bigint;
      const numericId = typeof campaignId === 'string' ? parseInt(campaignId, 10) : campaignId;
      poolId = BigInt(numericId);

      if (isPrivate) {
        // Private donation
        const result = await donateZK({
          poolId,
          amount: amountInWei,
        });

        if (result && result.txHash) {
          setLastDonationTx({
            hash: result.txHash,
            amount: donationAmount,
          });
          setShowCertificateModal(true);

          toast({
            title: t('donation.privateDonationSuccess'),
            description: `Your private donation of ${donationAmount.toLocaleString('id-ID')} IDRX to ${campaignTitle} is complete.`,
          });
        }
      } else {
        // Public donation
        const { txHash } = await donate({
          poolId,
          campaignTitle,
          amountIDRX: amountInWei,
        });

        if (txHash) {
          setLastDonationTx({
            hash: txHash,
            amount: donationAmount,
          });
          setShowCertificateModal(true);

          toast({
            title: t('donation.donationSuccess'),
            description: `You donated ${donationAmount.toLocaleString('id-ID')} IDRX to ${campaignTitle}`,
          });
        }
      }

      // Reset amount but keep dialog open for certificate option
      setAmount("");

      // Trigger parent refresh
      if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      console.error("Donation error details:", {
        message: error?.message,
        cause: error?.cause,
        reason: error?.reason,
        code: error?.code,
        fullError: error,
      });

      toast({
        variant: "destructive",
        title: t('donation.donationFailed'),
        description: error?.reason || error?.message || t('donation.transactionFailed'),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDemoDonate = async () => {
    const demoAmount = amount && parseFloat(amount) > 0 ? parseFloat(amount) : 100000;
    setIsProcessing(true);

    setTimeout(() => {
      const mockTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
      setIsProcessing(false);
      setLastDonationTx({
        hash: mockTxHash,
        amount: demoAmount,
      });
      setShowCertificateModal(true);

      toast({
        title: "🎉 Demo Donasi Berhasil!",
        description: `Simulasi donasi ${demoAmount.toLocaleString('id-ID')} IDRX ke ${campaignTitle} sukses terverifikasi.`,
      });

      if (onSuccess) {
        onSuccess();
      }
    }, 1000);
  };

  const quickAmounts = [10000, 50000, 100000, 500000];
  const remaining = campaignGoal - campaignRaised;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pb-1">
          <DialogTitle>Donate to Campaign</DialogTitle>
          <DialogDescription className="line-clamp-1">{campaignTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Campaign Progress */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Raised</span>
              <span className="font-semibold">{campaignRaised.toLocaleString('id-ID')} IDRX</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Goal</span>
              <span className="font-semibold">{campaignGoal.toLocaleString('id-ID')} IDRX</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Remaining</span>
              <span className="font-semibold text-primary">{remaining.toLocaleString('id-ID')} IDRX</span>
            </div>
          </div>

          {/* Wallet Balance */}
          {isConnected && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Your Balance</span>
              <span className="font-bold text-primary">{formattedIdrxBalance} IDRX</span>
            </div>
          )}

          {/* Privacy Toggle */}
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              {isPrivate ? (
                <EyeOff className="h-5 w-5 text-purple-600" />
              ) : (
                <Eye className="h-5 w-5 text-gray-500" />
              )}
              <div>
                <p className="font-medium text-sm">
                  {isPrivate ? t('donation.privateDonation') : t('donation.publicDonation')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {!PRIVATE_DONATION_AVAILABLE
                    ? t('donation.privateUnavailableDesc')
                    : isPrivate
                      ? t('donation.privateDesc')
                      : t('donation.publicDesc')}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant={isPrivate ? "default" : "outline"}
              size="sm"
              onClick={() => setIsPrivate(!isPrivate)}
              disabled={isProcessing || isDonating || !PRIVATE_DONATION_AVAILABLE}
              title={!PRIVATE_DONATION_AVAILABLE ? PRIVATE_DONATION_UNAVAILABLE_REASON : undefined}
              className={isPrivate ? "bg-purple-600 hover:bg-purple-700" : ""}
            >
              {isPrivate ? t('donation.private') : t('donation.public')}
            </Button>
          </div>

          {/* Private donation is gated on ZK verification that is not deployed.
              Say so up front instead of failing after the user commits. */}
          {!PRIVATE_DONATION_AVAILABLE && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <Shield className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800">
                  {t('donation.privateUnavailableTitle')}
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  {t('donation.privateUnavailableBody')}
                </p>
              </div>
            </div>
          )}

          {/* Private Donation Notice */}
          {PRIVATE_DONATION_AVAILABLE && isPrivate && (
            <div className="flex items-start gap-2 p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <Shield className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-purple-800">
                  {t('donation.privacyModeEnabled')}
                </p>
                <p className="text-xs text-purple-700 mt-1">
                  Your donation will use Pedersen commitments to hide the amount. You'll still receive an NFT receipt for your records.
                </p>
              </div>
            </div>
          )}

          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="amount">Donation Amount (IDRX)</Label>
            <Input
              id="amount"
              type="number"
              placeholder={t('donation.enterAmountIdrx')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-lg"
              disabled={isProcessing || isDonating}
            />
          </div>

          {/* Quick Amount Buttons */}
          <div className="space-y-2">
            <Label>Quick Select</Label>
            <div className="grid grid-cols-4 gap-2">
              {quickAmounts.map((quickAmount) => (
                <Button
                  key={quickAmount}
                  variant="outline"
                  size="sm"
                  onClick={() => setAmount(quickAmount.toString())}
                  disabled={isProcessing || isDonating}
                  className="text-xs"
                >
                  {(quickAmount / 1000).toFixed(0)}K
                </Button>
              ))}
            </div>
          </div>

          {/* Warning */}
          {!isConnected && (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-yellow-800">
                {t('donation.connectWalletNotice')}
              </p>
            </div>
          )}

          {/* Campaign Status Warning */}
          {!canDonate && statusInfo && (
            <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <Lock className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-800">
                  {t('donation.campaignNotReady')}
                </p>
                <p className="text-xs text-orange-700 mt-1">
                  {statusInfo.description}
                </p>
              </div>
            </div>
          )}

          {/* Transaction Info */}
          <div className={`border rounded-lg p-3 text-sm space-y-1 ${
            isPrivate
              ? "bg-purple-50 border-purple-200"
              : "bg-blue-50 border-blue-200"
          }`}>
            <p className={`font-semibold ${isPrivate ? "text-purple-900" : "text-blue-900"}`}>
              {isPrivate ? t('donation.privateTransactionDetails') : t('donation.transactionDetails')}
            </p>
            <ul className={`list-disc list-inside space-y-0.5 text-xs ${
              isPrivate ? "text-purple-800" : "text-blue-800"
            }`}>
              <li>Approval required for first-time donation</li>
              <li>You'll receive a soulbound NFT receipt</li>
              {isPrivate ? (
                <>
                  <li>Donation amount hidden using Pedersen commitments</li>
                  <li>Your address won't appear in the public donors list</li>
                </>
              ) : (
                <>
                  <li>Earn vZKT governance tokens (1:1 ratio)</li>
                  <li>All transactions recorded on Ethereum Sepolia</li>
                </>
              )}
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isProcessing || isDonating}
            >
              Cancel
            </Button>
            <Button
              className={`flex-1 ${isPrivate ? "bg-purple-600 hover:bg-purple-700" : ""}`}
              onClick={handleDonate}
              disabled={!canDonate || !isConnected || !amount || isProcessing || isDonating || isLoadingStatus}
            >
              {isProcessing || isDonating || isPrivateDonating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : !canDonate ? (
                "Campaign Not Ready"
              ) : (
                isPrivate ? t('donation.confirmPrivateDonation') : t('donation.confirmDonation')
              )}
            </Button>
          </div>

          {/* DEMO MODE BUTTON */}
          <div className="pt-3 border-t border-border space-y-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleDemoDonate}
              disabled={isProcessing}
              className="w-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-500/30 font-semibold gap-2"
            >
              <Sparkles className="h-4 w-4 text-amber-600" />
              ⚡ Simulasi Donasi Demo (Instant Test)
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              Uji coba seluruh alur donasi & pembuatan sertifikat Zakat tanpa wallet asli.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Zakat Certificate Modal - shown after successful donation */}
    {lastDonationTx && (
      <ZakatCertificateModal
        open={showCertificateModal}
        onOpenChange={(open) => {
          setShowCertificateModal(open);
          if (!open) {
            // Close the main donation dialog when certificate modal is closed
            onOpenChange(false);
            setLastDonationTx(null);
          }
        }}
        donationDetails={{
          donorAddress: address || "0x71C839A2e8419F23a0781D92F3918a2879F492F1",
          poolId: typeof campaignId === 'string' ? parseInt(campaignId, 10) : campaignId,
          amount: lastDonationTx.amount,
          campaignTitle,
          campaignType: isPrivate ? '1' : '0',
          transactionHash: lastDonationTx.hash,
        }}
        onCertificateGenerated={(cert) => {
          console.log('Certificate generated:', cert);
        }}
      />
    )}
  </>
  );
}
