"use client";

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, CircleCheck, Share2, Heart, MapPin, Calendar, Target, TrendingUp, Shield, FileText, Loader2, AlertTriangle, Timer, ExternalLink, Vote, CheckCircle2, XCircle, MinusCircle, Sparkles } from 'lucide-react';
import { DonationDialog } from '@/components/donations/donation-dialog';
import { Button } from '@/components/ui/button';
import dynamic from 'next/dynamic';
import { useMilestones, useMilestoneActions, useHasVotedOnMilestone } from '@/hooks/useMilestones';
import { useAccount } from 'wagmi';
import { MilestoneStatus, MilestoneData, VoteSupport, getMilestoneStatusLabel, getMilestoneStatusColor } from '@/lib/types';
import { HeroImpact } from '@/components/campaigns/hero-impact';
import { ImpactCalculator } from '@/components/campaigns/impact-calculator';
import { BeneficiaryStories } from '@/components/campaigns/beneficiary-stories';
import { OrganizerMessage } from '@/components/campaigns/organizer-message';
import { JourneyTimeline } from '@/components/campaigns/journey-timeline';
import { UrgencyBanner } from '@/components/campaigns/urgency-banner';
import type { Beneficiary, OrganizerMessage as OrganizerMessageType, ImpactMetrics, ImpactCalculator as ImpactCalculatorItem, JourneyItem, UrgencyInfo } from '@/data/campaigns';
import { CONTRACT_ADDRESSES } from '@/lib/abi';
import { useLanguage } from "@/components/providers/language-provider";

const CampaignMap = dynamic(() => import('@/components/campaigns/campaign-map'), {
  loading: () => <div className="w-full h-[400px] bg-muted animate-pulse rounded-xl" />,
  ssr: false
});

interface CampaignDetailData {
  id: number;
  proposalId?: number; // On-chain proposal ID for milestone fetching
  poolId?: number; // On-chain pool ID for donations
  title: string;
  organization: {
    name: string;
    verified: boolean;
    logo: string;
  };
  category: string;
  location: string;
  raised: number;
  goal: number;
  donors: number;
  daysLeft: number;
  createdDate: string;
  image: string;
  images: string[];
  description: string;
  updates: Array<{
    date: string;
    title: string;
    content: string;
  }>;
  milestones: Array<{
    amount: number;
    label: string;
    achieved: boolean;
  }>;
  // Zakat-specific properties
  isZakat?: boolean;
  deadline?: number | null;
  timeRemaining?: string;
  poolStatus?: string;
  redistributionStatus?: 'none' | 'pending' | 'executed';
  inGracePeriod?: boolean;
  canRedistribute?: boolean;
  // NEW: Storytelling fields
  familiesHelped?: number;
  beneficiaries?: Beneficiary[];
  organizerMessage?: OrganizerMessageType;
  impactMetrics?: ImpactMetrics;
  impactCalculator?: ImpactCalculatorItem[];
  journey?: JourneyItem[];
  urgency?: UrgencyInfo;
}

export default function CampaignDetail() {
  const params = useParams();
  const campaignId = params.id as string;
  const { t } = useLanguage();

  const [campaignDetail, setCampaignDetail] = useState<CampaignDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('story');
  const [selectedImage, setSelectedImage] = useState(0);
  const [showDonationDialog, setShowDonationDialog] = useState(false);

  // Wallet connection for milestone voting
  const { address, isConnected } = useAccount();

  // Fetch on-chain milestones if proposalId is available
  const { 
    milestones: onChainMilestones, 
    isLoading: milestonesLoading, 
    refetch: refetchMilestones 
  } = useMilestones(campaignDetail?.proposalId);

  const { 
    voteMilestone, 
    isLoading: votingLoading 
  } = useMilestoneActions({
    onSuccess: () => {
      refetchMilestones();
    }
  });

  // Fetch campaign detail
  useEffect(() => {
    const fetchCampaignDetail = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(`/api/campaigns/${campaignId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch campaign: ${response.status}`);
        }

        const data = await response.json();

        if (data.success && data.campaign) {
          setCampaignDetail(data.campaign);
        } else {
          throw new Error(data.error || 'Invalid response format');
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
      } finally {
        setIsLoading(false);
      }
    };

    if (campaignId) {
      fetchCampaignDetail();
    }
  }, [campaignId]);

  const calculateProgress = (raised: number, goal: number) => {
    return (raised / goal) * 100;
  };

  const formatCurrency = (amount: number) => {
    return `${amount.toLocaleString('id-ID', { maximumFractionDigits: 0 })} IDRX`;
  };

  if (isLoading) {
    return (
      <main className="flex-1 py-8 lg:py-12 bg-background">
        <div className="container px-4 mx-auto max-w-7xl flex items-center justify-center min-h-96">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">{t('campaignDetail.loading')}</p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !campaignDetail) {
    return (
      <main className="flex-1 py-8 lg:py-12 bg-background">
        <div className="container px-4 mx-auto max-w-7xl">
          <Link href="/campaigns" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors">
            <ArrowLeft className="h-4 w-4" />
            {t('campaignDetail.backToCampaigns')}
          </Link>
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-red-500 font-semibold mb-4">{t('campaignDetail.error')}</p>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button
              onClick={() => window.location.reload()}
            >
              {t('campaignDetail.retry')}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const progress = calculateProgress(campaignDetail.raised, campaignDetail.goal);

  return (
    <main className="flex-1 py-8 lg:py-12 bg-background">
      <div className="container px-4 mx-auto max-w-7xl">
        {/* Back Button */}
        <Link href="/campaigns" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          {t('campaignDetail.backToCampaigns')}
        </Link>

        {/* NEW: Hero Impact Section */}
        {campaignDetail.beneficiaries && campaignDetail.beneficiaries.length > 0 && campaignDetail.impactMetrics && (
          <div className="mb-8">
            <HeroImpact
              beneficiaryName={campaignDetail.beneficiaries[0].name}
              beneficiaryQuote={campaignDetail.beneficiaries[0].story}
              beneficiaryPhoto={campaignDetail.beneficiaries[0].photo}
              impactMetrics={campaignDetail.impactMetrics}
              raised={campaignDetail.raised}
              goal={campaignDetail.goal}
              formatCurrency={formatCurrency}
              onDonateClick={() => setShowDonationDialog(true)}
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Image Gallery */}
            <div className="space-y-3">
              <div className="relative h-[400px] rounded-xl overflow-hidden border border-border">
                <img
                  src={campaignDetail.images[selectedImage]}
                  alt={campaignDetail.title}
                  className="w-full h-full object-cover"
                />

                {/* Category Badge */}
                <div className="absolute top-4 left-4 flex gap-2">
                  <span className="inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-semibold bg-background/90 backdrop-blur-sm border border-border">
                    {campaignDetail.category}
                  </span>
                  {campaignDetail.isZakat && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium bg-emerald-600/90 backdrop-blur-sm text-white rounded-md border border-emerald-500">
                      <Shield className="h-4 w-4" />
                      {t('campaignDetail.zakatBadge')}
                    </span>
                  )}
                </div>

                {/* Verified Badge */}
                <div className="absolute top-4 right-4">
                  <span className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium bg-background/90 backdrop-blur-sm rounded-md border border-border">
                    <CircleCheck className="h-4 w-4 text-green-600" />
                    {t('campaignDetail.verifiedCampaign')}
                  </span>
                </div>
              </div>

              {/* Image Thumbnails */}
              <div className="flex gap-3">
                {campaignDetail.images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImage(idx)}
                    className={`relative h-20 w-24 rounded-lg overflow-hidden border-2 transition-all ${selectedImage === idx ? 'border-primary' : 'border-border hover:border-primary/50'
                      }`}
                  >
                    <img
                      src={img}
                      alt={`Gallery ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Campaign Header */}
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <span>{t('campaignDetail.by')}</span>
                    <span className="text-primary font-semibold hover:underline cursor-pointer">
                      {campaignDetail.organization.name}
                    </span>
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight mb-3">
                    {campaignDetail.title}
                  </h1>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      <span>{campaignDetail.location}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>{t('campaignDetail.started')} {campaignDetail.createdDate}</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <Share2 className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <Heart className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Zakat Status Indicator */}
              {campaignDetail.isZakat && (
                <div className={`bg-card border rounded-xl p-6 ${
                  campaignDetail.inGracePeriod
                    ? 'border-yellow-500/50 bg-yellow-500/5'
                    : campaignDetail.canRedistribute
                    ? 'border-red-500/50 bg-red-500/5'
                    : campaignDetail.poolStatus === 'Completed'
                    ? 'border-green-500/50 bg-green-500/5'
                    : campaignDetail.poolStatus === 'Redistributed'
                    ? 'border-orange-500/50 bg-orange-500/5'
                    : 'border-primary/20 bg-primary/5'
                }`}>
                  <div className="flex items-start gap-3">
                    {campaignDetail.inGracePeriod ? (
                      <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                    ) : campaignDetail.canRedistribute ? (
                      <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                    ) : campaignDetail.poolStatus === 'Completed' ? (
                      <CircleCheck className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    ) : campaignDetail.poolStatus === 'Redistributed' ? (
                      <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <Timer className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-lg flex items-center gap-2">
                          {t('campaignDetail.zakatDistributionStatus')}
                          {campaignDetail.poolStatus && (
                            <span className={`text-xs px-2 py-1 rounded-md ${
                              campaignDetail.poolStatus === 'Active'
                                ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                                : campaignDetail.poolStatus === 'Grace Period'
                                ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                                : campaignDetail.poolStatus === 'Completed'
                                ? 'bg-green-500/20 text-green-700 dark:text-green-400'
                                : 'bg-orange-500/20 text-orange-700 dark:text-orange-400'
                            }`}>
                              {campaignDetail.poolStatus}
                            </span>
                          )}
                        </h4>
                        {campaignDetail.timeRemaining && (
                          <span className="text-sm font-medium text-primary">
                            {campaignDetail.timeRemaining}
                          </span>
                        )}
                      </div>

                      <div className="space-y-2 text-sm">
                        {campaignDetail.inGracePeriod ? (
                          <>
                            <p className="text-yellow-700 dark:text-yellow-400">
                              <strong>{t('campaignDetail.gracePeriodActive')}</strong> {t('campaignDetail.gracePeriodDescription')}
                            </p>
                            <p className="text-muted-foreground">
                              {t('campaignDetail.remainingGracePeriod')} {campaignDetail.timeRemaining || t('campaignDetail.checkDeadline')}
                            </p>
                          </>
                        ) : campaignDetail.canRedistribute ? (
                          <>
                            <p className="text-red-700 dark:text-red-400">
                              <strong>{t('campaignDetail.readyForRedistribution')}</strong> {t('campaignDetail.redistributionDescription')}
                            </p>
                          </>
                        ) : campaignDetail.poolStatus === 'Completed' ? (
                          <p className="text-green-700 dark:text-green-400">
                            <strong>{t('campaignDetail.successfullyCompleted')}</strong> {t('campaignDetail.completedDescription')}
                          </p>
                        ) : campaignDetail.poolStatus === 'Redistributed' ? (
                          <p className="text-orange-700 dark:text-orange-400">
                            <strong>{t('campaignDetail.redistributed')}</strong> {t('campaignDetail.redistributedDescription')}
                          </p>
                        ) : (
                          <>
                            <p className="text-foreground">
                              <strong>{t('campaignDetail.activeZakatPool')}</strong> {t('campaignDetail.activePoolDescription')}
                            </p>
                            <p className="text-muted-foreground">
                              {t('campaignDetail.timeRemainingDistribute')} <span className="font-medium text-foreground">{campaignDetail.timeRemaining || t('campaignDetail.loadingTime')}</span>
                            </p>
                          </>
                        )}
                      </div>

                      {/* Zakat Compliance Badge */}
                      <div className="mt-4 pt-4 border-t border-border/50">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Shield className="h-4 w-4" />
                          <span>
                            {t('campaignDetail.shariaCompliance')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Milestones - On-Chain Data */}
              {campaignDetail.proposalId !== undefined && onChainMilestones.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Target className="h-5 w-5" />
                      <h3 className="font-bold text-lg">{t('campaignDetail.milestones')}</h3>
                    </div>
                    <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded">
                      {onChainMilestones.filter(m => m.status === MilestoneStatus.Completed).length} / {onChainMilestones.length} {t('campaignDetail.completed')}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {onChainMilestones.map((milestone, idx) => (
                      <div key={idx} className="border border-border rounded-lg p-4 space-y-3">
                        {/* Milestone Header */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-semibold">{t('campaignDetail.milestone')} {idx + 1}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full border ${getMilestoneStatusColor(milestone.status)}`}>
                                {milestone.statusLabel}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">{milestone.description}</p>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-bold text-primary">{milestone.targetAmount} IDRX</span>
                          </div>
                        </div>

                        {/* Proof Link */}
                        {milestone.proofIPFS && (
                          <div className="flex items-center gap-2 text-sm">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <a
                              href={`https://gateway.pinata.cloud/ipfs/${milestone.proofIPFS}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline flex items-center gap-1"
                            >
                              {t('campaignDetail.viewProof')} <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}

                        {/* Voting Progress (if in voting state) */}
                        {milestone.status === MilestoneStatus.Voting && (
                          <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">{t('campaignDetail.communityVote')}</span>
                              <span className="text-muted-foreground">{t('campaignDetail.ends')} {milestone.voteEnd}</span>
                            </div>
                            <div className="flex gap-4 text-sm">
                              <div className="flex items-center gap-1">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <span className="font-semibold text-green-600">{milestone.votesFor}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <XCircle className="h-4 w-4 text-red-500" />
                                <span className="font-semibold text-red-500">{milestone.votesAgainst}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <MinusCircle className="h-4 w-4 text-gray-400" />
                                <span className="font-semibold text-gray-500">{milestone.votesAbstain}</span>
                              </div>
                            </div>

                            {/* Voting Buttons */}
                            {isConnected && milestone.isVotingActive && (
                              <div className="flex gap-2 pt-2">
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                                  onClick={() => voteMilestone(campaignDetail.proposalId!, idx, VoteSupport.For)}
                                  disabled={votingLoading}
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> {t('campaignDetail.approve')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                                  onClick={() => voteMilestone(campaignDetail.proposalId!, idx, VoteSupport.Against)}
                                  disabled={votingLoading}
                                >
                                  <XCircle className="h-3 w-3 mr-1" /> {t('campaignDetail.reject')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => voteMilestone(campaignDetail.proposalId!, idx, VoteSupport.Abstain)}
                                  disabled={votingLoading}
                                >
                                  {t('campaignDetail.abstain')}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Completed Status */}
                        {milestone.status === MilestoneStatus.Completed && (
                          <div className="flex items-center gap-2 text-sm text-green-600">
                            <CircleCheck className="h-4 w-4" />
                            <span>{t('campaignDetail.completedOn')} {milestone.releasedAt}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="border-b border-border">
              <div className="flex gap-6">
                <button
                  onClick={() => setActiveTab('story')}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'story'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {t('campaignDetail.tab.story')}
                </button>
                <button
                  onClick={() => setActiveTab('updates')}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'updates'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {t('campaignDetail.tab.updates')} ({campaignDetail.updates.length})
                </button>
                <button
                  onClick={() => setActiveTab('donors')}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'donors'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {t('campaignDetail.tab.donors')}
                </button>
                <button
                  onClick={() => setActiveTab('blockchain')}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'blockchain'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {t('campaignDetail.tab.blockchain')}
                </button>
                <button
                  onClick={() => setActiveTab('distribution')}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'distribution'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {t('campaignDetail.tab.distribution')}
                </button>
              </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'story' && (
              <div className="space-y-6 py-6">
                {/* Campaign Description */}
                <div className="prose prose-sm max-w-none">
                  <div className="whitespace-pre-line text-foreground leading-relaxed">
                    {campaignDetail.description}
                  </div>
                </div>

                {/* Beneficiary Stories */}
                {campaignDetail.beneficiaries && campaignDetail.beneficiaries.length > 0 && (
                  <BeneficiaryStories beneficiaries={campaignDetail.beneficiaries} />
                )}

                {/* Organizer Message */}
                {campaignDetail.organizerMessage && (
                  <OrganizerMessage
                    name={campaignDetail.organizerMessage.name}
                    role={campaignDetail.organizerMessage.role}
                    photo={campaignDetail.organizerMessage.photo}
                    message={campaignDetail.organizerMessage.message}
                    verified={campaignDetail.organizerMessage.verified}
                    organizationName={campaignDetail.organization.name}
                  />
                )}

                {/* Journey Timeline */}
                {campaignDetail.journey && campaignDetail.journey.length > 0 && (
                  <JourneyTimeline journey={campaignDetail.journey} />
                )}
              </div>
            )}

            {activeTab === 'updates' && (
              <div className="space-y-6">
                {campaignDetail.updates.map((update, idx) => (
                  <div key={idx} className="bg-card border border-border rounded-xl p-6">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <TrendingUp className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-lg">{update.title}</h4>
                        <p className="text-sm text-muted-foreground">{update.date}</p>
                      </div>
                    </div>
                    <p className="text-foreground leading-relaxed">{update.content}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'donors' && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground mb-2">{t('campaignDetail.recentDonors')}</p>
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary">
                          {String.fromCharCode(65 + i)}
                        </div>
                        <div>
                          <div className="font-medium">{t('campaignDetail.anonymousDonor')}</div>
                          <div className="text-sm text-muted-foreground">
                            {i === 0 ? `2 ${t('campaignDetail.minsAgo')}` : `${Math.floor(Math.random() * 24) + 1} ${t('campaignDetail.hoursAgo')}`}
                          </div>
                        </div>
                      </div>
                      <div className="font-bold text-primary">
                        {Math.floor((Math.random() * 450 + 50) * 1000).toLocaleString('id-ID')} IDRX
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'blockchain' && (
              <div className="space-y-6">
                {/* Smart Contract */}
                <div className="bg-muted/50 border border-border rounded-xl p-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      <h4 className="font-semibold">{t('campaignDetail.smartContract')}</h4>
                    </div>
                    <div className="font-mono text-xs bg-background p-3 rounded border border-border break-all">
                      {CONTRACT_ADDRESSES.ZKTCore}
                    </div>
                    <a
                      href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.ZKTCore}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <Button variant="outline" className="w-full">
                        {t('campaignDetail.viewOnBlockExplorer')}
                      </Button>
                    </a>
                  </div>
                </div>

                {/* Chain Info */}
                <div className="bg-muted/50 border border-border rounded-xl p-6">
                  <div className="space-y-3">
                    <h4 className="font-semibold text-lg">{t('campaignDetail.chainEthereumSepolia')}</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('campaignDetail.totalTransactions')}</span>
                        <span className="font-semibold">2,500</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('campaignDetail.lastUpdate')}</span>
                        <span className="font-semibold">2 mins ago</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('campaignDetail.gasUsed')}</span>
                        <span className="font-semibold">0.0045 ETH</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Transparency Note */}
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <Shield className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                      <div className="font-semibold">{t('campaignDetail.transparent100')}</div>
                      <p className="text-sm text-muted-foreground">
                        {t('campaignDetail.transparentDescription')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'distribution' && (
              <div className="space-y-6">
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <MapPin className="h-5 w-5 text-primary" />
                    <h3 className="font-bold text-lg">{t('campaignDetail.distributionLocations')}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">
                    {t('campaignDetail.distributionDescription')}
                  </p>

                  <CampaignMap
                    center={[-6.2088, 106.8456]}
                    zoom={12}
                    locations={[
                      { lat: -6.2088, lng: 106.8456, name: t('campaignDetail.mainDistributionCenter'), description: t('campaignDetail.mainDistributionDesc') },
                      { lat: -6.1751, lng: 106.8650, name: t('campaignDetail.northJakartaPost'), description: t('campaignDetail.northJakartaDesc') },
                      { lat: -6.2251, lng: 106.8000, name: t('campaignDetail.southJakartaHall'), description: t('campaignDetail.southJakartaDesc') }
                    ]}
                  />

                  <div className="mt-6 space-y-4">
                    <h4 className="font-semibold text-sm text-foreground">{t('campaignDetail.distributionActivity')}</h4>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 text-sm">
                        <div className="h-2 w-2 rounded-full bg-green-500 mt-2"></div>
                        <div>
                          <p className="font-medium">{t('campaignDetail.northJakartaPost')}</p>
                          <p className="text-muted-foreground">{t('campaignDetail.distributedFoodPackages')}</p>
                          <p className="text-xs text-muted-foreground mt-1">2 {t('campaignDetail.hoursAgo')}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 text-sm">
                        <div className="h-2 w-2 rounded-full bg-green-500 mt-2"></div>
                        <div>
                          <p className="font-medium">{t('campaignDetail.southJakartaHall')}</p>
                          <p className="text-muted-foreground">{t('campaignDetail.distributedMedicalSupplies')}</p>
                          <p className="text-xs text-muted-foreground mt-1">5 {t('campaignDetail.hoursAgo')}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Donation Sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-8">
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-xl mb-4">{t('campaignDetail.makeDonation')}</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  {t('campaignDetail.donationDescription')}
                </p>

                {/* Donate Button - Opens Dialog Directly */}
                <Button
                  onClick={() => setShowDonationDialog(true)}
                  className="w-full"
                  size="lg"
                >
                  {t('campaignDetail.donateNow')}
                </Button>

                {/* DEMO DONATION BUTTON */}
                <Button
                  variant="outline"
                  onClick={() => setShowDonationDialog(true)}
                  className="w-full mt-3 border-amber-500/40 bg-amber-50/50 hover:bg-amber-100 text-amber-900 dark:text-amber-200 font-semibold gap-2"
                >
                  <Sparkles className="h-4 w-4 text-amber-600" />
                  ⚡ Donasi Demo (Instant Test)
                </Button>
              </div>

              {/* NEW: Impact Calculator */}
              {campaignDetail.impactCalculator && campaignDetail.impactCalculator.length > 0 && (
                <div className="mt-6">
                  <ImpactCalculator
                    impactCalculator={campaignDetail.impactCalculator}
                    formatCurrency={formatCurrency}
                  />
                </div>
              )}

              {/* NEW: Urgency Banner */}
              {campaignDetail.urgency && (
                <div className="mt-6">
                  <UrgencyBanner
                    urgency={campaignDetail.urgency}
                  />
                </div>
              )}

              {/* Organization Info */}
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm mt-6">
                <h3 className="font-bold text-lg mb-4">{t('campaignDetail.aboutOrganization')}</h3>
                <div className="flex items-start gap-3 mb-4">
                  <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center font-bold text-primary">
                    {campaignDetail.organization.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="font-semibold">{campaignDetail.organization.name}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{t('campaignDetail.verifiedOrganization')}</p>
                  </div>
                </div>
                <Button variant="outline" className="w-full">
                  {t('campaignDetail.viewProfile')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Donation Dialog */}
      {campaignDetail && (
        <DonationDialog
          open={showDonationDialog}
          onOpenChange={setShowDonationDialog}
          campaignId={campaignDetail.id}
          campaignTitle={campaignDetail.title}
          campaignGoal={campaignDetail.goal}
          campaignRaised={campaignDetail.raised}
          onSuccess={() => {
            setShowDonationDialog(false);
            // User must manually refresh to see updated data
          }}
        />
      )}
    </main>
  );
}