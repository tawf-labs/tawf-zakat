'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useCreateProposal } from '@/hooks/useCreateProposal';
import { useIsVerifiedOrganizer } from '@/hooks/useOrganizerApplication';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, Loader2, AlertCircle, CheckCircle2, ArrowRight, LayoutDashboard, FileText, Target, Settings, Info, X, MinusCircle } from 'lucide-react';
import { CampaignType, ZakatChecklistItem, parseIDRX } from '@/lib/types';
import Link from 'next/link';

const ZAKAT_CHECKLIST_ITEMS: ZakatChecklistItem[] = [
  ZakatChecklistItem.RecipientsVerified,
  ZakatChecklistItem.FundsDistributionPlan,
  ZakatChecklistItem.CompliantWithSharia,
  ZakatChecklistItem.TransparencyCommitment,
  ZakatChecklistItem.RegularReporting,
];

const ZAKAT_CHECKLIST_LABELS: Record<ZakatChecklistItem, string> = {
  [ZakatChecklistItem.RecipientsVerified]: 'Recipients are verified as eligible Zakat recipients (mustahiq)',
  [ZakatChecklistItem.FundsDistributionPlan]: 'Clear plan for distributing funds according to Sharia principles',
  [ZakatChecklistItem.CompliantWithSharia]: 'Campaign complies with Shafi\'i madhhab Zakat distribution rules',
  [ZakatChecklistItem.TransparencyCommitment]: 'Commitment to transparent fund tracking and reporting',
  [ZakatChecklistItem.RegularReporting]: 'Regular updates on fund utilization and impact',
};

export default function OrganizerCreatePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { isVerified } = useIsVerifiedOrganizer(address);
  const { createProposal, isLoading, isConfirmed, txHash } = useCreateProposal({
    onSuccess: (proposalId, hash) => {
      router.push(`/organizer/proposals?created=true`);
    },
  });

  const [campaignType, setCampaignType] = useState<CampaignType>(CampaignType.Normal);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    fundingGoal: '',
    isEmergency: false,
    metadataURI: '',
  });

  const [selectedZakatItems, setSelectedZakatItems] = useState<ZakatChecklistItem[]>([]);
  const [milestones, setMilestones] = useState<Array<{ description: string; targetAmount: string }>>([
    { description: '', targetAmount: '' },
  ]);

  // Redirect if not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-accent flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="h-16 w-16 text-amber-600 mx-auto" />
            <h2 className="text-2xl font-bold">Wallet Not Connected</h2>
            <p className="text-muted-foreground">Please connect your wallet to create a proposal.</p>
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
            <p className="text-muted-foreground">You need to be verified as an organizer to create proposals.</p>
            <Button onClick={() => router.push('/organizer/apply')}>Apply to Become an Organizer</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleCampaignTypeChange = (type: CampaignType) => {
    setCampaignType(type);
    if (type !== CampaignType.ZakatCompliant) {
      setSelectedZakatItems([]);
    }
  };

  const toggleZakatItem = (item: ZakatChecklistItem) => {
    setSelectedZakatItems((prev) =>
      prev.includes(item)
        ? prev.filter((i) => i !== item)
        : [...prev, item]
    );
  };

  const addMilestone = () => {
    setMilestones([...milestones, { description: '', targetAmount: '' }]);
  };

  const removeMilestone = (index: number) => {
    if (milestones.length > 1) {
      setMilestones(milestones.filter((_, i) => i !== index));
    }
  };

  const updateMilestone = (index: number, field: 'description' | 'targetAmount', value: string) => {
    const updated = [...milestones];
    updated[index][field] = value;
    setMilestones(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const fundingGoalNum = parseFloat(formData.fundingGoal);
    if (isNaN(fundingGoalNum) || fundingGoalNum < 1000) {
      return;
    }

    const milestoneTotal = milestones.reduce((sum, m) => sum + (parseFloat(m.targetAmount) || 0), 0);
    if (milestoneTotal !== fundingGoalNum) {
      alert(`Milestone amounts (${milestoneTotal}) must equal funding goal (${fundingGoalNum})`);
      return;
    }

    await createProposal({
      title: formData.title,
      description: formData.description,
      fundingGoal: fundingGoalNum,
      isEmergency: formData.isEmergency,
      mockZKKYCProof: '', // Would be populated by KYC oracle
      zakatChecklistItems: selectedZakatItems.map(String),
      metadataURI: formData.metadataURI,
      milestones: milestones.map((m, i) => ({
        description: m.description || `Milestone ${i + 1}`,
        targetAmount: parseFloat(m.targetAmount) || 0,
      })),
    });
  };

  const isZakatCompliant = campaignType === CampaignType.ZakatCompliant;
  const isValid =
    formData.title.length >= 10 &&
    formData.description.length >= 50 &&
    parseFloat(formData.fundingGoal) >= 1000 &&
    (!isZakatCompliant || selectedZakatItems.length >= 3) &&
    milestones.every(m => m.description && parseFloat(m.targetAmount) > 0);

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
            <Link href="/organizer/campaigns" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors">
              <Target className="h-4 w-4" />
              My Campaigns
            </Link>
            <Link href="/organizer/create" className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 text-primary font-medium">
              <PlusCircle className="h-4 w-4" />
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
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Create New Proposal</h1>
            <p className="text-muted-foreground">
              Submit a new campaign proposal for community voting and Sharia review
            </p>
          </div>

          {/* Progress Steps */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                {[
                  { label: 'Details', num: 1 },
                  { label: 'Milestones', num: 2 },
                  { label: 'Review', num: 3 },
                ].map((step, idx) => (
                  <div key={step.label} className="flex items-center">
                    <div className="flex flex-col items-center">
                      <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                        {step.num}
                      </div>
                      <div className="text-xs mt-1">{step.label}</div>
                    </div>
                    {idx < 2 && (
                      <div className="h-0.5 w-16 bg-gray-300 mx-2" />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Campaign Type Selection */}
            <Card>
              <CardHeader>
                <CardTitle>Campaign Type</CardTitle>
                <CardDescription>
                  Select the type of campaign you want to create
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { type: CampaignType.Normal, title: 'Normal', desc: 'Standard fundraising campaign' },
                    { type: CampaignType.ZakatCompliant, title: 'Zakat Compliant', desc: 'Sharia-compliant Zakat distribution' },
                    { type: CampaignType.Emergency, title: 'Emergency', desc: 'Urgent cause requiring immediate attention' },
                  ].map((option) => (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => handleCampaignTypeChange(option.type)}
                      className={`p-4 rounded-lg border-2 text-left transition-colors ${
                        campaignType === option.type
                          ? 'border-primary bg-primary/5'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-semibold mb-1">{option.title}</div>
                      <div className="text-sm text-muted-foreground">{option.desc}</div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle>Campaign Information</CardTitle>
                <CardDescription>
                  Provide details about your campaign
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="title">Campaign Title *</Label>
                  <Input
                    id="title"
                    placeholder="e.g., Clean Water for Rural Communities"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum 10 characters
                  </p>
                </div>

                <div>
                  <Label htmlFor="description">Description *</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe your campaign, its goals, and the impact it will make..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={5}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum 50 characters
                  </p>
                </div>

                <div>
                  <Label htmlFor="fundingGoal">Funding Goal (IDRX) *</Label>
                  <Input
                    id="fundingGoal"
                    type="number"
                    placeholder="10000"
                    value={formData.fundingGoal}
                    onChange={(e) => setFormData({ ...formData, fundingGoal: e.target.value })}
                    required
                    min="1000"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum 1,000 IDRX
                  </p>
                </div>

                <div>
                  <Label htmlFor="metadataURI">Metadata URI (Optional)</Label>
                  <Input
                    id="metadataURI"
                    placeholder="ipfs://..."
                    value={formData.metadataURI}
                    onChange={(e) => setFormData({ ...formData, metadataURI: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    IPFS URI with additional documents, images, etc.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="emergency"
                    checked={formData.isEmergency}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isEmergency: !!checked })
                    }
                  />
                  <Label htmlFor="emergency" className="cursor-pointer">
                    Mark as Emergency Campaign
                  </Label>
                </div>
              </CardContent>
            </Card>

            {/* Zakat Checklist (for Zakat Compliant campaigns) */}
            {isZakatCompliant && (
              <Card className="border-primary/50 bg-primary/5">
                <CardHeader>
                  <CardTitle>Zakat Compliance Checklist</CardTitle>
                  <CardDescription>
                    Select at least 3 items to verify Zakat compliance (Shafi'i madhhab)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {ZAKAT_CHECKLIST_ITEMS.map((item) => (
                      <div key={item} className="flex items-start gap-3">
                        <Checkbox
                          id={`zakat-${item}`}
                          checked={selectedZakatItems.includes(item)}
                          onCheckedChange={() => toggleZakatItem(item)}
                        />
                        <Label htmlFor={`zakat-${item}`} className="cursor-pointer">
                          {ZAKAT_CHECKLIST_LABELS[item]}
                        </Label>
                      </div>
                    ))}
                  </div>
                  <Alert className="mt-4">
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      Zakat-compliant campaigns undergo additional Sharia review to ensure
                      funds are distributed according to Islamic principles.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            )}

            {/* Milestones */}
            <Card>
              <CardHeader>
                <CardTitle>Funding Milestones</CardTitle>
                <CardDescription>
                  Define how funds will be released. Total must equal funding goal.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {milestones.map((milestone, index) => (
                  <div key={index} className="flex gap-3 items-start p-4 border rounded-lg">
                    <div className="flex-1 space-y-3">
                      <div>
                        <Label htmlFor={`milestone-desc-${index}`}>Description *</Label>
                        <Input
                          id={`milestone-desc-${index}`}
                          placeholder={`Milestone ${index + 1} deliverables...`}
                          value={milestone.description}
                          onChange={(e) => updateMilestone(index, 'description', e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor={`milestone-amount-${index}`}>Amount (IDRX) *</Label>
                        <Input
                          id={`milestone-amount-${index}`}
                          type="number"
                          placeholder="5000"
                          value={milestone.targetAmount}
                          onChange={(e) => updateMilestone(index, 'targetAmount', e.target.value)}
                          required
                          min="0"
                        />
                      </div>
                    </div>
                    {milestones.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeMilestone(index)}
                        className="mt-6"
                      >
                        <MinusCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  onClick={addMilestone}
                  className="w-full"
                >
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Add Milestone
                </Button>

                <div className="bg-secondary/50 rounded-lg p-3">
                  <div className="flex justify-between text-sm">
                    <span>Total Milestone Amount:</span>
                    <span className="font-semibold">
                      IDRX {milestones.reduce((sum, m) => sum + (parseFloat(m.targetAmount) || 0), 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span>Funding Goal:</span>
                    <span className="font-semibold">
                      IDRX {parseFloat(formData.fundingGoal || '0').toLocaleString()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Submit */}
            <div className="flex items-center gap-4">
              <Button
                type="submit"
                disabled={!isValid || isLoading}
                className="flex-1"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Submit Proposal for Community Voting
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>

            {/* Info Alert */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                After submission, your proposal will go through community voting followed by Sharia review
                (for Zakat-compliant campaigns). Once approved, a campaign pool will be created and you can
                start fundraising.
              </AlertDescription>
            </Alert>
          </form>
        </div>
      </main>
    </div>
  );
}
