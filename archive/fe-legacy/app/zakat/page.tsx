"use client";

import { useState } from "react";
import { Calculator, Wallet, Heart, Users, Home, Loader2, Info, ChevronDown, Check } from "lucide-react";
import { useWallet } from "@/components/providers/web3-provider";
import { useLanguage } from "@/components/providers/language-provider";
import { formatCurrency } from "@/data/campaigns";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export default function ZakatPage() {
  const { isConnected, idrxBalance, address, donate } = useWallet();
  const { toast } = useToast();
  const { t } = useLanguage();
  // Real on-chain campaign pools. This page previously listed the static
  // @/data/campaigns array and then passed that mock `id` straight into
  // donate() as a poolId, which could route a real payment at a pool that
  // does not correspond to the campaign shown.
  const { campaigns, isLoading: isLoadingCampaigns } = useCampaigns();
  const [selectedTab, setSelectedTab] = useState("maal");
  const [zakatType, setZakatType] = useState("income");
  const [incomeType, setIncomeType] = useState("monthly");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [peopleCount, setPeopleCount] = useState("");
  const [hasDeductions, setHasDeductions] = useState(false);
  const [expenses, setExpenses] = useState("");
  
  // Dialog states
  const [showCampaignDialog, setShowCampaignDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentType, setPaymentType] = useState<"maal" | "fitrah">("maal");

  const goldPriceIDR = 85000000;
  const nisabThreshold = goldPriceIDR;
  const zakatRate = 2.5;
  const fitrahPerPerson = 50000;

  const calculateZakat = () => {
    if (!monthlyIncome || monthlyIncome.trim() === "") return 0;
    
    const income = parseFloat(monthlyIncome);
    if (isNaN(income) || income <= 0) return 0;
    
    const yearlyIncome = incomeType === "monthly" ? income * 12 : income;
    const deductedIncome = hasDeductions && expenses ? yearlyIncome - parseFloat(expenses || "0") : yearlyIncome;
    
    if (deductedIncome < nisabThreshold) return 0;
    return deductedIncome * (zakatRate / 100);
  };

  const calculatedZakat = calculateZakat();
  const totalFitrah = peopleCount ? parseFloat(peopleCount) * fitrahPerPerson : 0;

  const handlePayZakatClick = () => {
    setPaymentType("maal");
    setShowCampaignDialog(true);
  };

  const handlePayFitrahClick = () => {
    setPaymentType("fitrah");
    setShowCampaignDialog(true);
  };

  const handleCampaignSelect = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setShowCampaignDialog(false);
    setShowConfirmDialog(true);
  };

  const handleConfirmPayment = async () => {
    if (!selectedCampaign) return;
    
    try {
      setIsProcessing(true);

      const amount = paymentType === "maal" ? calculatedZakat : totalFitrah;
      
      const { txHash } = await donate({
        // poolId, not id — the on-chain pool identifier, so funds land in the
        // pool actually shown to the user.
        poolId: BigInt(selectedCampaign.poolId),
        campaignTitle: selectedCampaign.title,
        amountIDRX: BigInt(Math.floor(amount * 1e18)), // Convert to wei
      });
      
      setIsProcessing(false);
      setShowConfirmDialog(false);
      
      toast({
        title: t("toast.success"),
        description: `${t("toast.zakatPaid")} ${selectedCampaign.title}. ${t("toast.txHash")}: ${txHash.slice(0, 10)}...${txHash.slice(-8)}`,
      });
      
      // Reset form
      if (paymentType === "maal") {
        setMonthlyIncome("");
      } else {
        setPeopleCount("");
      }
      setSelectedCampaign(null);
    } catch (error: any) {
      setIsProcessing(false);
      toast({
        variant: "destructive",
        title: t("toast.error"),
        description: error?.message || t("toast.paymentFailed"),
      });
    }
  };

  return (
    <div className="min-h-screen bg-accent py-12 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8 sm:mb-12">
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight mb-2 sm:mb-3">{t("zakat.title")}</h1>
          <p className="text-muted-foreground text-sm sm:text-lg">{t("zakat.subtitle")}</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {/* Wallet Balance Card */}
            {isConnected && (
              <Card className="mb-6 bg-primary border-primary/20 shadow-lg shadow-primary/20 text-white before:pointer-events-none before:fixed before:inset-0 before:z-[1]">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Wallet className="h-5 w-5" />
                      <h3 className="text-lg font-semibold">{t("zakat.walletBalance")}</h3>
                    </div>
                    <code className="text-[10px] sm:text-sm font-mono bg-white/20 px-2 sm:px-3 py-1 rounded-full truncate max-w-[100px] sm:max-w-none">
                      {address ? `${address.slice(0, 4)}...${address.slice(-4)}` : ''}
                    </code>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold">{idrxBalance ? Number(idrxBalance / BigInt(1e18)).toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '0'}</span>
                    <span className="text-white/90 font-medium">IDRX</span>
                  </div>
                  <p className="text-sm text-white/90 mt-1">Available for Zakat payment</p>
                </CardContent>
              </Card>
            )}

            {/* Nisab Information Card */}
            <Card className="mb-6">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">Nisab Threshold (Testnet)</CardTitle>
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 gap-2 text-primary hover:text-primary">
                    <Loader2 className="h-3.5 w-3.5" />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  <div className="text-center p-3 sm:p-4 bg-accent rounded-xl border border-border">
                    <div className="text-xs text-muted-foreground mb-1">Gold Equivalent</div>
                    <div className="text-lg font-bold text-primary">85 gr</div>
                    <span className="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold bg-primary/10 text-primary mt-1">
                      Testnet
                    </span>
                  </div>

                  <div className="text-center p-3 sm:p-4 bg-accent rounded-xl border border-border">
                    <div className="text-xs text-muted-foreground mb-1">Nisab (85g Gold)</div>
                    <div className="text-lg font-bold text-primary">Rp {(goldPriceIDR / 1000000).toFixed(0)}M</div>
                  </div>

                  <div className="text-center p-3 sm:p-4 bg-accent rounded-xl border border-border">
                    <div className="text-xs text-muted-foreground mb-1">Zakat Rate</div>
                    <div className="text-lg font-bold text-primary">{zakatRate}%</div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground mt-4 text-center">
                  Nisab threshold set to 85g gold equivalent (Rp 85,000,000) for testnet.
                </p>
              </CardContent>
            </Card>

            {/* Tabs */}
            <Card>
              {/* Tab Headers */}
              <div className="grid grid-cols-2 border-b border-border">
                <Button
                  variant="ghost"
                  onClick={() => setSelectedTab("maal")}
                  className={`rounded-none border-b-2 h-14 ${
                    selectedTab === "maal"
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="hidden sm:inline">Wealth Zakat</span>
                  <span className="sm:hidden">Wealth</span>
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSelectedTab("fitrah")}
                  className={`rounded-none border-b-2 h-14 ${
                    selectedTab === "fitrah"
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="hidden sm:inline">Fitrah Zakat</span>
                  <span className="sm:hidden">Fitrah</span>
                </Button>
              </div>

              {/* Tab Content */}
              <CardContent className="p-6">
                {selectedTab === "maal" ? (
                  <div className="space-y-6">
                    {/* Zakat Type Selector */}
                    <div className="space-y-2">
                      <Label htmlFor="zakat-type">Zakat Type</Label>
                      <Select value={zakatType} onValueChange={setZakatType}>
                        <SelectTrigger id="zakat-type" className="w-full h-11">
                          <SelectValue placeholder="Select zakat type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="income">Income Zakat</SelectItem>
                          <SelectItem value="trade">Trade Zakat</SelectItem>
                          <SelectItem value="savings">Savings Zakat</SelectItem>
                          <SelectItem value="gold">Gold & Silver Zakat</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {zakatType === "income" && (
                      <>
                        {/* Income Period */}
                        <div className="space-y-3">
                          <Label>Income Calculation Period</Label>
                          <RadioGroup value={incomeType} onValueChange={(value: "monthly" | "yearly") => setIncomeType(value)}>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="monthly" id="monthly" />
                              <Label htmlFor="monthly" className="font-normal cursor-pointer">Monthly</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="yearly" id="yearly" />
                              <Label htmlFor="yearly" className="font-normal cursor-pointer">Yearly</Label>
                            </div>
                          </RadioGroup>
                        </div>

                        {/* Income Input */}
                        <div className="space-y-2">
                          <Label htmlFor="income-input">
                            {incomeType === "monthly" ? "Monthly Income*" : "Yearly Income*"}
                          </Label>
                          <div className="relative">
                            <Calculator className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              id="income-input"
                              type="number"
                              value={monthlyIncome}
                              onChange={(e) => setMonthlyIncome(e.target.value)}
                              placeholder={`Enter your ${incomeType} income in IDR`}
                              className="pl-10 h-11"
                            />
                          </div>
                        </div>

                        {/* Advanced Options Toggle */}
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setShowAdvanced(!showAdvanced)}
                          className="h-auto p-0 text-primary hover:text-primary"
                        >
                          {showAdvanced ? "Hide" : "Show"} advanced options
                          <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                        </Button>

                        {showAdvanced && (
                          <div className="space-y-4 pt-2">
                            {/* Deduction Toggle */}
                            <div className="flex items-center justify-between p-4 bg-card rounded-xl border border-border">
                              <Label htmlFor="deductions" className="cursor-pointer">
                                Apply work-related deductions
                              </Label>
                              <Switch
                                id="deductions"
                                checked={hasDeductions}
                                onCheckedChange={setHasDeductions}
                              />
                            </div>

                            {/* Expenses Input */}
                            {hasDeductions && (
                              <div className="space-y-2">
                                    <Label htmlFor="expenses">Expenses (IDR)</Label>
                                <div className="relative">
                                  <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input
                                    id="expenses"
                                    type="number"
                                    value={expenses}
                                    onChange={(e) => setExpenses(e.target.value)}
                                      placeholder="Enter your expenses in IDR"
                                    className="pl-10 h-11"
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Optional: Enter your work-related or other deductible expenses
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Payment Obligation */}
                        <div className={`p-4 rounded-xl border ${calculatedZakat > 0 ? "bg-primary/5 border-primary/20" : "bg-accent border-border"}`}>
                          <div className="text-sm font-medium text-primary mb-1">Payment Obligation</div>
                          <div className={`text-sm ${calculatedZakat > 0 ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                            {calculatedZakat > 0
                              ? "Required to Pay Zakat"
                              : "Not Required to Pay Zakat, but Can Give Charity"}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Calculated Amount */}
                    {calculatedZakat > 0 && (
                      <div className="p-4 sm:p-6 rounded-xl border border-primary/30 bg-primary/5 shadow-sm">
                        <div className="text-center">
                          <p className="text-xs sm:text-sm text-muted-foreground mb-2">Your Zakat Amount:</p>
                            <p className="text-2xl sm:text-4xl font-bold text-primary mb-1 break-all">
                              Rp {calculatedZakat.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                            </p>
                          <p className="text-xs text-muted-foreground">
                            {zakatRate}% of taxable income above nisab
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Pay Button */}
                    <Button
                      onClick={handlePayZakatClick}
                      disabled={!isConnected || calculatedZakat === 0}
                      size="lg"
                      className="w-full"
                    >
                      <Wallet className="h-4 w-4" />
                      {!isConnected ? "Connect Wallet to Pay" : "Pay Zakat"}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Fitrah Amount Display */}
                    <div className="p-4 sm:p-6 bg-accent rounded-xl border border-border">
                      <div className="text-center">
                        <p className="text-xs sm:text-sm text-muted-foreground mb-2">Fitrah Zakat per person:</p>
                        <p className="text-2xl sm:text-3xl font-bold text-primary mb-1 break-all">
                          Rp {fitrahPerPerson.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">Equivalent to 2.5kg rice</p>
                      </div>
                    </div>

                    {/* People Count Input */}
                    <div className="space-y-2">
                      <Label htmlFor="people-count">Number of People</Label>
                      <div className="relative">
                        <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="people-count"
                          type="number"
                          value={peopleCount}
                          onChange={(e) => setPeopleCount(e.target.value)}
                          placeholder="Enter number of people"
                          min="1"
                          className="pl-10 h-11"
                        />
                      </div>
                    </div>

                    {/* Calculation Breakdown */}
                    <div className="space-y-3 py-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Per person:</span>
                        <span className="font-medium">Rp {fitrahPerPerson.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Number of people:</span>
                        <span className="font-medium">{peopleCount || 0}</span>
                      </div>
                      <div className="h-px bg-border" />
                      <div className="flex justify-between items-center gap-2 text-base sm:text-lg font-bold">
                        <span>Total:</span>
                        <span className="text-primary break-all text-right">Rp {totalFitrah.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Pay Button */}
                    <Button
                      onClick={handlePayFitrahClick}
                      disabled={!isConnected || !peopleCount || totalFitrah === 0}
                      size="lg"
                      className="w-full"
                    >
                      <Wallet className="h-4 w-4" />
                      {!isConnected ? "Connect Wallet to Pay" : "Pay Zakat Fitrah"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Impact Areas */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Impact Areas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-accent rounded-xl hover:bg-primary/5 transition-colors cursor-pointer">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Heart className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Orphans</div>
                    <div className="text-xs text-muted-foreground">Supporting orphaned children</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-accent rounded-xl hover:bg-primary/5 transition-colors cursor-pointer">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Refugees</div>
                    <div className="text-xs text-muted-foreground">Helping displaced families</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-accent rounded-xl hover:bg-primary/5 transition-colors cursor-pointer">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Home className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Local Aid</div>
                    <div className="text-xs text-muted-foreground">Community support programs</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Transparency Guarantee */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Transparency Guarantee</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Check className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="text-xs text-muted-foreground">Blockchain verified</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Check className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="text-xs text-muted-foreground">Real-time tracking</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Check className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="text-xs text-muted-foreground">Impact reports</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Check className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="text-xs text-muted-foreground">NFT certificates</span>
                </div>
              </CardContent>
            </Card>

            {/* Global Impact */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Global Impact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total Donated:</span>
                  <span className="font-semibold">2.4B IDR</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Families Helped:</span>
                  <span className="font-semibold">3,247</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Active Donors:</span>
                  <span className="font-semibold">1,856</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Campaign Selection Dialog */}
        <Dialog open={showCampaignDialog} onOpenChange={setShowCampaignDialog}>
          <DialogContent className="max-w-3xl w-[95vw] sm:w-full max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("campaignSelect.title")}</DialogTitle>
              <DialogDescription className="break-words">
                <span className="hidden sm:inline">{t("campaignSelect.description")} </span>
                <span className="sm:hidden">{t("campaignSelect.description")}</span>
                Rp {(paymentType === "maal" ? calculatedZakat : totalFitrah).toLocaleString('id-ID', { maximumFractionDigits: 0, notation: "compact" })}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:gap-4 py-4">
              {isLoadingCampaigns && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Loading campaigns…
                </div>
              )}
              {!isLoadingCampaigns && campaigns.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No active campaigns available right now.
                </div>
              )}
              {campaigns.map((campaign) => (
                <Button
                  key={campaign.id}
                  variant="outline"
                  onClick={() => handleCampaignSelect(campaign)}
                  className="h-auto p-3 sm:p-4 flex items-start gap-3 sm:gap-4 justify-start hover:border-primary/30 hover:bg-accent text-left"
                >
                  <img
                    src={campaign.image}
                    alt={campaign.title}
                    className="w-14 h-14 sm:w-20 sm:h-20 object-cover rounded-xl flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5 sm:gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold text-sm sm:text-base mb-0 line-clamp-2 flex-1 pr-2">{campaign.title}</h4>
                      <span className="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-semibold bg-primary/10 text-primary flex-shrink-0">
                        {campaign.category}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{campaign.organizationName}</p>
                    <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-1 text-xs">
                      <span className="text-primary font-medium">{formatCurrency(campaign.raised)} raised</span>
                      <span className="text-muted-foreground">of {formatCurrency(campaign.goal)}</span>
                    </div>
                    <div className="mt-1 sm:mt-2 h-1.5 bg-accent rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${Math.min((campaign.raised / campaign.goal) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Confirmation Dialog */}
        <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("confirm.title")}</DialogTitle>
              <DialogDescription>
                {t("confirm.description")}
              </DialogDescription>
            </DialogHeader>

            {selectedCampaign && (
              <div className="space-y-4 py-4">
                <div className="p-4 bg-accent rounded-xl border border-border">
                  <div className="text-sm font-medium text-primary mb-2">{t("confirm.campaign")}</div>
                  <div className="text-sm text-muted-foreground">{selectedCampaign.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{selectedCampaign.organizationName}</div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-3 sm:p-4 bg-accent rounded-xl border border-border">
                    <div className="text-xs text-muted-foreground mb-1">{t("confirm.amount")}</div>
                    <div className="text-lg sm:text-xl font-bold text-primary break-words">Rp {(paymentType === "maal" ? calculatedZakat : totalFitrah).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</div>
                  </div>

                  <div className="p-3 sm:p-4 bg-accent rounded-xl border border-border">
                    <div className="text-xs text-muted-foreground mb-1">{t("confirm.currentBalance")}</div>
                    <div className="text-lg sm:text-xl font-bold text-primary break-words">{idrxBalance ? Number(idrxBalance / BigInt(1e18)).toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '0'} IDRX</div>
                  </div>
                </div>

                <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                  <div className="flex items-start gap-3">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-primary">{t("confirm.blockchain")}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {t("confirm.blockchainNote")}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowConfirmDialog(false)}
                disabled={isProcessing}
              >
                {t("confirm.goBack")}
              </Button>
              <Button
                onClick={handleConfirmPayment}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("confirm.processing")}
                  </>
                ) : (
                  <>
                    <Wallet className="mr-2 h-4 w-4" />
                    {t("confirm.confirmPayment")}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}