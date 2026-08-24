'use client';

import { useState, useCallback } from 'react';
import { toast } from '@/components/ui/use-toast';

interface CertificateParams {
  donorAddress: string;
  poolId: number;
  amount: number;
  campaignTitle: string;
  campaignType: string;
  transactionHash: string;
}

interface CertificateResponse {
  success: boolean;
  certificate?: {
    id: string;
    downloadUrl: string;
    expiresAt: string;
  };
  error?: string;
}

export function useZakatCertificate() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [certificate, setCertificate] = useState<CertificateResponse['certificate'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateCertificate = useCallback(
    async (params: CertificateParams): Promise<CertificateResponse['certificate'] | null> => {
      setIsGenerating(true);
      setError(null);
      setCertificate(null);

      try {
        console.log('Generating Zakat certificate:', params);

        const response = await fetch('/api/certificates', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...params,
            timestamp: Math.floor(Date.now() / 1000),
          }),
        });

        const data: CertificateResponse = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to generate certificate');
        }

        setCertificate(data.certificate || null);

        toast({
          title: 'Certificate Generated',
          description: `Your Zakat certificate (${data.certificate?.id}) is ready for download.`,
        });

        console.log('Certificate generated:', data.certificate);

        return data.certificate || null;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to generate certificate';
        setError(errorMessage);

        toast({
          title: 'Certificate Generation Failed',
          description: errorMessage,
          variant: 'destructive',
        });

        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    []
  );

  const getCertificates = useCallback(async (donorAddress: string) => {
    try {
      const response = await fetch(`/api/certificates?address=${donorAddress}`);
      const data = await response.json();

      if (response.ok && data.success) {
        return data.certificates || [];
      }

      return [];
    } catch (err) {
      console.error('Failed to fetch certificates:', err);
      return [];
    }
  }, []);

  return {
    generateCertificate,
    getCertificates,
    isGenerating,
    certificate,
    error,
  };
}
