"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Vote, Users, Clock, CheckCircle2, Shield, Plus, ThumbsUp, ThumbsDown, Loader2, AlertCircle, BookOpen } from "lucide-react"
import { useProposals, useProposalCount } from "@/hooks/useProposals"
import { useVoting } from "@/hooks/useVoting"
import { useVotingPower } from "@/hooks/useVotingPower"
import { useAccount, useReadContracts } from "wagmi"
import { handleWalletError } from "@/lib/errors"
import { useToast } from "@/hooks/use-toast"
import { ProposalStatus, CampaignType, VoteSupport } from "@/lib/types"
import { CONTRACT_ADDRESSES, VotingManagerABI } from "@/lib/abi"
import { useLanguage } from "@/components/providers/language-provider"

export default function GovernancePage() {
  const { t } = useLanguage()
  const { toast } = useToast()
  const { address, isConnected } = useAccount()
  const [activeLayer, setActiveLayer] = useState<"community" | "sharia">("community")

  // Get real voting power from blockchain
  const { votingPower, formattedVotingPower, isLoading: isLoadingVotingPower } = useVotingPower()

  // Get proposal count first
  const { proposalCount, isLoading: isLoadingCount } = useProposalCount()

  // Voting hook - call BEFORE calculating proposalIds to maintain consistent hook order
  const { castVote, finalizeCommunityVote, submitForCommunityVote, isLoading: isVoting } = useVoting()

  // Memoize proposalIds to ensure stable array for useProposals
  const proposalIds = useMemo(() => {
    const proposalCountNum = proposalCount ? Number(proposalCount) : 0
    return proposalCountNum > 0 ? Array.from({ length: Math.min(proposalCountNum, 10) }, (_, i) => i + 1) : [0, 1, 2, 3]
  }, [proposalCount])


  // Get all proposals
  const { proposals: blockchainProposals, isLoading: isLoadingProposals, refetch: refetchProposals } = useProposals(proposalIds)

  // Fetch hasVoted status for each proposal from VotingManager
  const hasVotedContracts = proposalIds.map((id) => ({
    address: CONTRACT_ADDRESSES.VotingManager,
    abi: VotingManagerABI,
    functionName: "hasVoted" as const,
    args: [BigInt(id), address || "0x0000000000000000000000000000000000000000"] as const,
  }))

  const { data: hasVotedData, refetch: refetchHasVoted } = useReadContracts({
    contracts: hasVotedContracts,
    query: {
      staleTime: 10_000,
      gcTime: 60_000,
      enabled: proposalIds.length > 0 && !!address,
    },
  })

  // Map hasVoted data to proposal IDs
  const hasVoted = useMemo(() => {
    const votedMap: Record<string, boolean> = {}
    if (hasVotedData) {
      proposalIds.forEach((id, index) => {
        const result = hasVotedData[index]
        votedMap[id.toString()] = result?.status === "success" ? (result.result as boolean) : false
      })
    }
    return votedMap
  }, [hasVotedData, proposalIds])

  console.log(blockchainProposals)

  const handleVote = async (proposalId: string, voteType: "for" | "against" | "abstain") => {
    if (!isConnected) {
      const msg = handleWalletError(new Error("not-connected"));
      toast({
        title: "Wallet Error",
        description: msg,
        variant: "destructive",
      });
      return
    }

    const support = voteType === "for" ? VoteSupport.For : voteType === "against" ? VoteSupport.Against : VoteSupport.Abstain

    const result = await castVote(BigInt(proposalId), support)
    if (result) {
      await refetchHasVoted()
      await refetchProposals()
    }
  }

  const handleFinalize = async (proposalId: string) => {
    if (!isConnected) {
      const msg = handleWalletError(new Error("not-connected"));
      toast({
        title: "Wallet Error",
        description: msg,
        variant: "destructive",
      });
      return
    }

    await finalizeCommunityVote(BigInt(proposalId))
    await refetchProposals()
  }

  const handleSubmitForVote = async (proposalId: string) => {
    if (!isConnected) {
      const msg = handleWalletError(new Error("not-connected"));
      toast({
        title: "Wallet Error",
        description: msg,
        variant: "destructive",
      });
      return
    }

    const result = await submitForCommunityVote(BigInt(proposalId))

    if (result?.txHash) {
      await refetchProposals()
    }
  }

  const userVotingPower = Number(votingPower || BigInt(0))
  const isLoading = isLoadingVotingPower || isLoadingProposals || isLoadingCount

  // Map blockchain proposals to UI format
  const proposals = blockchainProposals.map((p) => {
    const totalVotes = BigInt(p.votesFor) + BigInt(p.votesAgainst) + BigInt(p.votesAbstain)
    const now = BigInt(Math.floor(Date.now() / 1000))
    const startTime = BigInt(p.createdAtRaw)
    const endTime = BigInt(p.createdAtRaw) + BigInt(7 * 24 * 60 * 60) // 7 days from creation

    const isActive = p.status === ProposalStatus.CommunityVote && now >= startTime && now <= endTime
    const isPending = p.status === ProposalStatus.CommunityPassed
    const isCompleted = p.status === ProposalStatus.Completed || p.status === ProposalStatus.PoolCreated
    const isRejected = p.status === ProposalStatus.CommunityRejected || p.status === ProposalStatus.ShariaRejected

    const daysLeft = endTime > now ? Number((endTime - now) / BigInt(86400)) : 0

    const votesFor = Number(p.votesFor)
    const votesAgainst = Number(p.votesAgainst)
    const votesAbstain = Number(p.votesAbstain)
    const totalVotesNum = votesFor + votesAgainst + votesAbstain
    const percentage = totalVotesNum > 0 ? (votesFor / totalVotesNum) * 100 : 0

    return {
      id: p.id,
      title: p.title,
      description: p.description,
      status: isActive ? "Active" : isPending ? "Pending Review" : isCompleted ? "Approved" : isRejected ? "Rejected" : "Draft",
      statusEnum: p.status,
      type: p.campaignType === CampaignType.ZakatCompliant ? "Sharia Council" : "Community",
      campaignType: p.campaignType,
      votesFor,
      votesAgainst,
      votesAbstain,
      totalVotes: totalVotesNum,
      quorum: 2000, // This should come from contract
      percentage,
      endsIn: isActive ? `${daysLeft} days` : isCompleted ? "Passed" : isPending ? "Awaiting Council" : "Draft",
      createdBy: p.organizer ? `${p.organizer.slice(0, 6)}...${p.organizer.slice(-4)}` : "Unknown",
      isEmergency: false,
      isShariaApproved: p.status === ProposalStatus.ShariaApproved || p.status === ProposalStatus.PoolCreated,
      canSubmitForVote: p.status === ProposalStatus.Draft,
      canFinalize: p.status === ProposalStatus.CommunityVote && now >= endTime,
    }
  })

  // Filter proposals for each layer
  const communityProposals = proposals.filter(p =>
    p.statusEnum === ProposalStatus.CommunityVote ||
    p.statusEnum === ProposalStatus.Draft ||
    p.statusEnum === ProposalStatus.CommunityPassed ||
    p.statusEnum === ProposalStatus.CommunityRejected
  )

  const shariaProposals = proposals.filter(p =>
    p.campaignType === CampaignType.ZakatCompliant &&
    (p.statusEnum === ProposalStatus.CommunityPassed ||
     p.statusEnum === ProposalStatus.ShariaReview ||
     p.statusEnum === ProposalStatus.ShariaApproved ||
     p.statusEnum === ProposalStatus.ShariaRejected)
  )

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Main Content */}
      <main className="flex-1 p-6 lg:p-8 overflow-y-auto bg-white">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('governance.title')}</h1>
            <p className="text-black">{t('governance.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button className="bg-white text-black shadow-md border border-black hover:bg-gray-50">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('governance.newProposal')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>{t('governance.createProposal.title')}</DialogTitle>
                  <DialogDescription>
                    {t('governance.createProposal.description')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">{t('governance.createProposal.titleLabel')}</Label>
                    <Input id="title" placeholder={t('governance.createProposal.titlePlaceholder')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">{t('governance.createProposal.descriptionLabel')}</Label>
                    <Textarea id="description" placeholder={t('governance.createProposal.descriptionPlaceholder')} rows={6} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fundingGoal">{t('governance.createProposal.fundingGoalLabel')}</Label>
                    <Input id="fundingGoal" type="number" placeholder={t('governance.createProposal.fundingGoalPlaceholder')} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('governance.createProposal.votingPowerLabel')}</Label>
                    <div className="text-2xl font-bold text-black">{userVotingPower}</div>
                  </div>
                  <Button className="w-full">{t('governance.createProposal.submit')}</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-black p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-black">{t('governance.stats.votingPower')}</div>
              <Vote className="h-4 w-4 text-gray-600" />
            </div>
            <div className="text-2xl font-bold">
              {isLoadingVotingPower ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                formattedVotingPower
              )}
            </div>
            <div className="text-xs text-black mt-1">{t('governance.stats.fromDonations')}</div>
          </div>

          <div className="bg-white rounded-xl border border-black p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-black">{t('governance.stats.activeProposals')}</div>
              <Clock className="h-4 w-4 text-gray-600" />
            </div>
            <div className="text-2xl font-bold">{proposals.filter((p) => p.status === "Active").length}</div>
            <div className="text-xs text-black mt-1">{t('governance.stats.openForVoting')}</div>
          </div>

          <div className="bg-white rounded-xl border border-black p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-black">{t('governance.stats.totalVoters')}</div>
              <Users className="h-4 w-4 text-gray-600" />
            </div>
            <div className="text-2xl font-bold">3,421</div>
            <div className="text-xs text-black mt-1">{t('governance.stats.vzktHolders')}</div>
          </div>

          <div className="bg-white rounded-xl border border-black p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-black">{t('governance.stats.proposalsPassed')}</div>
              <CheckCircle2 className="h-4 w-4 text-gray-600" />
            </div>
            <div className="text-2xl font-bold">{proposals.filter((p) => p.status === "Approved").length}</div>
            <div className="text-xs text-black mt-1">{t('governance.stats.allTime')}</div>
          </div>
        </div>

        {/* DAO Structure Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="bg-gray-100/50 rounded-xl border border-black shadow-sm">
            <div className="p-6 border-b border-black">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-black" />
                <h2 className="font-semibold">{t('governance.layer1.title')}</h2>
              </div>
              <p className="text-sm text-black mt-1">{t('governance.layer1.description')}</p>
            </div>
            <div className="p-6 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>{t('governance.layer1.voteOnProposals')}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>{t('governance.layer1.approveFunding')}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>{t('governance.layer1.platformGovernance')}</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-100/50 rounded-xl border border-black shadow-sm">
            <div className="p-6 border-b border-black">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-black" />
                <h2 className="font-semibold">{t('governance.layer2.title')}</h2>
              </div>
              <p className="text-sm text-black mt-1">{t('governance.layer2.description')}</p>
            </div>
            <div className="p-6 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>{t('governance.layer2.reviewProposals')}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>{t('governance.layer2.ensureCompliance')}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>{t('governance.layer2.protectDonors')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dual-Layer Proposals Section */}
        <div className="bg-white rounded-xl border border-black shadow-sm">
          <div className="p-6 border-b border-black">
            <h2 className="font-semibold">{t('governance.proposals.title')}</h2>
            <p className="text-sm text-black mt-1">{t('governance.proposals.subtitle')}</p>
          </div>

          <Tabs value={activeLayer} onValueChange={(v) => setActiveLayer(v as "community" | "sharia")} className="p-6">
            <TabsList className="mb-6 grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="community" className="gap-2">
                <Users className="h-4 w-4" />
                {t('governance.tabs.community')}
              </TabsTrigger>
              <TabsTrigger value="sharia" className="gap-2">
                <Shield className="h-4 w-4" />
                {t('governance.tabs.sharia')}
              </TabsTrigger>
            </TabsList>

            {/* Community DAO Tab */}
            <TabsContent value="community" className="space-y-4 mt-0">
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-2">{t('governance.community.title')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('governance.community.description')}
                </p>
              </div>

              {communityProposals.length === 0 && !isLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{t('governance.community.empty')}</p>
                </div>
              ) : (
                communityProposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    hasVoted={hasVoted[proposal.id]}
                    onVote={(voteType) => handleVote(proposal.id, voteType)}
                    onFinalize={() => handleFinalize(proposal.id)}
                    onSubmitForVote={() => handleSubmitForVote(proposal.id)}
                    isLoading={isVoting}
                  />
                ))
              )}
            </TabsContent>

            {/* Sharia Council Tab */}
            <TabsContent value="sharia" className="space-y-4 mt-0">
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-2">{t('governance.sharia.title')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('governance.sharia.description')}
                </p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <BookOpen className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-amber-900">{t('governance.sharia.accessTitle')}</h4>
                    <p className="text-sm text-amber-800 mt-1">
                      {t('governance.sharia.accessDescription')}
                    </p>
                  </div>
                </div>
              </div>

              {shariaProposals.length === 0 && !isLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{t('governance.sharia.empty')}</p>
                </div>
              ) : (
                shariaProposals.map((proposal) => (
                  <ShariaReviewCard
                    key={proposal.id}
                    proposal={proposal}
                    isLoading={isVoting}
                  />
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}

// Proposal Card Component for Community Voting
function ProposalCard({
  proposal,
  hasVoted,
  onVote,
  onFinalize,
  onSubmitForVote,
  isLoading,
}: {
  proposal: any
  hasVoted?: boolean
  onVote: (voteType: "for" | "against" | "abstain") => void
  onFinalize: () => void
  onSubmitForVote: () => void
  isLoading: boolean
}) {
  const { t } = useLanguage()
  const quorumPercentage = proposal.totalVotes > 0 ? (proposal.totalVotes / proposal.quorum) * 100 : 0

  return (
    <div className={`border rounded-lg p-6 hover:shadow-md transition-shadow ${
      proposal.status === "Active" ? "border-black bg-white" :
      proposal.status === "Pending Review" ? "border-yellow-300 bg-yellow-50" :
      proposal.status === "Approved" ? "border-green-300 bg-green-50" :
      proposal.status === "Rejected" ? "border-red-300 bg-red-50" :
      "border-gray-300 bg-gray-50"
    }`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${
              proposal.status === "Active" ? "bg-green-100 text-green-700 border-green-300" :
              proposal.status === "Pending Review" ? "bg-yellow-100 text-yellow-700 border-yellow-300" :
              proposal.status === "Approved" ? "bg-green-100 text-green-700 border-green-300" :
              proposal.status === "Rejected" ? "bg-red-100 text-red-700 border-red-300" :
              "bg-gray-100 text-gray-700 border-gray-300"
            }`}>
              {t(proposal.status === "Active" ? "governance.status.active" : proposal.status === "Pending Review" ? "governance.status.pendingReview" : proposal.status === "Approved" ? "governance.status.approved" : proposal.status === "Rejected" ? "governance.status.rejected" : "governance.status.draft")}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border border-black">
              {proposal.type}
            </span>
            {proposal.isShariaApproved && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border border-black gap-1">
                <Shield className="h-3 w-3" />
                {t('governance.badge.shariaCompliant')}
              </span>
            )}
          </div>
          <h3 className="text-lg font-bold mb-2">{proposal.title}</h3>
          <p className="text-sm text-gray-700 line-clamp-2">{proposal.description}</p>
        </div>
      </div>

      {/* Voting Stats */}
      {proposal.status !== "Draft" && (
        <>
          <div className="space-y-3 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{t('governance.votes.total')}</span>
              <span className="font-medium">
                {proposal.totalVotes.toLocaleString()} / {proposal.quorum.toLocaleString()} ({t('governance.votes.quorum')})
              </span>
            </div>
            <Progress value={Math.min(quorumPercentage, 100)} className="h-2" />

            <div className="grid grid-cols-3 gap-4 pt-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-green-600 font-medium flex items-center gap-1">
                    <ThumbsUp className="h-3 w-3" /> {t('governance.votes.for')}
                  </span>
                  <span className="font-bold">{proposal.votesFor.toLocaleString()}</span>
                </div>
                <Progress value={proposal.percentage} className="h-1.5 [&>div]:bg-green-600" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-red-600 font-medium flex items-center gap-1">
                    <ThumbsDown className="h-3 w-3" /> {t('governance.votes.against')}
                  </span>
                  <span className="font-bold">{proposal.votesAgainst.toLocaleString()}</span>
                </div>
                <Progress value={proposal.totalVotes > 0 ? (proposal.votesAgainst / proposal.totalVotes) * 100 : 0} className="h-1.5 [&>div]:bg-red-600" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 font-medium">{t('governance.votes.abstain')}</span>
                  <span className="font-bold">{proposal.votesAbstain.toLocaleString()}</span>
                </div>
                <Progress value={proposal.totalVotes > 0 ? (proposal.votesAbstain / proposal.totalVotes) * 100 : 0} className="h-1.5 [&>div]:bg-gray-400" />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <div className="text-sm text-gray-600">
          <Clock className="inline h-3 w-3 mr-1" />
          {proposal.endsIn}
        </div>
        <div className="flex gap-2">
          {/* Draft - Submit for Vote */}
          {proposal.canSubmitForVote && (
            <Button
              size="sm"
              onClick={onSubmitForVote}
              disabled={isLoading}
            >
              {t('governance.action.submitForVote')}
            </Button>
          )}

          {/* Active - Vote Buttons (only show if not voted) */}
          {proposal.status === "Active" && !hasVoted && (
            <>
              <Button
                size="sm"
                variant="default"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => onVote("for")}
                disabled={isLoading}
              >
                <ThumbsUp className="h-3 w-3 mr-1" />
                {t('governance.action.voteFor')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => onVote("against")}
                disabled={isLoading}
              >
                <ThumbsDown className="h-3 w-3 mr-1" />
                {t('governance.action.against')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onVote("abstain")}
                disabled={isLoading}
              >
                {t('governance.action.abstain')}
              </Button>
            </>
          )}

          {/* Show "Voted" badge if user has already voted */}
          {proposal.status === "Active" && hasVoted && (
            <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-green-100 border border-green-600 text-green-700 gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {t('governance.action.voted')}
            </span>
          )}

          {/* Can Finalize */}
          {proposal.canFinalize && (
            <Button
              size="sm"
              variant="outline"
              onClick={onFinalize}
              disabled={isLoading}
            >
              {t('governance.action.finalize')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// Sharia Review Card Component
function ShariaReviewCard({
  proposal,
  isLoading,
}: {
  proposal: any
  isLoading: boolean
}) {
  const { t } = useLanguage()

  return (
    <div className="border border-amber-300 rounded-lg p-6 hover:shadow-md transition-shadow bg-amber-50">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border border-amber-600 bg-amber-100 text-amber-700">
              {t('governance.shariaBadge.pendingReview')}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border border-black">
              {t('governance.shariaBadge.zakatCompliant')}
            </span>
          </div>
          <h3 className="text-lg font-bold mb-2">{proposal.title}</h3>
          <p className="text-sm text-gray-700 line-clamp-2">{proposal.description}</p>
        </div>
      </div>

      {/* Voting Stats - Read Only */}
      <div className="space-y-3 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">{t('governance.shariaCard.communityResult')}</span>
          <span className="font-medium text-green-600">{t('governance.shariaCard.passed')}</span>
        </div>
        <div className="grid grid-cols-3 gap-4 pt-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-green-600 font-medium flex items-center gap-1">
                <ThumbsUp className="h-3 w-3" /> {t('governance.votes.for')}
              </span>
              <span className="font-bold">{proposal.votesFor.toLocaleString()}</span>
            </div>
            <Progress value={proposal.percentage} className="h-1.5 [&>div]:bg-green-600" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-red-600 font-medium flex items-center gap-1">
                <ThumbsDown className="h-3 w-3" /> {t('governance.votes.against')}
              </span>
              <span className="font-bold">{proposal.votesAgainst.toLocaleString()}</span>
            </div>
            <Progress value={proposal.totalVotes > 0 ? (proposal.votesAgainst / proposal.totalVotes) * 100 : 0} className="h-1.5 [&>div]:bg-red-600" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 font-medium">{t('governance.votes.abstain')}</span>
              <span className="font-bold">{proposal.votesAbstain.toLocaleString()}</span>
            </div>
            <Progress value={proposal.totalVotes > 0 ? (proposal.votesAbstain / proposal.totalVotes) * 100 : 0} className="h-1.5 [&>div]:bg-gray-400" />
          </div>
        </div>
      </div>

      {/* Sharia Review Action Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-amber-200">
        <div className="text-sm text-gray-600">
          <Shield className="inline h-3 w-3 mr-1" />
          {t('governance.shariaCard.requiresApproval')}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            className="bg-green-600 hover:bg-green-700 text-white"
            disabled={isLoading}
          >
            <ThumbsUp className="h-3 w-3 mr-1" />
            {t('governance.shariaCard.approve')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="bg-red-600 hover:bg-red-700 text-white"
            disabled={isLoading}
          >
            <ThumbsDown className="h-3 w-3 mr-1" />
            {t('governance.shariaCard.reject')}
          </Button>
        </div>
      </div>
    </div>
  )
}
