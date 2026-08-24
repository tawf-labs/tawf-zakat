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
import { useLanguage } from "@/components/providers/language-provider"

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
  const { t } = useLanguage()
  
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
        title: t('partners.incompleteInfo'),
        description: t('partners.fillRequiredFields'),
        variant: "destructive"
      })
    }
  }

  const handleSubmit = async () => {
    if (!isConnected) {
      const msg = handleWalletError(new Error("not-connected"));
      toast({
        title: t('partners.walletError'),
        description: msg,
        variant: "destructive",
      });
      return
    }

    if (!validateStep(4)) {
      toast({
        title: t('partners.incompleteInfo'),
        description: t('partners.fillAllRequired'),
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
        title: t('partners.proposalSubmitted'),
        description: t('partners.proposalSubmittedDesc'),
      })

      // Move to success step
      setStep(5)

    } catch (error) {
      const txErrMsg = handleTransactionError(error);
      toast({
        title: t('partners.transactionError'),
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
          <h1 className="text-4xl font-bold mb-3">{t('partners.becomePartner')}</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t('partners.becomePartnerDesc')}
          </p>
        </div>

        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            {[
              { num: 1, label: t('partners.basicInfo') },
              { num: 2, label: t('partners.documents') },
              { num: 3, label: t('partners.details') },
              { num: 4, label: t('partners.proposal') },
              { num: 5, label: t('partners.submit') }
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
                <h2 className="text-2xl font-bold mb-2">{t('partners.basicInformation')}</h2>
                <p className="text-muted-foreground">{t('partners.tellAboutOrg')}</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="orgName">{t('partners.orgName')}</Label>
                  <Input
                    id="orgName"
                    placeholder={t('partners.orgNamePlaceholder')}
                    value={formData.organizationName}
                    onChange={(e) => handleInputChange("organizationName", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="legalName">{t('partners.legalName')}</Label>
                  <Input
                    id="legalName"
                    placeholder={t('partners.legalNamePlaceholder')}
                    value={formData.legalName}
                    onChange={(e) => handleInputChange("legalName", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="regNumber">{t('partners.regNumber')}</Label>
                  <Input
                    id="regNumber"
                    placeholder={t('partners.regNumberPlaceholder')}
                    value={formData.registrationNumber}
                    onChange={(e) => handleInputChange("registrationNumber", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="year">{t('partners.yearEstablished')}</Label>
                  <Input
                    id="year"
                    type="number"
                    placeholder={t('partners.yearPlaceholder')}
                    value={formData.yearEstablished}
                    onChange={(e) => handleInputChange("yearEstablished", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country">{t('partners.country')}</Label>
                  <Input
                    id="country"
                    value={formData.country}
                    onChange={(e) => handleInputChange("country", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city">{t('partners.city')}</Label>
                  <Input
                    id="city"
                    placeholder={t('partners.cityPlaceholder')}
                    value={formData.city}
                    onChange={(e) => handleInputChange("city", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">{t('partners.physicalAddress')}</Label>
                <Textarea
                  id="address"
                  placeholder={t('partners.addressPlaceholder')}
                  value={formData.address}
                  onChange={(e) => handleInputChange("address", e.target.value)}
                  rows={2}
                />
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{t('partners.emailAddress')}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t('partners.emailPlaceholder')}
                    value={formData.email}
                    onChange={(e) => handleInputChange("email", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">{t('partners.phoneNumber')}</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder={t('partners.phonePlaceholder')}
                    value={formData.phone}
                    onChange={(e) => handleInputChange("phone", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">{t('partners.website')}</Label>
                  <Input
                    id="website"
                    type="url"
                    placeholder={t('partners.websitePlaceholder')}
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
                <h2 className="text-2xl font-bold mb-2">{t('partners.kycDocuments')}</h2>
                <p className="text-muted-foreground">{t('partners.uploadDocs')}</p>
              </div>

              <div className="space-y-4">
                {[
                  { key: "registrationDocument", label: t('partners.registrationCert'), required: true },
                  { key: "taxDocument", label: t('partners.taxDocument'), required: true },
                  { key: "bankStatement", label: t('partners.bankStatement'), required: false },
                  { key: "proofOfAddress", label: t('partners.proofOfAddress'), required: false },
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
                      {t('partners.acceptedFormats')}
                    </p>
                  </div>
                ))}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <Shield className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-blue-900 mb-1">{t('partners.documentSecurity')}</p>
                  <p className="text-blue-800">
                    {t('partners.documentSecurityDesc')}
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
                <h2 className="text-2xl font-bold mb-2">{t('partners.organizationDetails')}</h2>
                <p className="text-muted-foreground">{t('partners.provideDetails')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgType">{t('partners.orgType')}</Label>
                <Select
                  value={formData.organizationType}
                  onValueChange={(value) => handleInputChange("organizationType", value)}
                >
                  <SelectTrigger id="orgType" className="w-full">
                    <SelectValue placeholder={t('partners.orgTypePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NGO">{t('partners.typeNGO')}</SelectItem>
                    <SelectItem value="Foundation">{t('partners.typeFoundation')}</SelectItem>
                    <SelectItem value="Religious">{t('partners.typeReligious')}</SelectItem>
                    <SelectItem value="Community">{t('partners.typeCommunity')}</SelectItem>
                    <SelectItem value="Healthcare">{t('partners.typeHealthcare')}</SelectItem>
                    <SelectItem value="Education">{t('partners.typeEducation')}</SelectItem>
                    <SelectItem value="Other">{t('partners.typeOther')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mission">{t('partners.missionStatement')}</Label>
                <Textarea
                  id="mission"
                  placeholder={t('partners.missionPlaceholder')}
                  value={formData.missionStatement}
                  onChange={(e) => handleInputChange("missionStatement", e.target.value)}
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pastProjects">{t('partners.pastProjects')}</Label>
                <Textarea
                  id="pastProjects"
                  placeholder={t('partners.pastProjectsPlaceholder')}
                  value={formData.pastProjects}
                  onChange={(e) => handleInputChange("pastProjects", e.target.value)}
                  rows={4}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="beneficiaries">{t('partners.totalBeneficiaries')}</Label>
                  <Input
                    id="beneficiaries"
                    type="number"
                    placeholder={t('partners.beneficiariesPlaceholder')}
                    value={formData.beneficiaryCount}
                    onChange={(e) => handleInputChange("beneficiaryCount", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="budget">{t('partners.annualBudget')}</Label>
                  <Input
                    id="budget"
                    placeholder={t('partners.budgetPlaceholder')}
                    value={formData.annualBudget}
                    onChange={(e) => handleInputChange("annualBudget", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="certifications">{t('partners.certifications')}</Label>
                <Textarea
                  id="certifications"
                  placeholder={t('partners.certificationsPlaceholder')}
                  value={formData.certifications}
                  onChange={(e) => handleInputChange("certifications", e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="board">{t('partners.boardMembers')}</Label>
                <Textarea
                  id="board"
                  placeholder={t('partners.boardMembersPlaceholder')}
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
                <h2 className="text-2xl font-bold mb-2">{t('partners.verificationProposal')}</h2>
                <p className="text-muted-foreground">
                  {t('partners.verificationProposalDesc')}
                </p>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-yellow-900 mb-1">{t('partners.twoLayerGovernance')}</p>
                  <p className="text-yellow-800">
                    {t('partners.twoLayerDesc1')}
                    <br />
                    {t('partners.twoLayerDesc2')}
                    <br />
                    {t('partners.twoLayerDesc3')}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="proposalTitle">{t('partners.proposalTitle')}</Label>
                <Input
                  id="proposalTitle"
                  placeholder={t('partners.proposalTitlePlaceholder')}
                  value={formData.proposalTitle}
                  onChange={(e) => handleInputChange("proposalTitle", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="proposalDesc">{t('partners.proposalDescription')}</Label>
                <Textarea
                  id="proposalDesc"
                  placeholder={t('partners.proposalDescriptionPlaceholder')}
                  value={formData.proposalDescription}
                  onChange={(e) => handleInputChange("proposalDescription", e.target.value)}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  {t('partners.proposalDescriptionHint')}
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">{t('partners.initialBudget')}</Label>
                  <Input
                    id="amount"
                    type="number"
                    placeholder="100000"
                    value={formData.requestedAmount}
                    onChange={(e) => handleInputChange("requestedAmount", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('partners.budgetHint')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="duration">{t('partners.votingPeriod')}</Label>
                  <Input
                    id="duration"
                    type="number"
                    value={formData.projectDuration}
                    onChange={(e) => handleInputChange("projectDuration", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('partners.votingPeriodHint')}
                  </p>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold mb-3">{t('partners.proposalSummary')}</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('partners.summaryOrganization')}</span>
                    <span className="font-medium">{formData.organizationName || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('partners.summaryType')}</span>
                    <span className="font-medium">{formData.organizationType || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('partners.summaryBeneficiaries')}</span>
                    <span className="font-medium">{formData.beneficiaryCount || "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('partners.summaryBudget')}</span>
                    <span className="font-medium">{formData.requestedAmount || "N/A"} IDRX</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('partners.summaryWallet')}</span>
                    <span className="font-mono text-xs">{address ? `${address.slice(0, 6)}...${address.slice(-4)}` : t('partners.notConnected')}</span>
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
                <h2 className="text-3xl font-bold mb-3">{t('partners.proposalSuccess')}</h2>
                <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                  {t('partners.proposalSuccessDesc')}
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 max-w-2xl mx-auto text-left">
                <h3 className="font-semibold text-blue-900 mb-3">{t('partners.whatHappensNext')}</h3>
                <ol className="space-y-3 text-sm text-blue-800">
                  <li className="flex items-start gap-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-900 font-semibold flex-shrink-0">1</span>
                    <span>{t('partners.whatNext1')}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-900 font-semibold flex-shrink-0">2</span>
                    <span>{t('partners.whatNext2')}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-900 font-semibold flex-shrink-0">3</span>
                    <span>{t('partners.whatNext3')}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-900 font-semibold flex-shrink-0">4</span>
                    <span>{t('partners.whatNext4')}</span>
                  </li>
                </ol>
              </div>

              <div className="space-y-3 pt-4">
                <Button asChild size="lg" className="w-full max-w-xs">
                  <a href="/governance">{t('partners.viewYourProposal')}</a>
                </Button>
                <div>
                  <Button asChild variant="outline" size="lg" className="w-full max-w-xs">
                    <a href="/dashboard/organization">{t('partners.goToDashboard')}</a>
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
              <h3 className="font-semibold mb-1">{t('partners.secureTransparent')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('partners.secureTransparentDesc')}
              </p>
            </Card>
            
            <Card className="p-4 bg-white/50">
              <Users className="h-8 w-8 text-primary mb-2" />
              <h3 className="font-semibold mb-1">{t('partners.communityGoverned')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('partners.communityGovernedDesc')}
              </p>
            </Card>
            
            <Card className="p-4 bg-white/50">
              <FileText className="h-8 w-8 text-primary mb-2" />
              <h3 className="font-semibold mb-1">{t('partners.shariaCompliant')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('partners.shariaCompliantDesc')}
              </p>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
