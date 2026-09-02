'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useCampaigns } from '@/hooks/useCampaigns';
import { useIsVerifiedOrganizer } from '@/hooks/useOrganizerApplication';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Target, Plus, Eye, AlertCircle, Loader2, ArrowRight, LayoutDashboard, FileText, Settings, Users, Wallet } from 'lucide-react';
import { CampaignType, getCampaignTypeLabel } from '@/lib/types';
import { useRouter } from 'next/navigation';

export default function OrganizerCampaignsPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { isVerified } = useIsVerifiedOrganizer(address);
  const { campaigns, isLoading, refetch } = useCampaigns();

  // Filter campaigns by organizer address
  const organizerCampaigns = campaigns.filter(
    (c) => c.organizationAddress?.toLowerCase() === address?.toLowerCase()
  );

  // Redirect if not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-accent flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="h-16 w-16 text-amber-600 mx-auto" />
            <h2 className="text-2xl font-bold">Wallet Not Connected</h2>
            <p className="text-muted-foreground">Please connect your wallet to view your campaigns.</p>
            <Button onClick={() => router.push('/')}>Connect Wallet</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show application page if connected but not verified
  if (!isVerified) {
    return (
      <div className="min-h-screen bg-accent flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="h-16 w-16 text-blue-600 mx-auto" />
            <h2 className="text-2xl font-bold">Become an Organizer</h2>
            <p className="text-muted-foreground">You need to be verified as an organizer to create and manage campaigns.</p>
            <Button onClick={() => router.push('/organizer/apply')}>Apply to Become an Organizer</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalRaised = organizerCampaigns.reduce((sum, c) => sum + c.raised, 0);
  const totalGoal = organizerCampaigns.reduce((sum, c) => sum + c.goal, 0);
  const totalDonors = organizerCampaigns.reduce((sum, c) => sum + c.donors, 0);

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Organizer Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 hidden md:block">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center text-white font-bold">
              ZK
            </div>
            <div>
              <div className="font-bold text-sm">ZKT Organizer</div>
              <div className="text-xs text-muted-foreground">Verified</div>
            </div>
          </div>

          {/* User Info */}
          <div className="mb-6 p-3 bg-secondary/30 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">Connected as</div>
            <div className="text-sm font-mono truncate">{address}</div>
          </div>

          <nav className="space-y-1">
            <Link href="/organizer" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Link>
            <Link href="/organizer/proposals" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors">
              <FileText className="h-4 w-4" />
              My Proposals
            </Link>
            <Link href="/organizer/campaigns" className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 text-primary font-medium">
              <Target className="h-4 w-4" />
              My Campaigns
            </Link>
            <Link href="/organizer/create" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors">
              <Plus className="h-4 w-4" />
              Create Proposal
            </Link>
            <Link href="/organizer/settings" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors">
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </nav>

          <div className="mt-auto pt-6 border-t border-gray-200">
            <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowRight className="h-4 w-4" />
              Back to Donor View
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">My Campaigns</h1>
              <p className="text-muted-foreground">
                Manage your active fundraising campaigns
              </p>
            </div>
            <Link href="/organizer/create">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create New Campaign
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard
              title="Active Campaigns"
              value={organizerCampaigns.filter(c => c.isActive).length.toString()}
              description="Currently fundraising"
              icon={Target}
              color="blue"
            />
            <StatCard
              title="Total Raised"
              value={`IDRX ${totalRaised.toLocaleString()}`}
              description={`of ${totalGoal.toLocaleString()} goal`}
              icon={Wallet}
              color="green"
            />
            <StatCard
              title="Total Donors"
              value={totalDonors.toString()}
              description="Unique contributors"
              icon={Users}
              color="purple"
            />
            <StatCard
              title="Completion Rate"
              value={totalGoal > 0 ? `${Math.round((totalRaised / totalGoal) * 100)}%` : '0%'}
              description="Overall progress"
              icon={Target}
              color="orange"
            />
          </div>

          {/* Campaigns List */}
          <Card>
            <CardHeader>
              <CardTitle>All Campaigns</CardTitle>
              <CardDescription>
                View and manage your active campaigns
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : organizerCampaigns.length === 0 ? (
                <div className="text-center py-12">
                  <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-semibold mb-2">No Campaigns Yet</h3>
                  <p className="text-muted-foreground mb-6">
                    Create your first proposal and get it approved to start fundraising.
                  </p>
                  <Link href="/organizer/create">
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Proposal
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {organizerCampaigns.map((campaign) => (
                    <CampaignCard key={campaign.id} campaign={campaign} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: any }) {
  const progressPercentage = campaign.goal > 0
    ? (campaign.raised / campaign.goal) * 100
    : 0;

  const getCampaignTypeBadgeVariant = (type: CampaignType) => {
    switch (type) {
      case CampaignType.ZakatCompliant:
        return 'default';
      case CampaignType.Emergency:
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="h-16 w-16 rounded-lg bg-gray-200 overflow-hidden flex-shrink-0">
            {campaign.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={campaign.imageUrl}
                alt={campaign.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center bg-gray-100">
                <Target className="h-8 w-8 text-gray-400" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={getCampaignTypeBadgeVariant(campaign.campaignType)}>
                {getCampaignTypeLabel(campaign.campaignType)}
              </Badge>
              {campaign.isActive ? (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-gray-600">
                  Inactive
                </Badge>
              )}
            </div>
            <h3 className="font-semibold text-sm mb-1 truncate">{campaign.title}</h3>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {campaign.description}
            </p>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              IDRX {campaign.raised.toLocaleString()}
            </span>
            <span className="text-muted-foreground">
              of IDRX {campaign.goal.toLocaleString()}
            </span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{progressPercentage.toFixed(0)}% funded</span>
            <span>{campaign.donors} donors</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/campaigns/${campaign.id}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              <Eye className="h-4 w-4 mr-2" />
              View Campaign
            </Button>
          </Link>
          {campaign.isActive && campaign.daysLeft > 0 && (
            <div className="text-xs text-muted-foreground text-right">
              <div>{campaign.daysLeft} days left</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  color
}: {
  title: string;
  value: string;
  description: string;
  icon: any;
  color: string;
}) {
  const colorClasses = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    purple: 'text-purple-600 bg-purple-50',
    orange: 'text-orange-600 bg-orange-50',
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <div className={`h-10 w-10 rounded-full ${colorClasses[color as keyof typeof colorClasses]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
