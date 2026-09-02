/**
 * Campaign Lifecycle State Machine
 *
 * States:
 * - DRAFT: Campaign created but allocation not set
 * - ALLOCATION_PENDING: Allocations set but < 100% (10,000 bps)
 * - READY: Allocation locked, waiting for start time
 * - ACTIVE: Allocation locked and within time window (accepting donations)
 * - CLOSED: Campaign ended or manually closed
 */

import type { CampaignPool } from './types';

export enum CampaignStatus {
  DRAFT = 'draft',
  ALLOCATION_PENDING = 'allocation_pending',
  READY = 'ready',
  ACTIVE = 'active',
  CLOSED = 'closed',
}

export interface CampaignStatusInfo {
  status: CampaignStatus;
  label: string;
  description: string;
  color: 'gray' | 'yellow' | 'blue' | 'green' | 'red';
  canDonate: boolean;
  icon: string;
}

/**
 * Calculate campaign status based on contract state
 */
export function getCampaignStatus(
  pool: CampaignPool | null
): CampaignStatusInfo {
  // Pool doesn't exist
  if (!pool) {
    return {
      status: CampaignStatus.DRAFT,
      label: 'Draft',
      description: 'Campaign not yet created on-chain',
      color: 'gray',
      canDonate: false,
      icon: '📝',
    };
  }

  // Pool is not active
  if (!pool.isActive) {
    return {
      status: CampaignStatus.CLOSED,
      label: 'Closed',
      description: 'Campaign is not accepting donations',
      color: 'gray',
      canDonate: false,
      icon: '🔒',
    };
  }

  // Active and accepting donations
  return {
    status: CampaignStatus.ACTIVE,
    label: 'Active',
    description: 'Accepting donations',
    color: 'green',
    canDonate: true,
    icon: '💚',
  };
}

/**
 * Get status badge styles
 */
export function getStatusBadgeStyles(color: CampaignStatusInfo['color']) {
  const styles = {
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
    yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    green: 'bg-green-100 text-green-700 border-green-200',
    red: 'bg-red-100 text-red-700 border-red-200',
  };
  return styles[color];
}

/**
 * Format allocation percentage from basis points
 */
export function formatAllocationPercentage(bps: number): string {
  return (bps / 100).toFixed(0);
}

/**
 * Calculate remaining allocation needed (in bps)
 */
export function getRemainingAllocationBps(currentBps: number): number {
  return Math.max(0, 10000 - currentBps);
}

/**
 * Check if allocation is complete (100%)
 */
export function isAllocationComplete(bps: number): boolean {
  return bps >= 10000;
}

/**
 * Get allocation progress percentage (0-100)
 */
export function getAllocationProgress(bps: number): number {
  return Math.min(100, (bps / 10000) * 100);
}
