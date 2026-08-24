'use client';

import { type CampaignStatusInfo } from '@/lib/campaign-status';
import { getStatusBadgeStyles } from '@/lib/campaign-status';
import { Loader2 } from 'lucide-react';

interface CampaignStatusBadgeProps {
  statusInfo: CampaignStatusInfo | null;
  isLoading?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

/**
 * Campaign status badge component
 * Displays the current state of a campaign in the lifecycle
 */
export function CampaignStatusBadge({
  statusInfo,
  isLoading = false,
  size = 'md',
  showIcon = true,
  className = '',
}: CampaignStatusBadgeProps) {
  const sizeStyles = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-1.5 text-base',
  };

  if (isLoading) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border bg-gray-50 text-gray-600 ${sizeStyles[size]} ${className}`}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading
      </div>
    );
  }

  if (!statusInfo) {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border ${sizeStyles[size]} ${getStatusBadgeStyles(statusInfo.color)} ${className}`}
      title={statusInfo.description}
    >
      {showIcon && <span className="text-sm">{statusInfo.icon}</span>}
      <span className="font-medium">{statusInfo.label}</span>
    </div>
  );
}
