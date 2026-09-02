"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, FileText, Shield, Download, Calendar, Hash } from "lucide-react";
import { useZakatCertificate } from "@/hooks/useZakatCertificate";
import { useLanguage } from "@/components/providers/language-provider";
import { formatAddress } from "@/lib/abi";

interface ZakatCertificateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  donationDetails: {
    donorAddress: string;
    poolId: number;
    amount: number;
    campaignTitle: string;
    campaignType: string;
    transactionHash: string;
  };
  onCertificateGenerated?: (certificate: any) => void;
}

export function ZakatCertificateModal({
  open,
  onOpenChange,
  donationDetails,
  onCertificateGenerated,
}: ZakatCertificateModalProps) {
  const [hasConsented, setHasConsented] = useState(false);
  const [hasReadNotice, setHasReadNotice] = useState(false);
  const { t } = useLanguage();

  const { generateCertificate, isGenerating, certificate } = useZakatCertificate();

  const handleGenerateCertificate = async () => {
    if (!hasConsented) {
      return;
    }

    const result = await generateCertificate(donationDetails);

    if (result) {
      if (onCertificateGenerated) {
        onCertificateGenerated(result);
      }

      // Close modal after successful generation (delay to show success)
      setTimeout(() => {
        onOpenChange(false);
      }, 2000);
    }
  };

  const handleClose = () => {
    // Reset state when closing
    setHasConsented(false);
    setHasReadNotice(false);
    onOpenChange(false);
  };

  // Reset consent when modal opens
  useEffect(() => {
    if (!open) {
      setHasConsented(false);
      setHasReadNotice(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Zakat Certificate
          </DialogTitle>
          <DialogDescription>
            Optional official certificate for your donation record
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Certificate Preview */}
          <div className="bg-accent border-2 border-primary/20 rounded-lg p-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-full">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-primary">Zakat Certificate</h3>
              <p className="text-sm text-primary">Official Donation Receipt</p>
            </div>

            <div className="border-t border-primary/20 pt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-primary">Certificate ID:</span>
                <span className="font-mono font-semibold text-foreground">
                  {certificate ? certificate.id : "ZAKT-XXXXXXXXX"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-primary">Donation Amount:</span>
                <span className="font-semibold text-foreground">
                  {donationDetails.amount.toLocaleString('id-ID')} IDRX
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-primary">Campaign:</span>
                <span className="font-semibold text-foreground max-w-[200px] truncate">
                  {donationDetails.campaignTitle}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-primary">Type:</span>
                <span className="font-semibold text-foreground">
                  {donationDetails.campaignType === '1' ? t('certificate.zakatCompliant') : t('certificate.generalDonation')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-primary">Transaction:</span>
                <span className="font-mono text-xs text-primary truncate max-w-[200px]">
                  {donationDetails.transactionHash}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-primary">Valid Until:</span>
                <span className="font-semibold text-foreground">
                  {certificate
                    ? new Date(certificate.expiresAt).toLocaleDateString('id-ID', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : t('certificate.oneYearFromIssue')}
                </span>
              </div>
            </div>
          </div>

          {/* Privacy Notice */}
          <div className="bg-accent border border-primary/20 rounded-lg p-4 space-y-2">
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Privacy Notice
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  To generate this certificate, the following information will be stored in a secure database:
                </p>
                <ul className="list-disc list-inside text-xs text-muted-foreground mt-1 space-y-0.5 ml-4">
                  <li>{t('certificate.privacyItem1')} ({formatAddress(donationDetails.donorAddress)})</li>
                  <li>{t('certificate.privacyItem2')}</li>
                  <li>{t('certificate.privacyItem3')}</li>
                  <li>{t('certificate.privacyItem4')}</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Purpose Notice */}
          <div className="bg-accent border border-primary/20 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">
              <strong>{t('certificate.purposeNotice').split('. ')[0] + '? '}</strong>{t('certificate.purposeNotice').split('. ').slice(1).join('. ')}
            </p>
          </div>

          {/* Consent Checkbox */}
          <div className="flex items-start space-x-3">
            <Checkbox
              id="certificate-consent"
              checked={hasConsented}
              onCheckedChange={(checked) => setHasConsented(checked === true)}
              disabled={isGenerating}
              className="mt-1"
            />
            <div className="flex-1">
              <Label
                htmlFor="certificate-consent"
                className="text-sm font-medium cursor-pointer"
              >
                {t('certificate.consentLabel')}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                {t('certificate.consentHint')}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleClose}
              disabled={isGenerating}
            >
              Skip
            </Button>
            <Button
              className="flex-1 bg-primary hover:bg-primary/90"
              onClick={handleGenerateCertificate}
              disabled={!hasConsented || isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : certificate ? (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Download Certificate
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  Generate Certificate
                </>
              )}
            </Button>
          </div>

          {/* Success Message */}
          {certificate && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2">
              <Shield className="h-5 w-5 text-primary flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t('certificate.success')}
                </p>
                <p className="text-xs text-primary mt-1">
                  {t('certificate.successDesc')} <span className="font-mono">{certificate.id}</span>.
                  {t('certificate.keepForTax')}
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
