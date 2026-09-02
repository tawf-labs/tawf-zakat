import { NextRequest, NextResponse } from 'next/server';
import { getCampaignPool, calculateDaysLeft } from '@/lib/contract-client';
import { campaigns as demoCampaigns, campaignStoryData } from '@/data/campaigns';
import type { Beneficiary, OrganizerMessage, ImpactMetrics, ImpactCalculator, JourneyItem, UrgencyInfo } from '@/data/campaigns';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const poolId = parseInt(id, 10);

    if (isNaN(poolId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid campaign ID' },
        { status: 400 }
      );
    }

    // Fetch campaign from contract
    let campaign = null;
    try {
      campaign = await getCampaignPool(poolId);
    } catch (err) {
      console.warn('Contract fetch failed, will try demo data if available', err);
      campaign = null;
    }

    // If mocks are enabled or contract returned no campaign, try demo data
    if (!campaign || process.env.NEXT_PUBLIC_USE_MOCKS === '1') {
      const demo = demoCampaigns.find((d) => d.id === poolId);
      if (demo) {
        const nowSec = Math.floor(Date.now() / 1000);
        const createdAt = nowSec - (demo.daysLeft || 30) * 24 * 60 * 60; // approximate createdAt
        const endTime = nowSec + (demo.daysLeft || 30) * 24 * 60 * 60;

        campaign = {
          poolId: demo.id,
          title: demo.title,
          description: `${demo.title} - Support provided by ${demo.organizationName}.`,
          imageUrl: demo.image,
          imageUrls: demo.image ? [demo.image] : [],
          organizationName: demo.organizationName,
          organizationVerified: false,
          organizer: '',
          category: demo.category,
          location: demo.location || '',
          raised: demo.raised,
          goal: demo.goal,
          donors: demo.donors,
          endTime,
          createdAt,
          isActive: true,
          isVerified: false,
          campaignType: 0,
          tags: [],
          metadataURI: undefined,
        } as any;
      }
    }

    if (!campaign) {
      return NextResponse.json(
        { success: false, error: 'Campaign not found' },
        { status: 404 }
      );
    }

    // Get storytelling data if available
    const storyData = campaignStoryData[poolId] || {
      beneficiaries: [] as Beneficiary[],
      organizerMessage: {
        name: campaign.organizationName,
        role: 'Organizer',
        photo: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&crop=face',
        message: 'Thank you for your support. Your donation makes a real difference.',
        verified: campaign.organizationVerified
      } as OrganizerMessage,
      impactMetrics: {
        familiesHelped: Math.floor(campaign.raised / 500),
        peopleReached: Math.floor(campaign.raised / 100),
        mealsProvided: campaign.raised / 10,
        childrenSupported: Math.floor(campaign.raised / 300)
      } as ImpactMetrics,
      impactCalculator: [
        { amount: 10000, impact: 'Basic support', icon: 'Love' },
        { amount: 50000, impact: '5x impact', icon: 'Gift' },
        { amount: 100000, impact: '10x impact', icon: 'Heart' }
      ] as ImpactCalculator[],
      journey: [
        {
          date: new Date(campaign.createdAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
          title: 'Campaign Started',
          description: 'Campaign launched to support those in need.',
          status: 'completed' as const
        }
      ] as JourneyItem[],
      urgency: {
        type: 'deadline',
        message: `${calculateDaysLeft(campaign.endTime)} days left to donate`,
        count: calculateDaysLeft(campaign.endTime)
      } as UrgencyInfo
    };

    // Format campaign detail
    const campaignDetail = {
      id: poolId,
      campaignIdHash: `pool-${poolId}`,
      title: campaign.title,
      description: campaign.description,
      organization: {
        name: campaign.organizationName,
        verified: campaign.organizationVerified,
        logo: '/org-logo.jpg',
      },
      category: campaign.category,
      location: campaign.location,
      raised: campaign.raised,
      goal: campaign.goal,
      donors: campaign.donors,
      daysLeft: calculateDaysLeft(campaign.endTime),
      createdDate: new Date(campaign.createdAt * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      image: campaign.imageUrl,
      images: campaign.imageUrls.length > 0 ? campaign.imageUrls : [campaign.imageUrl],
      // NEW: Storytelling fields
      familiesHelped: storyData.impactMetrics.familiesHelped,
      beneficiaries: storyData.beneficiaries,
      organizerMessage: storyData.organizerMessage,
      impactMetrics: storyData.impactMetrics,
      impactCalculator: storyData.impactCalculator,
      journey: storyData.journey,
      urgency: storyData.urgency,
      // Mock updates
      updates: [
        {
          date: new Date(campaign.createdAt * 1000).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
          title: 'Campaign Started',
          content: `This campaign was created to help with ${campaign.title}.`,
        },
      ],
      milestones: [
        {
          amount: campaign.goal * 0.33,
          label: '33% of Goal - Initial Support',
          achieved: campaign.raised >= campaign.goal * 0.33,
        },
        {
          amount: campaign.goal * 0.66,
          label: '66% of Goal - Strong Progress',
          achieved: campaign.raised >= campaign.goal * 0.66,
        },
        {
          amount: campaign.goal,
          label: '100% of Goal - Campaign Complete',
          achieved: campaign.raised >= campaign.goal,
        },
      ],
    };

    return NextResponse.json(
      {
        success: true,
        campaign: campaignDetail,
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
    console.error('Error fetching campaign detail:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
