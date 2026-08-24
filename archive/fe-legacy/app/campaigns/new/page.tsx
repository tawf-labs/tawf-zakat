'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, CheckCircle2, Loader2, X, AlertCircle,
  ArrowLeft, Plus, Trash2, Lock
} from 'lucide-react';
import { useCreateCampaign } from '@/hooks/useCreateCampaign';
import { useAccount } from 'wagmi';
import { toast } from '@/components/ui/use-toast';
import { keccak256, stringToBytes } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useIsVerifiedOrganizer } from '@/hooks/useOrganizerApplication';

export default function CreateCampaignPage() {
  const [isClientReady, setIsClientReady] = useState(false)

  useEffect(() => {
    setIsClientReady(true)
  }, [])

  if (!isClientReady) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-white to-secondary/20 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return <CreateCampaignInner />
}

// Helper function to generate campaign ID from name
const generateCampaignId = (name: string): string => {
  if (!name.trim()) return '';
  const hash = keccak256(stringToBytes(name.trim()));
  return hash;
};

// Helper to format date for input[type="datetime-local"]
const dateToLocalString = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  return date.toISOString().slice(0, 16); // Returns "YYYY-MM-DDTHH:mm"
};

// Helper to convert local datetime string to Unix timestamp
const localStringToTimestamp = (localString: string): number => {
  const date = new Date(localString);
  return Math.floor(date.getTime() / 1000);
};

function CreateCampaignInner() {
  const router = useRouter();
  const { address: userAddress, isConnected } = useAccount();
  const { isVerified } = useIsVerifiedOrganizer(userAddress);
  const { 
    createCampaign, 
    isLoading,
    currentStep,
    uploadProgress
  } = useCreateCampaign();
  
  const [step, setStep] = useState(1);
  const [createdCampaign, setCreatedCampaign] = useState<any>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [milestones, setMilestones] = useState<{ description: string; targetAmount: string }[]>([]);
  
  // Redirect if not verified organizer
  if (isConnected && !isVerified) {
    return (
      <div className="min-h-screen bg-accent flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-border rounded-lg shadow-sm p-8 text-center space-y-4">
          <AlertCircle className="h-16 w-16 text-blue-600 mx-auto" />
          <h2 className="text-2xl font-bold">Become an Organizer</h2>
          <p className="text-muted-foreground">You need to be verified as an organizer to create campaigns.</p>
          <Button onClick={() => router.push('/organizer')}>Go to Organizer Dashboard</Button>
        </div>
      </div>
    );
  }
  
  // Initialize start and end times
  const now = Math.floor(Date.now() / 1000);
  const defaultEndTime = now + (30 * 24 * 60 * 60); // 30 days from now
  
  const [campaignData, setCampaignData] = useState({
    name: '',
    description: '',
    category: 'Emergency',
    location: '',
    goal: '',
    organizationName: '',
    organizationVerified: false,
    tags: [] as string[],
    startTime: now,
    endTime: defaultEndTime
  });

  const categories = ['Emergency', 'Education', 'Healthcare', 'Environment', 'Community'];

  // Image handlers
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const newFiles = Array.from(files);
      
      if (imageFiles.length + newFiles.length > 5) {
        toast({ 
          title: 'Too Many Images', 
          description: 'Maximum 5 images allowed', 
          variant: 'destructive' 
        });
        return;
      }

      const invalidFiles = newFiles.filter(f => f.size > 5 * 1024 * 1024);
      if (invalidFiles.length > 0) {
        toast({ 
          title: 'File Too Large', 
          description: 'Each image must be less than 5MB', 
          variant: 'destructive' 
        });
        return;
      }
      
      const newPreviews = newFiles.map(file => URL.createObjectURL(file));
      setImageFiles(prev => [...prev, ...newFiles]);
      setImagePreviewUrls(prev => [...prev, ...newPreviews]);
    }
  };

  const removeImage = (idx: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== idx));
    URL.revokeObjectURL(imagePreviewUrls[idx]);
    setImagePreviewUrls(prev => prev.filter((_, i) => i !== idx));
  };

  // Milestone handlers
  const addMilestone = () => {
    setMilestones(prev => [...prev, { description: '', targetAmount: '' }]);
  };

  const updateMilestone = (index: number, field: 'description' | 'targetAmount', value: string) => {
    setMilestones(prev => prev.map((m, i) => 
      i === index ? { ...m, [field]: value } : m
    ));
  };

  const removeMilestone = (index: number) => {
    setMilestones(prev => prev.filter((_, i) => i !== index));
  };

  const getMilestonesTotal = (): number => {
    return milestones.reduce((sum, m) => {
      const amount = parseFloat(m.targetAmount) || 0;
      return sum + amount;
    }, 0);
  };

  // Validation
  const validateForm = (): boolean => {
    if (!campaignData.name.trim() || campaignData.name.length < 10) {
      toast({ title: 'Error', description: 'Campaign name must be at least 10 characters', variant: 'destructive' });
      return false;
    }
    if (!campaignData.description.trim() || campaignData.description.length < 50) {
      toast({ title: 'Error', description: 'Description must be at least 50 characters', variant: 'destructive' });
      return false;
    }
    if (!campaignData.location.trim()) {
      toast({ title: 'Error', description: 'Location is required', variant: 'destructive' });
      return false;
    }

    const goal = parseFloat(campaignData.goal);
    if (!campaignData.goal || isNaN(goal) || goal < 1000) {
      toast({ title: 'Error', description: 'Minimum funding goal is 1,000 IDRX', variant: 'destructive' });
      return false;
    }

    if (!campaignData.organizationName.trim()) {
      toast({ title: 'Error', description: 'Organization name is required', variant: 'destructive' });
      return false;
    }

    if (!campaignData.startTime || campaignData.startTime <= 0) {
      toast({ title: 'Error', description: 'Start time is required', variant: 'destructive' });
      return false;
    }

    if (!campaignData.endTime || campaignData.endTime <= campaignData.startTime) {
      toast({ title: 'Error', description: 'End time must be after start time', variant: 'destructive' });
      return false;
    }

    if (imageFiles.length === 0) {
      toast({ title: 'Error', description: 'At least one image is required', variant: 'destructive' });
      return false;
    }

    // Validate milestones if any are added
    if (milestones.length > 0) {
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        if (!m.description.trim()) {
          toast({ title: 'Error', description: `Milestone ${i + 1} requires a description`, variant: 'destructive' });
          return false;
        }
        const amount = parseFloat(m.targetAmount);
        if (isNaN(amount) || amount <= 0) {
          toast({ title: 'Error', description: `Milestone ${i + 1} requires a valid amount`, variant: 'destructive' });
          return false;
        }
      }

      const total = getMilestonesTotal();
      const goal = parseFloat(campaignData.goal);
      if (total > goal) {
        toast({ 
          title: 'Error', 
          description: `Milestones total (${total.toLocaleString()} IDRX) exceeds funding goal (${goal.toLocaleString()} IDRX)`, 
          variant: 'destructive' 
        });
        return false;
      }
    }

    return true;
  };

  // Submit
  const handleSubmit = async () => {
    if (!isConnected || !userAddress) {
      toast({ title: 'Not Connected', description: 'Please connect your wallet first', variant: 'destructive' });
      return;
    }

    if (!validateForm()) {
      return;
    }

    setStep(2);

    try {
      // Auto-generate campaign ID from name
      const generatedCampaignId = generateCampaignId(campaignData.name);

      const result = await createCampaign({
        campaignId: generatedCampaignId,
        title: campaignData.name,
        description: campaignData.description,
        category: campaignData.category,
        location: campaignData.location,
        goal: parseFloat(campaignData.goal),
        organizationName: campaignData.organizationName,
        organizationVerified: campaignData.organizationVerified,
        imageFiles: imageFiles,
        tags: campaignData.tags,
        startTime: campaignData.startTime,
        endTime: campaignData.endTime,
        milestones: milestones.map(m => ({
          description: m.description,
          targetAmount: parseFloat(m.targetAmount) || 0
        })),
      });

      if (result) {
        const createdData = {
          campaignTitle: campaignData.name,
          campaignDescription: campaignData.description,
          chainCampaignId: generatedCampaignId,
          chainStartTime: campaignData.startTime,
          chainEndTime: campaignData.endTime,
          txHash: result.txHash,
        };
        setCreatedCampaign(createdData);
        setStep(3);
      } else {
        setStep(1);
      }
    } catch (error) {
      console.error('❌ Error creating campaign:', error);
      toast({ title: 'Error', description: String(error), variant: 'destructive' });
      setStep(1);
    }
  };

  // Reset
  const resetForm = () => {
    const now = Math.floor(Date.now() / 1000);
    const defaultEndTime = now + (30 * 24 * 60 * 60);
    
    setStep(1);
    setCreatedCampaign(null);
    setCampaignData({
      name: '',
      description: '',
      category: 'Emergency',
      location: '',
      goal: '',
      organizationName: '',
      organizationVerified: false,
      tags: [],
      startTime: now,
      endTime: defaultEndTime
    });
    setImageFiles([]);
    imagePreviewUrls.forEach(url => URL.revokeObjectURL(url));
    setImagePreviewUrls([]);
    setMilestones([]);
  };

  // Loading/Success Screen
  if (step > 1) {
    return (
      <div className="min-h-screen bg-accent flex items-center justify-center p-4">
        <div className="max-w-2xl w-full bg-white border border-border rounded-2xl shadow-lg p-8">
          <div className="text-center space-y-6">
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/30 mx-auto">
              {step === 3 ? (
                <CheckCircle2 className="h-10 w-10 text-white" />
              ) : (
                <Loader2 className="h-10 w-10 text-white animate-spin" />
              )}
            </div>

            <div className="space-y-2">
              <h2 className="text-3xl font-bold">
                {step === 2 && 'Creating Campaign...'}
                {step === 3 && 'Campaign Created Successfully!'}
              </h2>
              <p className="text-muted-foreground text-lg">
                {step === 2 && (currentStep || 'Processing...')}
                {step === 3 && 'Your campaign proposal is now live on the blockchain'}
              </p>
            </div>

            {step === 2 && (
              <div className="space-y-2">
                <div className="w-full bg-secondary rounded-full h-3">
                  <div
                    className="bg-primary h-3 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{currentStep}</span>
                  <span>{uploadProgress}%</span>
                </div>
              </div>
            )}

            {step === 3 && createdCampaign && (
              <div className="space-y-3 text-left">
                {/* Success Message */}
                <div className="flex items-start gap-4 p-5 rounded-xl border-2 border-green-500 bg-green-50">
                  <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-lg mb-1 text-green-900">
                      Campaign Proposal Submitted
                    </div>
                    <p className="text-sm text-green-800 mb-2">
                      Your campaign proposal has been successfully submitted to the blockchain. It will be available for community voting.
                    </p>
                    <p className="text-xs text-green-700 font-semibold">
                      Status: Proposal Submitted
                    </p>
                  </div>
                </div>

                {/* Campaign Details */}
                <div className="flex items-start gap-4 p-5 rounded-xl border border-gray-200 bg-gray-50">
                  <Lock className="h-5 w-5 text-gray-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-base mb-3 text-gray-900">
                      Campaign Details
                    </div>
                    <div className="space-y-2 text-xs text-gray-700">
                      <p><strong>Campaign Name:</strong> {createdCampaign.campaignTitle}</p>
                      <p><strong>Campaign ID:</strong> <span className="font-mono break-all">{createdCampaign.chainCampaignId.slice(0, 12)}...{createdCampaign.chainCampaignId.slice(-12)}</span></p>
                      <p><strong>Start Time:</strong> {new Date(createdCampaign.chainStartTime * 1000).toLocaleString()}</p>
                      <p><strong>End Time:</strong> {new Date(createdCampaign.chainEndTime * 1000).toLocaleString()}</p>
                      <p><strong>Tx Hash:</strong> <span className="font-mono break-all text-blue-600">{createdCampaign.txHash?.slice(0, 12)}...{createdCampaign.txHash?.slice(-12)}</span></p>
                    </div>
                  </div>
                </div>

                {/* Next Steps */}
                <div className="flex items-start gap-4 p-5 rounded-xl border border-amber-200 bg-amber-50">
                  <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-base mb-2 text-amber-900">
                      Next Steps
                    </div>
                    <ul className="text-xs text-amber-800 space-y-1 list-disc list-inside">
                      <li>Your proposal is now visible on the Governance page</li>
                      <li>Share your proposal to get community votes</li>
                      <li>Once approved, a fundraising pool will be created</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="pt-6 space-y-3">
                <Button
                  onClick={() => window.location.href = '/campaigns'}
                  className="w-full"
                  size="lg"
                >
                  View All Campaigns
                </Button>
                <Button
                  onClick={resetForm}
                  variant="outline"
                  className="w-full"
                  size="lg"
                >
                  Create Another Campaign
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Main Form
  return (
    <div className="min-h-screen bg-accent py-12 px-4">
      <div className="container mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-2">Create a Campaign</h1>
          <p className="text-muted-foreground">
            Set up a new fundraising campaign with transparent, blockchain-verified tracking
          </p>
        </div>

        {/* Connection Status */}
        {!isConnected && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900">Wallet Not Connected</p>
              <p className="text-sm text-amber-800 mt-1">
                Please connect your wallet to create campaigns.
              </p>
            </div>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white border border-border rounded-lg shadow-sm p-8">
          <div className="space-y-6">
            {/* Campaign Name */}
            <div>
              <Label htmlFor="name">Campaign Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="e.g., Emergency Relief for Flood Victims"
                value={campaignData.name}
                onChange={(e) => setCampaignData({ ...campaignData, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">Minimum 10 characters • This identifies your campaign</p>
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Provide details about your campaign, who it helps, and why it matters..."
                value={campaignData.description}
                onChange={(e) => setCampaignData({ ...campaignData, description: e.target.value })}
                rows={4}
              />
              <p className="text-xs text-muted-foreground mt-1">Minimum 50 characters</p>
            </div>

            {/* Two-column grid for category and location */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Category */}
              <div>
                <Label htmlFor="category">Category</Label>
                <Select
                  value={campaignData.category}
                  onValueChange={(value) => setCampaignData({ ...campaignData, category: value })}
                >
                  <SelectTrigger id="category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Location */}
              <div>
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  type="text"
                  placeholder="e.g., Jakarta, Indonesia"
                  value={campaignData.location}
                  onChange={(e) => setCampaignData({ ...campaignData, location: e.target.value })}
                />
              </div>
            </div>

            {/* Funding Goal */}
            <div>
              <Label htmlFor="goal">Funding Goal (IDRX)</Label>
              <Input
                id="goal"
                type="number"
                placeholder="e.g., 10000"
                value={campaignData.goal}
                onChange={(e) => setCampaignData({ ...campaignData, goal: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">Minimum 1,000 IDRX</p>
            </div>

            {/* Milestones */}
            <div className="bg-secondary/30 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold">Milestones (Optional)</p>
                  <p className="text-xs text-muted-foreground">Define funding milestones for staged fund release with community oversight</p>
                </div>
                <Button
                  type="button"
                  onClick={addMilestone}
                  variant="ghost"
                  size="sm"
                  className="text-primary hover:text-primary/80"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Milestone
                </Button>
              </div>

              {milestones.length > 0 && (
                <div className="space-y-3">
                  {milestones.map((milestone, index) => (
                    <div key={index} className="bg-white p-4 rounded-lg border border-border">
                      <div className="flex items-start justify-between mb-3">
                        <span className="text-sm font-medium text-muted-foreground">Milestone {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeMilestone(index)}
                          className="text-red-500 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor={`milestone-desc-${index}`} className="text-xs">Description</Label>
                          <Input
                            id={`milestone-desc-${index}`}
                            type="text"
                            placeholder="e.g., Complete initial relief distribution"
                            value={milestone.description}
                            onChange={(e) => updateMilestone(index, 'description', e.target.value)}
                            className="text-sm"
                          />
                        </div>
                        <div>
                          <Label htmlFor={`milestone-amount-${index}`} className="text-xs">Target Amount (IDRX)</Label>
                          <Input
                            id={`milestone-amount-${index}`}
                            type="number"
                            placeholder="e.g., 2500"
                            value={milestone.targetAmount}
                            onChange={(e) => updateMilestone(index, 'targetAmount', e.target.value)}
                            className="text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Milestone Summary */}
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-sm font-medium">Total Milestones Amount:</span>
                    <span className={`text-sm font-semibold ${
                      campaignData.goal && getMilestonesTotal() > parseFloat(campaignData.goal)
                        ? 'text-red-500'
                        : 'text-green-600'
                    }`}>
                      {getMilestonesTotal().toLocaleString()} IDRX
                      {campaignData.goal && (
                        <span className="text-muted-foreground font-normal">
                          {' '}/ {parseFloat(campaignData.goal).toLocaleString()} IDRX goal
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )}

              {milestones.length === 0 && (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  No milestones added. Click "Add Milestone" to define staged fund releases.
                </div>
              )}
            </div>

            {/* Organization Info */}
            <div>
              <Label htmlFor="orgName">Organization Name</Label>
              <Input
                id="orgName"
                type="text"
                placeholder="Your organization or nonprofit name"
                value={campaignData.organizationName}
                onChange={(e) => setCampaignData({ ...campaignData, organizationName: e.target.value })}
              />
            </div>

            {/* Verified Checkbox */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="verified"
                checked={campaignData.organizationVerified}
                onCheckedChange={(checked) => setCampaignData({ ...campaignData, organizationVerified: checked === true })}
              />
              <Label htmlFor="verified" className="cursor-pointer">
                My organization is verified
              </Label>
            </div>

            {/* Campaign Duration */}
            <div className="bg-secondary/30 p-4 rounded-lg">
              <p className="text-sm font-semibold mb-4">Campaign Duration</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Start Date */}
                <div>
                  <Label htmlFor="startDate">Start Date & Time</Label>
                  <Input
                    id="startDate"
                    type="datetime-local"
                    value={dateToLocalString(campaignData.startTime)}
                    onChange={(e) => setCampaignData({ ...campaignData, startTime: localStringToTimestamp(e.target.value) })}
                  />
                </div>

                {/* End Date */}
                <div>
                  <Label htmlFor="endDate">End Date & Time</Label>
                  <Input
                    id="endDate"
                    type="datetime-local"
                    value={dateToLocalString(campaignData.endTime)}
                    onChange={(e) => setCampaignData({ ...campaignData, endTime: localStringToTimestamp(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            {/* Campaign Images */}
            <div>
              <label className="block text-sm font-semibold mb-2">Campaign Images</label>
              <div className="border-2 border-dashed border-input rounded-lg p-8 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  id="image-input"
                />
                <label htmlFor="image-input" className="cursor-pointer block">
                  <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="font-semibold text-sm">Click to upload images</p>
                  <p className="text-xs text-muted-foreground">Max 5 images, 5MB each</p>
                </label>
              </div>

              {/* Image Previews */}
              {imagePreviewUrls.length > 0 && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
                  {imagePreviewUrls.map((url, idx) => (
                    <div key={idx} className="relative group">
                      <img src={url} alt={`Preview ${idx}`} className="w-full h-20 object-cover rounded-lg" />
                      <button
                        onClick={() => removeImage(idx)}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tags */}
            <div>
              <Label htmlFor="tags">Tags (Optional)</Label>
              <Input
                id="tags"
                type="text"
                placeholder="e.g., relief, emergency, disaster (comma-separated)"
                value={campaignData.tags.join(', ')}
                onChange={(e) => setCampaignData({
                  ...campaignData,
                  tags: e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag)
                })}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                onClick={() => window.history.back()}
                disabled={isLoading}
                variant="outline"
                className="flex-1"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!isConnected || isLoading}
                className="flex-1"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating campaign...
                  </>
                ) : (
                  "Create Campaign"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}