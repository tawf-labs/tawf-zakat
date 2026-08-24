'use client';

import { AlertCircle, CheckCircle2, Lock } from 'lucide-react';
import { getAllocationProgress, formatAllocationPercentage } from '@/lib/campaign-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { LockAllocationButton } from '@/components/shared/lock-allocation-button';

interface AllocationProgressProps {
  totalBps: number;
  allocationLocked: boolean;
  campaignId: string;
  campaignName: string;
  onLockSuccess?: () => void;
}

/**
 * Allocation progress indicator component
 * Shows allocation percentage and lock/unlock status for admin dashboard
 */
export function AllocationProgress({
  totalBps,
  allocationLocked,
  campaignId,
  campaignName,
  onLockSuccess,
}: AllocationProgressProps) {
  const progress = getAllocationProgress(totalBps);
  const percentage = formatAllocationPercentage(totalBps);
  const isComplete = totalBps >= 10000;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Allocation Progress</span>
        <span className="text-sm text-muted-foreground">
          {percentage}% / 100%
        </span>
      </div>

      <Progress value={progress} className="h-2" />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {!isComplete ? (
            <>
              <AlertCircle className="h-3 w-3 text-yellow-500" />
              <span>{100 - parseInt(percentage)}% remaining</span>
            </>
          ) : allocationLocked ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              <span>Allocation locked</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3 w-3 text-blue-500" />
              <span>Ready to lock</span>
            </>
          )}
        </div>

        {isComplete && !allocationLocked && (
          <LockAllocationButton
            campaignId={campaignId}
            campaignName={campaignName}
            onSuccess={onLockSuccess}
            variant="default"
            className="h-7 text-xs"
          />
        )}
      </div>

      {!isComplete && (
        <Alert className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Set allocations to 100% before locking
          </AlertDescription>
        </Alert>
      )}

      {isComplete && !allocationLocked && (
        <Alert className="border-blue-200 bg-blue-50 text-blue-800">
          <Lock className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Action required:</strong> Lock allocation to enable donations
          </AlertDescription>
        </Alert>
      )}

      {isComplete && allocationLocked && (
        <Alert className="border-green-200 bg-green-50 text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Allocation locked. Campaign is ready to accept donations.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
