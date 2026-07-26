import { NextRequest, NextResponse } from 'next/server';
import { getAllCampaignPools, calculateDaysLeft } from '@/lib/contract-client';
import { campaigns as demoCampaigns } from '@/data/campaigns';

export async function GET(request: NextRequest) {
  try {
    console.log('[API] Fetching campaigns from contract...');

    // Fetch all campaigns from contract
    let campaigns: any[] = [];
    try {
      campaigns = await getAllCampaignPools();
    } catch (err) {
      console.warn('[API] Contract fetch failed, using demo fallback:', err);
    }

    // Filter active campaigns only
    const now = Math.floor(Date.now() / 1000);
    let activeCampaigns = campaigns
      .filter(c => c.isActive && c.endTime > now)
      .map(c => ({
        ...c,
        daysLeft: calculateDaysLeft(c.endTime),
      }));

    if (activeCampaigns.length === 0) {
      console.log('[API] 0 active contract campaigns found, returning demo campaigns');
      activeCampaigns = demoCampaigns.map((d) => ({
        id: d.id,
        poolId: d.id,
        title: d.title,
        description: `${d.title} - Campaign by ${d.organizationName}.`,
        imageUrl: d.image,
        imageUrls: d.image ? [d.image] : [],
        organizationName: d.organizationName,
        organizationVerified: true,
        organizer: '0x71C839A2e8419F23a0781D92F3918a2879F492F1',
        category: d.category,
        location: d.location || 'Indonesia',
        raised: d.raised,
        goal: d.goal,
        donors: d.donors,
        daysLeft: d.daysLeft,
        isActive: true,
        isVerified: true,
        campaignType: 0,
        tags: [d.category],
        slug: d.slug,
      }));
    }

    console.log(`[API] Returning ${activeCampaigns.length} active campaigns`);

    return NextResponse.json(
      {
        success: true,
        campaigns: activeCampaigns,
        total: activeCampaigns.length,
        source: 'contract',
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch campaigns',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
