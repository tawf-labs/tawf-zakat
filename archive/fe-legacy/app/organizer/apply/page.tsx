'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Shield, FileText, Upload, CheckCircle2, Loader2, AlertCircle, Users, Clock, Scale, Building2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrganizerApplication, useIsVerifiedOrganizer, useGetOrganizerApplication } from '@/hooks/useOrganizerApplication';
import { OrganizerApplicationStatus, KYCStatus } from '@/hooks/useOrganizerApplication';

const statusSteps = [
  { status: OrganizerApplicationStatus.Pending, label: 'Application Submitted', description: 'Your application is being reviewed', icon: FileText },
  { status: OrganizerApplicationStatus.KYCReview, label: 'KYC Review', description: 'KYC oracle is verifying your organization', icon: Shield },
  { status: OrganizerApplicationStatus.CommunityVote, label: 'Community Voting', description: 'Community is voting on your application', icon: Users },
  { status: OrganizerApplicationStatus.Approved, label: 'Approved', description: 'You can now create campaigns', icon: CheckCircle2 },
  { status: OrganizerApplicationStatus.Rejected, label: 'Rejected', description: 'Your application was rejected', icon: AlertCircle },
];

export default function OrganizerApplyPage() {
  const { address, isConnected } = useAccount();
  const { application, applicationId, isLoading: isLoadingApp } = useGetOrganizerApplication(address);
  const { isVerified } = useIsVerifiedOrganizer(address);
  const { submitApplication, isLoading: isSubmitting } = useOrganizerApplication({
    onSuccess: () => {
      // Refetch application data
      window.location.reload();
    },
  });

  const [formData, setFormData] = useState({
    organizationName: '',
    description: '',
    metadataURI: '',
  });

  const getStatusStep = (status: OrganizerApplicationStatus) => {
    return statusSteps.find(step => step.status === status);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.organizationName.trim()) {
      return;
    }

    await submitApplication({
      organizationName: formData.organizationName,
      description: formData.description,
      metadataURI: formData.metadataURI,
    });
  };

  // If already verified, show redirect to dashboard
  if (isVerified) {
    return (
      <div className="min-h-screen bg-accent flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold">Already Verified</h2>
            <p className="text-muted-foreground">Your wallet address is already a verified organizer.</p>
            <Button
              onClick={() => window.location.href = '/organizer/dashboard'}
              className="w-full"
            >
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If has a pending application, show status
  if (application && applicationId && applicationId > 0n) {
    const currentStep = getStatusStep(application.status as OrganizerApplicationStatus);

    return (
      <div className="min-h-screen bg-gradient-to-b from-white to-secondary/20 py-12 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Organizer Application</h1>
            <p className="text-muted-foreground">Track your organizer verification status</p>
          </div>

          {/* Status Timeline */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Application Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {statusSteps.map((step, idx) => {
                  const isActive = step.status === application.status;
                  const isPast = step.status < application.status;
                  const isCurrent = step.status === application.status;

                  return (
                    <div key={idx} className="flex gap-4">
                      <div className={`flex flex-col items-center ${
                        isPast ? 'text-green-600' : isCurrent ? 'text-primary' : 'text-muted-foreground'
                      }`}>
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 ${
                          isPast ? 'bg-green-600 border-green-600' : isCurrent ? 'bg-primary border-primary' : 'border-gray-300'
                        }`}>
                          {isPast ? <CheckCircle2 className="h-4 w-4" /> : <span>{idx + 1}</span>}
                        </div>
                        {idx < statusSteps.length - 1 && (
                          <div className={`h-0.5 flex-1 mt-4 ${
                            isPast ? 'bg-green-600' : 'bg-gray-300'
                          }`} />
                        )}
                      </div>
                      <div className={`flex-1 pb-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                        <div className="font-semibold">{step.label}</div>
                        <div className="text-sm">{step.description}</div>
                        {isCurrent && application.status === OrganizerApplicationStatus.CommunityVote && application.voteEnd > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Voting ends: {new Date(Number(application.voteEnd) * 1000).toLocaleString()}
                          </div>
                        )}
                        {isCurrent && application.notes && (
                          <div className="text-xs bg-secondary/50 rounded p-2 mt-2">
                            {application.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Application Details */}
          <Card>
            <CardHeader>
              <CardTitle>Application Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Application ID</Label>
                <div className="font-mono text-sm bg-secondary/50 p-2 rounded mt-1">
                  #{applicationId.toString()}
                </div>
              </div>
              <div>
                <Label>Organization Name</Label>
                <div className="font-semibold">{application.organizationName}</div>
              </div>
              <div>
                <Label>Description</Label>
                <p className="text-sm text-muted-foreground">{application.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">KYC Status:</span>
                  <div className={`font-semibold ${
                    application.kycStatus === KYCStatus.Verified
                      ? 'text-green-600'
                      : application.kycStatus === KYCStatus.Rejected
                      ? 'text-red-600'
                      : 'text-amber-600'
                  }`}>
                    {application.kycStatus === KYCStatus.NotRequired
                      ? 'Not Required'
                      : application.kycStatus === KYCStatus.Pending
                      ? 'Pending'
                      : application.kycStatus === KYCStatus.Verified
                      ? 'Verified'
                      : 'Rejected'}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Applied:</span>
                  <div className="font-semibold">
                    {new Date(Number(application.appliedAt) * 1000).toLocaleDateString()}
                  </div>
                </div>
              </div>
              {application.votesFor !== 0n || application.votesAgainst !== 0n || application.votesAbstain !== 0n && (
                <div>
                  <Label>Vote Progress</Label>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>For:</span>
                      <span className="font-semibold text-green-600">{application.votesFor.toString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Against:</span>
                      <span className="font-semibold text-red-600">{application.votesAgainst.toString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Abstain:</span>
                      <span className="font-semibold text-gray-600">{application.votesAbstain.toString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Application Form
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-secondary/20 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8 text-center">
          <Building2 className="h-12 w-12 text-primary mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-2">Become an Organizer</h1>
          <p className="text-muted-foreground">
            Apply to become a verified organizer and create Zakat-compliant campaigns on the ZKT platform
          </p>
        </div>

        {!isConnected ? (
          <Alert className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please connect your wallet to apply as an organizer.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Requirements Card */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Organizer Requirements</CardTitle>
                <CardDescription>
                  Before applying, make sure you meet the following requirements
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <span>Valid organization with clear mission and impact</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <span>Transparent financial reporting and governance</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <span>Compliance with Zakat distribution principles (Shafi'i madhhab)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <span>Commitment to regular reporting and milestone updates</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <span>KYC verification by KYC oracle (offline process)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Users className="h-5 w-5 text-purple-600 flex-shrink-0 mt-0.5" />
                    <span>Community approval vote (tiered voting)</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Application Flow */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Application Flow</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold">1</div>
                    <div>
                      <div className="font-semibold">Submit Application</div>
                      <div className="text-sm text-muted-foreground">Provide your organization details</div>
                    </div>
                  </div>
                  <div className="h-4 border-l-2 border-dashed ml-4"></div>
                  <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold">2</div>
                    <div>
                      <div className="font-semibold">KYC Review</div>
                      <div className="text-sm text-muted-foreground">KYC oracle verifies your organization (2-3 days)</div>
                    </div>
                  </div>
                  <div className="h-4 border-l-2 border-dashed ml-4"></div>
                  <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold">3</div>
                    <div>
                      <div className="font-semibold">Community Vote</div>
                      <div className="text-sm text-muted-foreground">vZKT holders vote on your application (7 days)</div>
                    </div>
                  </div>
                  <div className="h-4 border-l-2 border-dashed ml-4"></div>
                  <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded-full bg-green-600 flex items-center justify-center text-sm font-bold text-white">
                      <CheckCircle2 className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <div className="font-semibold text-green-600">Approved</div>
                      <div className="text-sm text-muted-foreground">Receive Organizer NFT and create campaigns</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Application Form */}
            <Card>
              <CardHeader>
                <CardTitle>Application Form</CardTitle>
                <CardDescription>
                  Fill in your organization details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="orgName">Organization Name *</Label>
                  <Input
                    id="orgName"
                    placeholder="e.g., Yayasan Amal Zakat Sejahtera"
                    value={formData.organizationName}
                    onChange={(e) => setFormData({ ...formData, organizationName: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description *</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe your organization's mission, history, and the communities you serve..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={4}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum 50 characters
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
                    IPFS URI with additional organization documents, website, social media, etc.
                  </p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-900">
                      <div className="font-semibold mb-1">Important Notes</div>
                      <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
                        <li>You can only submit one application per wallet address</li>
                        <li>KYC verification happens off-chain by the KYC oracle</li>
                        <li>Community voting uses tiered voting (vZKT NFT holders)</li>
                        <li>After approval, you'll receive an Organizer NFT (soulbound)</li>
                        <li>As an organizer, you can create Zakat-compliant and Normal campaigns</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting || !formData.organizationName || !formData.description}
                  className="w-full"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      Submit Application
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </form>
        )}
      </div>
    </div>
  );
}
