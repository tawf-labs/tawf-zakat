'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useProposalsByOrganizer } from '@/hooks/useProposals';
import { useIsVerifiedOrganizer } from '@/hooks/useOrganizerApplication';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Plus, Eye, Clock, CheckCircle2, XCircle, AlertCircle, Loader2, ArrowRight, LayoutDashboard, Target, Settings } from 'lucide-react';
import { ProposalStatus, CampaignType, getProposalStatusLabel, getProposalStatusColor, getCampaignTypeLabel } from '@/lib/types';
import { formatIDRX } from '@/lib/types';
import { useRouter } from 'next/navigation';

export default function OrganizerProposalsPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { isVerified } = useIsVerifiedOrganizer(address);
  const { proposals, isLoading, refetch } = useProposalsByOrganizer(address);

  // Redirect if not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-accent flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="h-16 w-16 text-amber-600 mx-auto" />
            <h2 className="text-2xl font-bold">Wallet Not Connected</h2>
            <p className="text-muted-foreground">Please connect your wallet to view your proposals.</p>
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
            <p className="text-muted-foreground">You need to be verified as an organizer to create and manage proposals.</p>
            <Button onClick={() => router.push('/organizer/apply')}>Apply to Become an Organizer</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusIcon = (status: ProposalStatus) => {
    switch (status) {
      case ProposalStatus.Draft:
        return <FileText className="h-4 w-4" />;
      case ProposalStatus.CommunityVote:
        return <Clock className="h-4 w-4" />;
      case ProposalStatus.CommunityPassed:
      case ProposalStatus.ShariaApproved:
        return <CheckCircle2 className="h-4 w-4" />;
      case ProposalStatus.CommunityRejected:
      case ProposalStatus.ShariaRejected:
        return <XCircle className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

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
            <Link href="/organizer/proposals" className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 text-primary font-medium">
              <FileText className="h-4 w-4" />
              My Proposals
            </Link>
            <Link href="/organizer/campaigns" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors">
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
              <h1 className="text-3xl font-bold tracking-tight mb-2">My Proposals</h1>
              <p className="text-muted-foreground">
                Manage your campaign proposals and track their progress
              </p>
            </div>
            <Link href="/organizer/create">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create New Proposal
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard
              title="Total Proposals"
              value={proposals.length.toString()}
              description="All proposals created"
              color="blue"
            />
            <StatCard
              title="Active Voting"
              value={proposals.filter(p => p.status === ProposalStatus.CommunityVote).length.toString()}
              description="In community voting"
              color="yellow"
            />
            <StatCard
              title="Approved"
              value={proposals.filter(p => p.status === ProposalStatus.ShariaApproved || p.status === ProposalStatus.PoolCreated).length.toString()}
              description="Approved proposals"
              color="green"
            />
            <StatCard
              title="Rejected"
              value={proposals.filter(p => p.status === ProposalStatus.CommunityRejected || p.status === ProposalStatus.ShariaRejected).length.toString()}
              description="Rejected proposals"
              color="red"
            />
          </div>

          {/* Proposals List */}
          <Card>
            <CardHeader>
              <CardTitle>All Proposals</CardTitle>
              <CardDescription>
                Track the status of your campaign proposals
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : proposals.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-semibold mb-2">No Proposals Yet</h3>
                  <p className="text-muted-foreground mb-6">
                    Create your first proposal to start fundraising for your cause.
                  </p>
                  <Link href="/organizer/create">
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Proposal
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {proposals.map((proposal) => (
                    <ProposalCard key={proposal.id} proposal={proposal} />
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

function ProposalCard({ proposal }: { proposal: any }) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={getProposalStatusColor(proposal.status)}>
                {getProposalStatusLabel(proposal.status)}
              </Badge>
              <Badge variant="outline">
                {getCampaignTypeLabel(proposal.campaignType)}
              </Badge>
              {proposal.isEmergency && (
                <Badge variant="destructive">Emergency</Badge>
              )}
            </div>
            <h3 className="text-lg font-semibold mb-1">{proposal.title}</h3>
            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
              {proposal.description}
            </p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">
                  {proposal.fundingGoal}
                </span>{' '}
                goal
              </div>
              {proposal.isActive && (
                <>
                  <div>•</div>
                  <div className="text-green-600">Voting Active</div>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4">
            {proposal.votesFor !== undefined && (
              <div className="text-right text-sm mr-4">
                <div className="text-green-600 font-medium">{proposal.votesFor} For</div>
                <div className="text-red-600">{proposal.votesAgainst} Against</div>
              </div>
            )}
            <Link href={`/proposals/${proposal.id}`}>
              <Button variant="outline" size="sm">
                <Eye className="h-4 w-4 mr-2" />
                View
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  title,
  value,
  description,
  color
}: {
  title: string;
  value: string;
  description: string;
  color: string;
}) {
  const colorClasses = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    yellow: 'text-yellow-600 bg-yellow-50',
    red: 'text-red-600 bg-red-50',
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
          <div className={`h-10 w-10 rounded-full ${colorClasses[color as keyof typeof colorClasses]} flex items-center justify-center`}>
            <FileText className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
