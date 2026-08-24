import { NextRequest, NextResponse } from 'next/server';
import { campaigns as demoCampaigns, campaignStoryData } from '@/data/campaigns';
import type { Beneficiary, OrganizerMessage, ImpactMetrics, ImpactCalculator, JourneyItem, UrgencyInfo } from '@/data/campaigns';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { success: false, error: 'Invalid campaign slug' },
        { status: 400 }
      );
    }

    // Find campaign by slug from demo data
    const demo = demoCampaigns.find((d) => d.slug === slug);

    if (!demo) {
      return NextResponse.json(
        { success: false, error: 'Campaign not found' },
        { status: 404 }
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const createdAt = nowSec - (demo.daysLeft || 30) * 24 * 60 * 60; // approximate createdAt
    const endTime = nowSec + (demo.daysLeft || 30) * 24 * 60 * 60;

    // Get storytelling data if available
    const storyData = campaignStoryData[demo.id] || {
      beneficiaries: [] as Beneficiary[],
      organizerMessage: {
        name: demo.organizationName,
        role: 'Organizer',
        photo: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&crop=face',
        message: 'Thank you for your support. Your donation makes a real difference.',
        verified: demo.isVerified || false
      } as OrganizerMessage,
      impactMetrics: {
        familiesHelped: demo.familiesHelped || Math.floor(demo.raised / 500),
        peopleReached: Math.floor(demo.raised / 100),
        mealsProvided: demo.raised / 10,
        childrenSupported: Math.floor(demo.raised / 300)
      } as ImpactMetrics,
      impactCalculator: [
        { amount: 10000, impact: 'Basic support', icon: '?' },
        { amount: 50000, impact: '5x impact', icon: '?' },
        { amount: 100000, impact: '10x impact', icon: '?' }
      ] as ImpactCalculator[],
      journey: [
        {
          date: new Date(createdAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
          title: 'Campaign Started',
          description: 'Campaign launched to support those in need.',
          status: 'completed' as const
        }
      ] as JourneyItem[],
      urgency: {
        type: 'deadline',
        message: `${demo.daysLeft} days left to donate`,
        count: demo.daysLeft
      } as UrgencyInfo
    };

    // Format campaign detail
    const campaignDetail = {
      id: demo.id,
      poolId: demo.id,
      campaignIdHash: `pool-${demo.id}`,
      slug: demo.slug,
      title: demo.title,
      description: `${demo.title} - Support provided by ${demo.organizationName}.`,
      organization: {
        name: demo.organizationName,
        verified: demo.isVerified || false,
        logo: '/org-logo.jpg',
      },
      category: demo.category,
      location: demo.location || '',
      raised: demo.raised,
      goal: demo.goal,
      donors: demo.donors,
      daysLeft: demo.daysLeft,
      createdDate: new Date(createdAt * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      image: demo.image,
      images: demo.image ? [demo.image] : [],
      // Storytelling fields
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
          date: new Date(createdAt * 1000).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
          title: 'Campaign Started',
          content: `This campaign was created to help with ${demo.title}.`,
        },
      ],
      milestones: [
        {
          amount: demo.goal * 0.33,
          label: '33% of Goal - Initial Support',
          achieved: demo.raised >= demo.goal * 0.33,
        },
        {
          amount: demo.goal * 0.66,
          label: '66% of Goal - Strong Progress',
          achieved: demo.raised >= demo.goal * 0.66,
        },
        {
          amount: demo.goal,
          label: '100% of Goal - Campaign Complete',
          achieved: demo.raised >= demo.goal,
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
    console.error('Error fetching campaign by slug:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
