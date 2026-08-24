"use client";

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock, CircleCheck, Share2, Heart, MapPin, Calendar, Target, TrendingUp, Shield, FileText, Loader2, AlertTriangle, Timer, ExternalLink, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { DonationDialog } from '@/components/donations/donation-dialog';
import dynamic from 'next/dynamic';
import { useMilestones, useMilestoneActions } from '@/hooks/useMilestones';
import { useAccount } from 'wagmi';
import { MilestoneStatus, VoteSupport, getMilestoneStatusColor } from '@/lib/types';
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
  slug: string;
  proposalId?: number;
  poolId?: number;
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
  isZakat?: boolean;
  deadline?: number | null;
  timeRemaining?: string;
  poolStatus?: string;
  redistributionStatus?: 'none' | 'pending' | 'executed';
  inGracePeriod?: boolean;
  canRedistribute?: boolean;
  familiesHelped?: number;
  beneficiaries?: Beneficiary[];
  organizerMessage?: OrganizerMessageType;
  impactMetrics?: ImpactMetrics;
  impactCalculator?: ImpactCalculatorItem[];
  journey?: JourneyItem[];
  urgency?: UrgencyInfo;
}

export default function ZakatCampaignPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useLanguage();

  const [campaignDetail, setCampaignDetail] = useState<CampaignDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('story');
  const [selectedImage, setSelectedImage] = useState(0);
  const [showDonationDialog, setShowDonationDialog] = useState(false);

  const { address, isConnected } = useAccount();

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

  // Fetch campaign detail by slug
  useEffect(() => {
    const fetchCampaignDetail = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(`/api/campaigns/slug/${slug}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Campaign not found');
          }
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

    if (slug) {
      fetchCampaignDetail();
    }
  }, [slug]);

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
            <p className="text-muted-foreground">{t('zakatDetail.loading')}</p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !campaignDetail) {
    notFound();
  }

  const progress = calculateProgress(campaignDetail.raised, campaignDetail.goal);

  return (
    <main className="flex-1 py-8 lg:py-12 bg-background">
      <div className="container px-4 mx-auto max-w-7xl">
        {/* Back Button */}
        <Link href="/campaigns" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          {t('zakatDetail.backToCampaigns')}
        </Link>

        {/* Hero Impact Section */}
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
                      {t('zakatDetail.zakatBadge')}
                    </span>
                  )}
                </div>

                {/* Verified Badge */}
                <div className="absolute top-4 right-4">
                  <span className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium bg-background/90 backdrop-blur-sm rounded-md border border-border">
                    <CircleCheck className="h-4 w-4 text-green-600" />
                    {t('zakatDetail.verifiedCampaign')}
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
                    <span>{t('zakatDetail.by')}</span>
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
                      <span>{t('zakatDetail.started')} {campaignDetail.createdDate}</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button className="inline-flex items-center justify-center rounded-md border border-border bg-transparent hover:bg-accent hover:text-accent-foreground h-9 w-9">
                    <Share2 className="h-4 w-4" />
                  </button>
                  <button className="inline-flex items-center justify-center rounded-md border border-border bg-transparent hover:bg-accent hover:text-accent-foreground h-9 w-9">
                    <Heart className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Milestones - On-Chain Data */}
              {campaignDetail.proposalId !== undefined && onChainMilestones.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Target className="h-5 w-5" />
                      <h3 className="font-bold text-lg">{t('zakatDetail.milestones')}</h3>
                    </div>
                    <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded">
                      {onChainMilestones.filter(m => m.status === MilestoneStatus.Completed).length} / {onChainMilestones.length} {t('zakatDetail.completed')}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {onChainMilestones.map((milestone, idx) => (
                      <div key={idx} className="border border-border rounded-lg p-4 space-y-3">
                        {/* Milestone Header */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-semibold">{t('zakatDetail.milestone')} {idx + 1}</span>
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
                              {t('zakatDetail.viewProof')} <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}

                        {/* Voting Progress (if in voting state) */}
                        {milestone.status === MilestoneStatus.Voting && (
                          <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">{t('zakatDetail.communityVote')}</span>
                              <span className="text-muted-foreground">{t('zakatDetail.ends')} {milestone.voteEnd}</span>
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
                                <button
                                  onClick={() => voteMilestone(campaignDetail.proposalId!, idx, VoteSupport.For)}
                                  disabled={votingLoading}
                                  className="flex-1 text-xs py-2 px-3 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                >
                                  <CheckCircle2 className="h-3 w-3" /> {t('zakatDetail.approve')}
                                </button>
                                <button
                                  onClick={() => voteMilestone(campaignDetail.proposalId!, idx, VoteSupport.Against)}
                                  disabled={votingLoading}
                                  className="flex-1 text-xs py-2 px-3 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                >
                                  <XCircle className="h-3 w-3" /> {t('zakatDetail.reject')}
                                </button>
                                <button
                                  onClick={() => voteMilestone(campaignDetail.proposalId!, idx, VoteSupport.Abstain)}
                                  disabled={votingLoading}
                                  className="text-xs py-2 px-3 rounded-md border border-border hover:bg-accent disabled:opacity-50 transition-colors"
                                >
                                  {t('zakatDetail.abstain')}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Completed Status */}
                        {milestone.status === MilestoneStatus.Completed && (
                          <div className="flex items-center gap-2 text-sm text-green-600">
                            <CircleCheck className="h-4 w-4" />
                            <span>{t('zakatDetail.completedOn')} {milestone.releasedAt}</span>
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
                  {t('zakatDetail.tab.story')}
                </button>
                <button
                  onClick={() => setActiveTab('updates')}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'updates'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {t('zakatDetail.tab.updates')} ({campaignDetail.updates.length})
                </button>
                <button
                  onClick={() => setActiveTab('donors')}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'donors'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {t('zakatDetail.tab.donors')}
                </button>
                <button
                  onClick={() => setActiveTab('blockchain')}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'blockchain'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {t('zakatDetail.tab.blockchain')}
                </button>
                <button
                  onClick={() => setActiveTab('distribution')}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'distribution'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {t('zakatDetail.tab.distribution')}
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
                <p className="text-sm text-muted-foreground mb-2">{t('zakatDetail.recentDonors')}</p>
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary">
                          {String.fromCharCode(65 + i)}
                        </div>
                        <div>
                          <div className="font-medium">{t('zakatDetail.anonymousDonor')}</div>
                          <div className="text-sm text-muted-foreground">
                            {i === 0 ? `2 ${t('zakatDetail.minsAgo')}` : `${Math.floor(Math.random() * 24) + 1} ${t('zakatDetail.hoursAgo')}`}
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
                      <h4 className="font-semibold">{t('zakatDetail.smartContract')}</h4>
                    </div>
                    <div className="font-mono text-xs bg-background p-3 rounded border border-border break-all">
                      {CONTRACT_ADDRESSES.ZKTCore}
                    </div>
                    <a
                      href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.ZKTCore}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full border border-border rounded-md h-9 px-4 text-sm font-semibold hover:bg-accent transition-all leading-9 text-center"
                    >
                      {t('zakatDetail.viewOnBlockExplorer')}
                    </a>
                  </div>
                </div>

                {/* Chain Info */}
                <div className="bg-muted/50 border border-border rounded-xl p-6">
                  <div className="space-y-3">
                    <h4 className="font-semibold text-lg">{t('zakatDetail.chainEthereumSepolia')}</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('zakatDetail.totalTransactions')}</span>
                        <span className="font-semibold">2,500</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('zakatDetail.lastUpdate')}</span>
                        <span className="font-semibold">2 mins ago</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('zakatDetail.gasUsed')}</span>
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
                      <div className="font-semibold">{t('zakatDetail.transparent100')}</div>
                      <p className="text-sm text-muted-foreground">
                        {t('zakatDetail.transparentDescription')}
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
                    <h3 className="font-bold text-lg">{t('zakatDetail.distributionLocations')}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">
                    {t('zakatDetail.distributionDescription')}
                  </p>

                  <CampaignMap
                    center={[-6.2088, 106.8456]}
                    zoom={12}
                    locations={[
                      { lat: -6.2088, lng: 106.8456, name: t('zakatDetail.mainDistributionCenter'), description: t('zakatDetail.mainDistributionDesc') },
                      { lat: -6.1751, lng: 106.8650, name: t('zakatDetail.northJakartaPost'), description: t('zakatDetail.northJakartaDesc') },
                      { lat: -6.2251, lng: 106.8000, name: t('zakatDetail.southJakartaHall'), description: t('zakatDetail.southJakartaDesc') }
                    ]}
                  />

                  <div className="mt-6 space-y-4">
                    <h4 className="font-semibold text-sm text-foreground">{t('zakatDetail.distributionActivity')}</h4>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 text-sm">
                        <div className="h-2 w-2 rounded-full bg-green-500 mt-2"></div>
                        <div>
                          <p className="font-medium">{t('zakatDetail.northJakartaPost')}</p>
                          <p className="text-muted-foreground">{t('zakatDetail.distributedFoodPackages')}</p>
                          <p className="text-xs text-muted-foreground mt-1">2 {t('zakatDetail.hoursAgo')}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 text-sm">
                        <div className="h-2 w-2 rounded-full bg-green-500 mt-2"></div>
                        <div>
                          <p className="font-medium">{t('zakatDetail.southJakartaHall')}</p>
                          <p className="text-muted-foreground">{t('zakatDetail.distributedMedicalSupplies')}</p>
                          <p className="text-xs text-muted-foreground mt-1">5 {t('zakatDetail.hoursAgo')}</p>
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
                <h3 className="font-bold text-xl mb-4">{t('zakatDetail.makeDonation')}</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  {t('zakatDetail.donationDescription')}
                </p>

                {/* Donate Button - Opens Dialog Directly */}
                <button
                  onClick={() => setShowDonationDialog(true)}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 border border-transparent rounded-md h-11 px-4 text-sm font-bold transition-all shadow-sm"
                >
                  {t('zakatDetail.donateNow')}
                </button>
              </div>

              {/* Impact Calculator */}
              {campaignDetail.impactCalculator && campaignDetail.impactCalculator.length > 0 && (
                <div className="mt-6">
                  <ImpactCalculator
                    impactCalculator={campaignDetail.impactCalculator}
                    formatCurrency={formatCurrency}
                  />
                </div>
              )}

              {/* Urgency Banner */}
              {campaignDetail.urgency && (
                <div className="mt-6">
                  <UrgencyBanner
                    urgency={campaignDetail.urgency}
                  />
                </div>
              )}

              {/* Organization Info */}
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm mt-6">
                <h3 className="font-bold text-lg mb-4">{t('zakatDetail.aboutOrganization')}</h3>
                <div className="flex items-start gap-3 mb-4">
                  <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center font-bold text-primary">
                    {campaignDetail.organization.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="font-semibold">{campaignDetail.organization.name}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{t('zakatDetail.verifiedOrganization')}</p>
                  </div>
                </div>
                <button className="w-full border border-border rounded-md h-9 px-4 text-sm font-semibold hover:bg-accent transition-all">
                  {t('zakatDetail.viewProfile')}
                </button>
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
          }}
        />
      )}
    </main>
  );
}
