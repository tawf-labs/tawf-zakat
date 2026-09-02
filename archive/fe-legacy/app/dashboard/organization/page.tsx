'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect to the new organizer route.
 * This page is kept for backward compatibility.
 */
export default function OrganizationDashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/organizer');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Redirecting to new organizer dashboard...</p>
      </div>
    </div>
  );
}
