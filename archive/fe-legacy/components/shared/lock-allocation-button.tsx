'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { useLockAllocations } from '@/hooks/useLockAllocations';
import { Button } from '@/components/ui/button';

interface LockAllocationButtonProps {
  campaignId: string;
  campaignName: string;
  onSuccess?: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive';
  className?: string;
}

/**
 * Button to lock campaign allocations
 * Required before donations can be accepted
 * 
 * Usage:
 * ```tsx
 * <LockAllocationButton 
 *   campaignId="0x7d8b402003c09b26e55ac0a61bc8cf936a62a286490096ca7a193a3b63ae81f8"
 *   campaignName="Emergency Relief Fund"
 *   onSuccess={() => refetch()}
 * />
 * ```
 */
export function LockAllocationButton({
  campaignId,
  campaignName,
  onSuccess,
  variant = 'default',
  className = '',
}: LockAllocationButtonProps) {
  const { lockAllocations, isLoading } = useLockAllocations({
    onSuccess: () => onSuccess?.(),
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleLock = async () => {
    try {
      await lockAllocations(campaignId);
      setIsDialogOpen(false);
    } catch (error) {
      console.error('Failed to lock allocations:', error);
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsDialogOpen(true)}
        disabled={isLoading}
        variant={variant}
        size="sm"
        className={className}
      >
        <Lock className="h-4 w-4 mr-2" />
        {isLoading ? 'Locking...' : 'Lock Allocations'}
      </Button>

      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 max-w-sm shadow-lg">
            <h2 className="text-lg font-semibold mb-2">Lock Allocations?</h2>
            <p className="text-sm text-gray-600 mb-4">
              This will set allocations to 100% for <strong>{campaignName}</strong> and lock them.
              Once locked, donations can be accepted.
            </p>
            <p className="text-xs text-gray-500 mb-6">
              Campaign ID: <code className="bg-gray-100 px-2 py-1 rounded">{campaignId.slice(0, 20)}...</code>
            </p>

            <div className="flex gap-3">
              <Button
                onClick={() => setIsDialogOpen(false)}
                disabled={isLoading}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleLock}
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? 'Locking...' : 'Lock'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
