"use client"

import { useState } from "react"
import { useAccount, useWriteContract } from "wagmi"
import { Upload, Building2, FileText, Shield, CheckCircle2, AlertCircle, Loader2, Users } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { CONTRACT_ADDRESSES, ZKTCoreABI } from "@/lib/abi"
import { handleTransactionError, handleWalletError } from "@/lib/errors"

interface OrganizationFormData {
  // Basic Information
  organizationName: string
  legalName: string
  registrationNumber: string
  yearEstablished: string
  country: string
  city: string
  address: string
  
  // Contact Information
  email: string
  phone: string
  website: string
  
  // KYC Documents
  registrationDocument: File | null
  taxDocument: File | null
  bankStatement: File | null
  proofOfAddress: File | null
  
  // Organization Details
  organizationType: string
  missionStatement: string
  pastProjects: string
  beneficiaryCount: string
  annualBudget: string
  
  // Verification
  certifications: string
  boardMembers: string
  
  // Proposal Details
  proposalTitle: string
  proposalDescription: string
  requestedAmount: string
  projectDuration: string
}

export default function PartnersPage() {
  const { address, isConnected } = useAccount()
  const { toast } = useToast()
  const { writeContractAsync, isPending } = useWriteContract()
  
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const [formData, setFormData] = useState<OrganizationFormData>({
    organizationName: "",
    legalName: "",
    registrationNumber: "",
    yearEstablished: "",
    country: "Indonesia",
    city: "",
    address: "",
    email: "",
    phone: "",
    website: "",
    registrationDocument: null,
    taxDocument: null,
    bankStatement: null,
    proofOfAddress: null,
    organizationType: "",
    missionStatement: "",
    pastProjects: "",
    beneficiaryCount: "",
    annualBudget: "",
    certifications: "",
    boardMembers: "",
    proposalTitle: "",
    proposalDescription: "",
    requestedAmount: "",
    projectDuration: "30",
  })

  const handleInputChange = (field: keyof OrganizationFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleFileChange = (field: keyof OrganizationFormData, file: File | null) => {
    setFormData(prev => ({ ...prev, [field]: file }))
  }

  const validateStep = (currentStep: number): boolean => {
    switch (currentStep) {
      case 1:
        return !!(formData.organizationName && formData.legalName && formData.registrationNumber && formData.email)
      case 2:
        return !!(formData.registrationDocument && formData.taxDocument)
      case 3:
        return !!(formData.organizationType && formData.missionStatement && formData.beneficiaryCount)
      case 4:
        return !!(formData.proposalTitle && formData.proposalDescription && formData.requestedAmount)
      default:
        return true
    }
  }

  const handleNext = () => {
    if (validateStep(step)) {
      setStep(prev => prev + 1)
    } else {
      toast({
        title: "Incomplete Information",
        description: "Please fill in all required fields before proceeding.",
        variant: "destructive"
      })
    }
  }

  const handleSubmit = async () => {
    if (!isConnected) {
      const msg = handleWalletError(new Error("not-connected"));
      toast({
        title: "Wallet Error",
        description: msg,
        variant: "destructive",
      });
      return
    }

    if (!validateStep(4)) {
      toast({
        title: "Incomplete Information",
        description: "Please fill in all required fields.",
        variant: "destructive"
      })
      return
    }

    setIsSubmitting(true)

    try {
      // Create proposal title combining organization name and proposal
      const proposalTitle = `[ORG VERIFICATION] ${formData.organizationName}: ${formData.proposalTitle}`
      
      // Create detailed proposal description with all KYC information
      const proposalDescription = `
## Organization Verification Proposal

**Organization:** ${formData.organizationName}
**Legal Name:** ${formData.legalName}
**Registration Number:** ${formData.registrationNumber}
**Year Established:** ${formData.yearEstablished}
**Location:** ${formData.city}, ${formData.country}
**Type:** ${formData.organizationType}

### Contact Information
- Email: ${formData.email}
- Phone: ${formData.phone}
- Website: ${formData.website}

### Mission Statement
${formData.missionStatement}

### Track Record
${formData.pastProjects}

### Impact
- Beneficiaries Served: ${formData.beneficiaryCount}
- Annual Budget: ${formData.annualBudget}

### Certifications
${formData.certifications}

### Board Members
${formData.boardMembers}

---

## Proposed Project
${formData.proposalDescription}

**Requested Amount:** ${formData.requestedAmount} IDRX
**Project Duration:** ${formData.projectDuration} days

### Documents Submitted
- Registration Document
- Tax Document
- Bank Statement
- Proof of Address

### Verification Process
This proposal requests the community and Sharia Council to:
1. Review the organization's credentials and documentation
2. Verify compliance with Islamic charitable principles
3. Approve the organization as a verified partner
4. Enable the organization to create campaigns on the platform

**Voting Period:** ${formData.projectDuration} days
**Wallet Address:** ${address}
      `.trim()

      // Convert voting period from days to seconds
      const votingPeriodSeconds = BigInt(parseInt(formData.projectDuration) * 24 * 60 * 60)

      // Submit proposal to blockchain
      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESSES.ZKTCore,
        abi: ZKTCoreABI,
        functionName: "createProposal",
        args: [proposalTitle, proposalDescription, 0n, false, "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`, [], "", []],
      })

      toast({
        title: "Organization Verification Proposal Submitted",
        description: "Your application has been submitted for community and Sharia Council review.",
      })

      // Move to success step
      setStep(5)

    } catch (error) {
      const txErrMsg = handleTransactionError(error);
      toast({
        title: "Transaction Error",
        description: txErrMsg,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-accent py-12">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-4xl font-bold mb-3">Become a Verified Partner Organization</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Join our network of trusted charitable organizations. Complete KYC verification and submit your proposal for community approval.
          </p>
        </div>

        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            {[
              { num: 1, label: "Basic Info" },
              { num: 2, label: "Documents" },
              { num: 3, label: "Details" },
              { num: 4, label: "Proposal" },
              { num: 5, label: "Submit" }
            ].map((s, idx) => (
              <div key={s.num} className="flex items-center">
                <div className={`flex flex-col items-center ${s.num < 5 ? 'flex-1' : ''}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 font-semibold transition-all ${
                    step >= s.num 
                      ? 'bg-primary border-primary text-white' 
                      : 'bg-white border-gray-300 text-gray-400'
                  }`}>
                    {step > s.num ? <CheckCircle2 className="h-5 w-5" /> : s.num}
                  </div>
                  <span className="text-xs mt-2 font-medium">{s.label}</span>
                </div>
                {s.num < 5 && (
                  <div className={`h-0.5 w-full mx-2 -mt-5 transition-all ${
                    step > s.num ? 'bg-primary' : 'bg-gray-300'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Form Card */}
        <Card className="p-8 shadow-lg">
          {/* Step 1: Basic Information */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Basic Information</h2>
                <p className="text-muted-foreground">Tell us about your organization</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="orgName">Organization Name *</Label>
                  <Input
                    id="orgName"
                    placeholder="e.g., Baznas Indonesia"
                    value={formData.organizationName}
                    onChange={(e) => handleInputChange("organizationName", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="legalName">Legal Registered Name *</Label>
                  <Input
                    id="legalName"
                    placeholder="Official legal name"
                    value={formData.legalName}
                    onChange={(e) => handleInputChange("legalName", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="regNumber">Registration Number *</Label>
                  <Input
                    id="regNumber"
                    placeholder="Official registration number"
                    value={formData.registrationNumber}
                    onChange={(e) => handleInputChange("registrationNumber", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="year">Year Established</Label>
                  <Input
                    id="year"
                    type="number"
                    placeholder="2010"
                    value={formData.yearEstablished}
                    onChange={(e) => handleInputChange("yearEstablished", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={formData.country}
                    onChange={(e) => handleInputChange("country", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    placeholder="Jakarta"
                    value={formData.city}
                    onChange={(e) => handleInputChange("city", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Physical Address</Label>
                <Textarea
                  id="address"
                  placeholder="Complete address"
                  value={formData.address}
                  onChange={(e) => handleInputChange("address", e.target.value)}
                  rows={2}
                />
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="contact@organization.org"
                    value={formData.email}
                    onChange={(e) => handleInputChange("email", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+62 xxx xxxx xxxx"
                    value={formData.phone}
                    onChange={(e) => handleInputChange("phone", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    type="url"
                    placeholder="https://..."
                    value={formData.website}
                    onChange={(e) => handleInputChange("website", e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleNext} size="lg">
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Document Upload */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">KYC Documents</h2>
                <p className="text-muted-foreground">Upload required verification documents</p>
              </div>

              <div className="space-y-4">
                {[
                  { key: "registrationDocument", label: "Organization Registration Certificate *", required: true },
                  { key: "taxDocument", label: "Tax Registration Document *", required: true },
                  { key: "bankStatement", label: "Bank Statement (Last 3 months)", required: false },
                  { key: "proofOfAddress", label: "Proof of Address", required: false },
                ].map((doc) => (
                  <div key={doc.key} className="border border-border rounded-lg p-4 hover:border-primary/50 transition-colors">
                    <Label htmlFor={doc.key} className="block mb-2 font-semibold">
                      {doc.label}
                    </Label>
                    <div className="flex items-center gap-3">
                      <Input
                        id={doc.key}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => handleFileChange(doc.key as keyof OrganizationFormData, e.target.files?.[0] || null)}
                        className="flex-1"
                      />
                      {formData[doc.key as keyof OrganizationFormData] && (
                        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Accepted formats: PDF, JPG, PNG (Max 10MB)
                    </p>
                  </div>
                ))}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <Shield className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-blue-900 mb-1">Document Security</p>
                  <p className="text-blue-800">
                    Your documents are encrypted and stored securely. They will only be reviewed by authorized verifiers and Sharia Council members.
                  </p>
                </div>
              </div>

              <div className="flex justify-between">
                <Button onClick={() => setStep(1)} variant="outline">
                  Back
                </Button>
                <Button onClick={handleNext}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Organization Details */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Organization Details</h2>
                <p className="text-muted-foreground">Provide detailed information about your organization</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgType">Organization Type *</Label>
                <Select
                  value={formData.organizationType}
                  onValueChange={(value) => handleInputChange("organizationType", value)}
                >
                  <SelectTrigger id="orgType" className="w-full">
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NGO">Non-Governmental Organization (NGO)</SelectItem>
                    <SelectItem value="Foundation">Foundation</SelectItem>
                    <SelectItem value="Religious">Religious Organization</SelectItem>
                    <SelectItem value="Community">Community Organization</SelectItem>
                    <SelectItem value="Healthcare">Healthcare Organization</SelectItem>
                    <SelectItem value="Education">Educational Institution</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mission">Mission Statement *</Label>
                <Textarea
                  id="mission"
                  placeholder="Describe your organization's mission and values..."
                  value={formData.missionStatement}
                  onChange={(e) => handleInputChange("missionStatement", e.target.value)}
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pastProjects">Past Projects & Achievements</Label>
                <Textarea
                  id="pastProjects"
                  placeholder="Describe your major projects and achievements..."
                  value={formData.pastProjects}
                  onChange={(e) => handleInputChange("pastProjects", e.target.value)}
                  rows={4}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="beneficiaries">Total Beneficiaries Served *</Label>
                  <Input
                    id="beneficiaries"
                    type="number"
                    placeholder="e.g., 10000"
                    value={formData.beneficiaryCount}
                    onChange={(e) => handleInputChange("beneficiaryCount", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="budget">Annual Budget (IDRX)</Label>
                  <Input
                    id="budget"
                    placeholder="e.g., 1000000"
                    value={formData.annualBudget}
                    onChange={(e) => handleInputChange("annualBudget", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="certifications">Certifications & Accreditations</Label>
                <Textarea
                  id="certifications"
                  placeholder="List any relevant certifications, awards, or accreditations..."
                  value={formData.certifications}
                  onChange={(e) => handleInputChange("certifications", e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="board">Board Members / Leadership Team</Label>
                <Textarea
                  id="board"
                  placeholder="List key board members and their roles..."
                  value={formData.boardMembers}
                  onChange={(e) => handleInputChange("boardMembers", e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex justify-between">
                <Button onClick={() => setStep(2)} variant="outline">
                  Back
                </Button>
                <Button onClick={handleNext}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Verification Proposal */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Verification Proposal</h2>
                <p className="text-muted-foreground">
                  Create a proposal for the community and Sharia Council to review
                </p>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-yellow-900 mb-1">Two-Layer Governance</p>
                  <p className="text-yellow-800">
                    Your application will be reviewed by:
                    <br />
                    <strong>1. Community DAO</strong> - Donors vote based on your credentials
                    <br />
                    <strong>2. Sharia Council</strong> - Final review for Islamic compliance
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="proposalTitle">Proposal Title *</Label>
                <Input
                  id="proposalTitle"
                  placeholder="e.g., Emergency Relief Operations 2024"
                  value={formData.proposalTitle}
                  onChange={(e) => handleInputChange("proposalTitle", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="proposalDesc">Proposal Description *</Label>
                <Textarea
                  id="proposalDesc"
                  placeholder="Describe why you want to become a verified partner and what campaigns you plan to run..."
                  value={formData.proposalDescription}
                  onChange={(e) => handleInputChange("proposalDescription", e.target.value)}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  Explain your organization's goals, the campaigns you plan to create, and how you'll ensure transparency
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">Initial Campaign Budget (IDRX) *</Label>
                  <Input
                    id="amount"
                    type="number"
                    placeholder="100000"
                    value={formData.requestedAmount}
                    onChange={(e) => handleInputChange("requestedAmount", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Estimated budget for your first campaign
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="duration">Voting Period (days)</Label>
                  <Input
                    id="duration"
                    type="number"
                    value={formData.projectDuration}
                    onChange={(e) => handleInputChange("projectDuration", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    How long should voting be open?
                  </p>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold mb-3">Proposal Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Organization:</span>
                    <span className="font-medium">{formData.organizationName || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-medium">{formData.organizationType || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Beneficiaries:</span>
                    <span className="font-medium">{formData.beneficiaryCount || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Initial Budget:</span>
                    <span className="font-medium">{formData.requestedAmount || "N/A"} IDRX</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Your Wallet:</span>
                    <span className="font-mono text-xs">{address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected"}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <Button onClick={() => setStep(3)} variant="outline">
                  Back
                </Button>
                <Button 
                  onClick={handleSubmit} 
                  disabled={!isConnected || isSubmitting}
                  className="gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      Submit to Blockchain
                      <CheckCircle2 className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: Success */}
          {step === 5 && (
            <div className="text-center space-y-6 py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
              </div>
              
              <div>
                <h2 className="text-3xl font-bold mb-3">Proposal Submitted Successfully!</h2>
                <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                  Your organization verification proposal has been submitted to the blockchain and is now under community review.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 max-w-2xl mx-auto text-left">
                <h3 className="font-semibold text-blue-900 mb-3">What happens next?</h3>
                <ol className="space-y-3 text-sm text-blue-800">
                  <li className="flex items-start gap-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-900 font-semibold flex-shrink-0">1</span>
                    <span><strong>Community Voting:</strong> Donors with voting power will review your application and vote (For/Against) during the voting period.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-900 font-semibold flex-shrink-0">2</span>
                    <span><strong>Quorum Check:</strong> The proposal must reach the minimum quorum for voting to be valid.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-900 font-semibold flex-shrink-0">3</span>
                    <span><strong>Sharia Council Review:</strong> If approved by the community, the Sharia Council will conduct a final review to ensure Islamic compliance.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-900 font-semibold flex-shrink-0">4</span>
                    <span><strong>Verification:</strong> Upon approval, your organization will be verified and can start creating campaigns on the platform.</span>
                  </li>
                </ol>
              </div>

              <div className="space-y-3 pt-4">
                <Button asChild size="lg" className="w-full max-w-xs">
                  <a href="/governance">View Your Proposal</a>
                </Button>
                <div>
                  <Button asChild variant="outline" size="lg" className="w-full max-w-xs">
                    <a href="/dashboard/organization">Go to Dashboard</a>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Info Cards at Bottom */}
        {step < 5 && (
          <div className="grid md:grid-cols-3 gap-4 mt-8">
            <Card className="p-4 bg-white/50">
              <Shield className="h-8 w-8 text-primary mb-2" />
              <h3 className="font-semibold mb-1">Secure & Transparent</h3>
              <p className="text-sm text-muted-foreground">
                All verification data is stored on-chain for complete transparency
              </p>
            </Card>
            
            <Card className="p-4 bg-white/50">
              <Users className="h-8 w-8 text-primary mb-2" />
              <h3 className="font-semibold mb-1">Community Governed</h3>
              <p className="text-sm text-muted-foreground">
                Donors vote on organization approvals using their voting power
              </p>
            </Card>
            
            <Card className="p-4 bg-white/50">
              <FileText className="h-8 w-8 text-primary mb-2" />
              <h3 className="font-semibold mb-1">Sharia Compliant</h3>
              <p className="text-sm text-muted-foreground">
                Final review by Sharia Council ensures Islamic compliance
              </p>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
