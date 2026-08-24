"use client";

import React, { useEffect, useState } from 'react';
import { Shield, LayoutDashboard, Building2, FileCheck, TriangleAlert, Search, Download, Activity, AlertCircle, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useProposal } from '@/hooks/useProposals';
import { useUpdateKYCStatus, KYCStatus, getKYCStatusLabel, getKYCStatusColor } from '@/hooks/useKYCOracle';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/components/providers/language-provider';

type SidebarTab = 'overview' | 'organizations' | 'audit' | 'alerts' | 'kyc';

const AuditorDashboard = () => {
  const { t } = useLanguage()
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('overview');
  const { address } = useAccount();

  // KYC Verification state
  const [proposalId, setProposalId] = useState("");
  const [notes, setNotes] = useState("");

  const { proposal, refetch } = useProposal(Number(proposalId) || 0);
  const { updateKYCStatus, isPending, isSuccess, error } = useUpdateKYCStatus();

  const organizations = [
    { name: 'Laznas BSM', allocation: '$1.2M', status: 'Compliant', risk: 'Low', riskPercent: 20 },
    { name: 'Dompet Dhuafa', allocation: '$3.5M', status: 'Compliant', risk: 'Low', riskPercent: 20 },
    { name: 'Rumah Zakat', allocation: '$2.1M', status: 'Compliant', risk: 'Low', riskPercent: 20 },
    { name: 'Small NGO A', allocation: '$50k', status: 'Review Needed', risk: 'Medium', riskPercent: 60 },
    { name: 'Human Initiative', allocation: '$1.8M', status: 'Compliant', risk: 'Low', riskPercent: 20 },
  ];

  const auditLogs = [
    { action: 'Funds Deployed: $12,500', org: 'Rumah Zakat', tx: '0x82...91a', time: '2 mins ago' },
    { action: 'Compliance Check Passed', org: 'Dompet Dhuafa', tx: '0x7f...3c2', time: '15 mins ago' },
    { action: 'New Organization Registered', org: 'Laznas BSM', tx: '0x4a...8d9', time: '1 hour ago' },
    { action: 'Funds Deployed: $25,000', org: 'Human Initiative', tx: '0x91...2ef', time: '2 hours ago' },
    { action: 'Risk Alert Resolved', org: 'Small NGO A', tx: '0xc3...7b4', time: '3 hours ago' },
  ];

  const getStatusColor = (status: string) => {
    return status === 'Compliant'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-amber-100 text-amber-700';
  };

  const getRiskColor = (risk: string) => {
    return risk === 'Low'
      ? 'bg-emerald-500'
      : 'bg-amber-500';
  };

  const getRiskBgColor = (risk: string) => {
    return risk === 'Low'
      ? 'bg-emerald-200'
      : 'bg-amber-200';
  };

  const handleVerify = async (status: KYCStatus) => {
    if (!proposalId || !notes) {
      alert("Please enter proposal ID and verification notes");
      return;
    }

    try {
      await updateKYCStatus(Number(proposalId), status, notes);
      await refetch();
      setNotes("");
    } catch (err) {
      console.error("Failed to update KYC status:", err);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white text-black hidden lg:block border-r border-black">
        <div className="p-6">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="h-10 w-10 rounded-lg bg-white flex items-center justify-center text-black">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <div className="font-bold text-lg">{t("auditor.title")}</div>
              <div className="text-xs text-black">{t("auditor.subtitle")}</div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="space-y-2">
            <Button
              onClick={() => setSidebarTab('overview')}
              variant={sidebarTab === 'overview' ? 'default' : 'ghost'}
              className={`w-full justify-start ${sidebarTab === 'overview' ? 'bg-black text-white hover:bg-black' : 'text-black hover:text-white hover:bg-gray-800'}`}
            >
              <LayoutDashboard className="h-4 w-4 mr-2" />
              {t("auditor.ecosystemOverview")}
            </Button>
            <Button
              onClick={() => setSidebarTab('kyc')}
              variant={sidebarTab === 'kyc' ? 'default' : 'ghost'}
              className={`w-full justify-start ${sidebarTab === 'kyc' ? 'bg-black text-white hover:bg-black' : 'text-black hover:text-white hover:bg-gray-800'}`}
            >
              <FileText className="h-4 w-4 mr-2" />
              {t("auditor.kycVerification")}
            </Button>
            <Button
              onClick={() => setSidebarTab('organizations')}
              variant={sidebarTab === 'organizations' ? 'default' : 'ghost'}
              className={`w-full justify-start ${sidebarTab === 'organizations' ? 'bg-black text-white hover:bg-black' : 'text-black hover:text-white hover:bg-gray-800'}`}
            >
              <Building2 className="h-4 w-4 mr-2" />
              {t("auditor.organizationsNav")}
            </Button>
            <Button
              onClick={() => setSidebarTab('audit')}
              variant={sidebarTab === 'audit' ? 'default' : 'ghost'}
              className={`w-full justify-start ${sidebarTab === 'audit' ? 'bg-black text-white hover:bg-black' : 'text-black hover:text-white hover:bg-gray-800'}`}
            >
              <FileCheck className="h-4 w-4 mr-2" />
              {t("auditor.auditLogs")}
            </Button>
            <Button
              onClick={() => setSidebarTab('alerts')}
              variant={sidebarTab === 'alerts' ? 'default' : 'ghost'}
              className={`w-full justify-start ${sidebarTab === 'alerts' ? 'bg-black text-white hover:bg-black' : 'text-black hover:text-white hover:bg-gray-800'}`}
            >
              <TriangleAlert className="h-4 w-4 mr-2" />
              {t("auditor.riskAlerts")}
            </Button>
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 bg-white">
        {/* KYC Verification Tab */}
        {sidebarTab === 'kyc' && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight text-black">{t("auditor.kycVerification")}</h1>
              <p className="text-black">{t("auditor.verifyOrReject")}</p>
            </div>

            <div className="grid gap-6 max-w-4xl">
              {/* KYC Verification Panel */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("auditor.updateKycStatus")}</CardTitle>
                  <CardDescription>
                    {t("auditor.updateKycDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="proposalId" className="text-sm font-medium">
                      {t("auditor.proposalId")}
                    </label>
                    <Input
                      id="proposalId"
                      type="number"
                      placeholder={t("auditor.proposalIdPlaceholder")}
                      value={proposalId}
                      onChange={(e) => setProposalId(e.target.value)}
                      className="max-w-md"
                    />
                  </div>

                  {/* Show proposal details if loaded */}
                  {proposal && Number(proposalId) > 0 && (
                    <Card className="bg-slate-50 border-slate-200">
                      <CardContent className="pt-6 space-y-3">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h3 className="font-semibold text-lg">{proposal.title}</h3>
                            <p className="text-sm text-slate-600 mt-1">{proposal.description}</p>
                          </div>
                          <Badge className={getKYCStatusColor(proposal.kycStatus)}>
                            {getKYCStatusLabel(proposal.kycStatus)}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm pt-2 border-t">
                          <div>
                            <span className="text-slate-600">Organizer:</span>
                            <p className="font-mono text-xs mt-1">
                              {proposal.organizer.slice(0, 6)}...{proposal.organizer.slice(-4)}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-600">Funding Goal:</span>
                            <p className="font-semibold mt-1">
                              {proposal.fundingGoal} IDRX
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-600">Emergency:</span>
                            <p className="mt-1">
                              {proposal.isEmergency ? (
                                <Badge variant="destructive" className="text-xs">Yes</Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">No</Badge>
                              )}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="notes" className="text-sm font-medium">
                      {t("auditor.verificationNotes")} <span className="text-red-500">*</span>
                    </label>
                    <Textarea
                      id="notes"
                      placeholder={t("auditor.verificationNotesPlaceholder")}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={4}
                      className="resize-none"
                    />
                    <p className="text-xs text-slate-500">
                      {t("auditor.notesStored")}
                    </p>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      onClick={() => handleVerify(KYCStatus.Verified)}
                      disabled={isPending || !proposalId || !notes || !proposal}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      {isPending ? t("auditor.processing") : t("auditor.verifyKyc")}
                    </Button>

                    <Button
                      onClick={() => handleVerify(KYCStatus.Rejected)}
                      disabled={isPending || !proposalId || !notes || !proposal}
                      variant="destructive"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      {isPending ? t("auditor.processing") : t("auditor.rejectKyc")}
                    </Button>
                  </div>

                  {isSuccess && (
                    <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
                      <p className="text-green-800 dark:text-green-200 font-medium flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        {t("auditor.kycUpdated")}
                      </p>
                    </div>
                  )}

                  {error && (
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                      <p className="text-red-800 dark:text-red-200 font-medium flex items-center gap-2">
                        <XCircle className="h-4 w-4" />
                        {t("auditor.error")} {error.message}
                      </p>
                      <p className="text-xs text-red-600 mt-1">
                        {t("auditor.kycRoleError")}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Your Connected Wallet */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("auditor.yourWallet")}</CardTitle>
                  <CardDescription>
                    {t("auditor.kycCredentials")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-600">{t("auditor.connectedAs")}</span>
                    <code className="bg-slate-100 px-2 py-1 rounded text-xs font-mono">
                      {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : t("auditor.notConnected")}
                    </code>
                  </div>
                  <p className="text-xs text-slate-500">
                    {t("auditor.roleWarning")}
                  </p>
                </CardContent>
              </Card>

              {/* Instructions */}
              <Card className="border-blue-200 bg-blue-50/50">
                <CardHeader>
                  <CardTitle className="text-blue-900">{t("auditor.howToVerify")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-blue-800">
                  <ol className="list-decimal list-inside space-y-2">
                    <li>{t("auditor.verifyInstructions")}</li>
                  </ol>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Ecosystem Overview Tab */}
        {sidebarTab === 'overview' && (
          <>
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-black">
              {t("auditor.ecosystemOverview")}
            </h1>
            <p className="text-black">
              {t("auditor.monitoring")} 145 {t("auditor.laznasNgos")} {t("auditor.inRealtime")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-64 hidden md:block">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-black" />
              <Input
                type="search"
                placeholder={t("auditor.searchOrgHash")}
                className="pl-9 border-black focus-visible:ring-black"
              />
            </div>
            <Button variant="outline" className="bg-white border-black hover:bg-gray-50">
              <Download className="h-4 w-4 mr-2" />
              {t("auditor.exportReport")}
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl border border-l-4 border-l-emerald-500 p-6 shadow-sm">
            <div className="text-sm font-medium text-emerald-600 mb-2">
              {t("auditor.totalNationalZakat")}
            </div>
            <div className="text-2xl font-bold text-emerald-900">$45,250,000</div>
            <div className="flex items-center gap-1 text-xs text-emerald-600 mt-2 font-medium">
              <Activity className="h-3 w-3" />
              100% {t("auditor.tracedOnBlockchain")}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-l-4 border-l-blue-500 p-6 shadow-sm">
            <div className="text-sm font-medium text-blue-600 mb-2">
              {t("auditor.activeOrganizations")}
            </div>
            <div className="text-2xl font-bold text-blue">145</div>
            <div className="text-xs text-blue-600 mt-2">
              142 {t("auditor.compliant")}, 3 {t("auditor.underReview")}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-l-4 border-l-amber-500 p-6 shadow-sm">
            <div className="text-sm font-medium text-amber-600 mb-2">
              {t("auditor.complianceRate")}
            </div>
            <div className="text-2xl font-bold text-amber-900">98.2%</div>
            <div className="text-xs text-amber-600 mt-2">
              {t("auditor.basedOnAudits")}
            </div>
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Organization Status Table */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-black shadow-sm">
              <div className="p-6 border-b border-black">
                <h3 className="font-semibold text-black">{t("auditor.organizationStatus")}</h3>
                <p className="text-sm text-black mt-1">
                  {t("auditor.realTimeCompliance")}
                </p>
              </div>
              <div className="p-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-black">
                        <th className="text-left py-3 px-2 font-medium text-black">
                          Organization
                        </th>
                        <th className="text-left py-3 px-2 font-medium text-black">
                          {t("auditor.fundAllocation")}
                        </th>
                        <th className="text-left py-3 px-2 font-medium text-black">
                          {t("auditor.auditStatus")}
                        </th>
                        <th className="text-left py-3 px-2 font-medium text-black">
                          {t("auditor.riskScore")}
                        </th>
                        <th className="text-left py-3 px-2 font-medium text-black"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {organizations.map((org, idx) => (
                        <tr key={idx} className="border-b border-black hover:bg-slate-50">
                          <td className="py-3 px-2 font-medium text-black">
                            {org.name}
                          </td>
                          <td className="py-3 px-2 text-black">{org.allocation}</td>
                          <td className="py-3 px-2">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${getStatusColor(
                                org.status
                              )}`}
                            >
                              {org.status}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2">
                              <div className={`h-2 w-16 rounded-full ${getRiskBgColor(org.risk)}`}>
                                <div
                                  className={`h-full rounded-full ${getRiskColor(org.risk)}`}
                                  style={{ width: `${org.riskPercent}%` }}
                                ></div>
                              </div>
                              <span className="text-xs text-black">{org.risk}</span>
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <Button variant="ghost" size="sm" className="text-xs h-8 hover:bg-slate-100">
                              {t("auditor.details")}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Live Audit Log */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-black shadow-sm h-full">
              <div className="p-6 border-b border-black">
                <h3 className="font-semibold text-black">{t("auditor.liveAuditLog")}</h3>
                <p className="text-sm text-black mt-1">
                  {t("auditor.immutableRecords")}
                </p>
              </div>
              <div className="p-6">
                <div className="relative border-l border-black ml-3 space-y-6">
                  {auditLogs.map((log, idx) => (
                    <div key={idx} className="ml-6 relative">
                      <div className="absolute -left-[31px] top-1 h-4 w-4 rounded-full border-2 border-white bg-blue-500"></div>
                      <div className="flex flex-col gap-1">
                        <div className="text-sm font-semibold text-black">
                          {log.action}
                        </div>
                        <div className="text-xs text-black">
                          Org: <span className="font-medium text-black">{log.org}</span>
                        </div>
                        <div className="text-xs text-black font-mono bg-slate-100 w-fit px-1 rounded">
                          Tx: {log.tx}
                        </div>
                        <div className="text-xs text-black mt-1">{log.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        </>
        )}

        {/* Organizations Tab */}
        {sidebarTab === 'organizations' && (
          <>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-black">{t("auditor.organizationsNav")}</h1>
                <p className="text-black">Detailed view of all registered organizations</p>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-black" />
                <Input
                  type="search"
                  placeholder={t("auditor.searchOrg")}
                  className="pl-9 border-black focus-visible:ring-black"
                />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-black shadow-sm">
              <div className="p-6 border-b border-black">
                <h3 className="font-semibold text-black">{t("auditor.allOrganizations")}</h3>
              </div>
              <div className="p-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-black">
                        <th className="text-left py-3 px-2 font-medium text-black">Organization</th>
                        <th className="text-left py-3 px-2 font-medium text-black">{t("auditor.fundAllocation")}</th>
                        <th className="text-left py-3 px-2 font-medium text-black">{t("auditor.auditStatus")}</th>
                        <th className="text-left py-3 px-2 font-medium text-black">{t("auditor.riskScore")}</th>
                        <th className="text-left py-3 px-2 font-medium text-black">{t("auditor.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {organizations.map((org, idx) => (
                        <tr key={idx} className="border-b border-black hover:bg-slate-50">
                          <td className="py-3 px-2 font-medium text-black">{org.name}</td>
                          <td className="py-3 px-2 text-black">{org.allocation}</td>
                          <td className="py-3 px-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${getStatusColor(org.status)}`}>
                              {org.status}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2">
                              <div className={`h-2 w-16 rounded-full ${getRiskBgColor(org.risk)}`}>
                                <div className={`h-full rounded-full ${getRiskColor(org.risk)}`} style={{ width: `${org.riskPercent}%` }}></div>
                              </div>
                              <span className="text-xs text-black">{org.risk}</span>
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <Button variant="ghost" size="sm" className="text-xs h-8 hover:bg-slate-100">
                              {t("auditor.viewDetails")}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Audit Logs Tab */}
        {sidebarTab === 'audit' && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight text-black">{t("auditor.auditLogs")}</h1>
              <p className="text-black">{t("auditor.completeAuditTrail")}</p>
            </div>

            <div className="bg-white rounded-xl border border-black shadow-sm">
              <div className="p-6 border-b border-black">
                <h3 className="font-semibold text-black">{t("auditor.allAuditEntries")}</h3>
                <p className="text-sm text-black mt-1">{t("auditor.chronologicalView")}</p>
              </div>
              <div className="p-6">
                <div className="relative border-l border-black ml-3 space-y-6">
                  {auditLogs.map((log, idx) => (
                    <div key={idx} className="ml-6 relative">
                      <div className="absolute -left-[31px] top-1 h-4 w-4 rounded-full border-2 border-white bg-blue-500"></div>
                      <div className="flex flex-col gap-1">
                        <div className="text-sm font-semibold text-black">{log.action}</div>
                        <div className="text-xs text-black">
                          Org: <span className="font-medium text-black">{log.org}</span>
                        </div>
                        <div className="text-xs text-black font-mono bg-slate-100 w-fit px-1 rounded">
                          Tx: {log.tx}
                        </div>
                        <div className="text-xs text-black mt-1">{log.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Risk Alerts Tab */}
        {sidebarTab === 'alerts' && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight text-black">{t("auditor.riskAlerts")}</h1>
              <p className="text-black">{t("auditor.monitorAddress")}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white rounded-xl border border-l-4 border-l-red-500 p-6 shadow-sm">
                <div className="text-sm font-medium text-red-600 mb-2">{t("auditor.criticalAlerts")}</div>
                <div className="text-2xl font-bold text-red-900">0</div>
                <div className="text-xs text-red-600 mt-2">{t("auditor.immediateAction")}</div>
              </div>
              <div className="bg-white rounded-xl border border-l-4 border-l-amber-500 p-6 shadow-sm">
                <div className="text-sm font-medium text-amber-600 mb-2">{t("auditor.mediumPriority")}</div>
                <div className="text-2xl font-bold text-amber-900">3</div>
                <div className="text-xs text-amber-600 mt-2">{t("auditor.reviewRecommended")}</div>
              </div>
              <div className="bg-white rounded-xl border border-l-4 border-l-green-500 p-6 shadow-sm">
                <div className="text-sm font-medium text-green-600 mb-2">{t("auditor.resolved")}</div>
                <div className="text-2xl font-bold text-green-900">12</div>
                <div className="text-xs text-green-600 mt-2">{t("auditor.thisMonth")}</div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-black shadow-sm">
              <div className="p-6 border-b border-black">
                <h3 className="font-semibold text-black">{t("auditor.activeAlerts")}</h3>
              </div>
              <div className="p-6 space-y-4">
                {[
                  { org: 'Small NGO A', issue: 'Delayed fund deployment', severity: 'Medium', days: '15 days', color: 'amber' },
                  { org: 'Community Aid', issue: 'Missing quarterly report', severity: 'Medium', days: '8 days', color: 'amber' },
                  { org: 'Relief Foundation', issue: 'Unusual donation pattern detected', severity: 'Medium', days: '3 days', color: 'amber' },
                ].map((alert, idx) => (
                  <div key={idx} className="border border-border rounded-lg p-4 hover:bg-accent/50">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-start gap-3">
                        <AlertCircle className={`h-5 w-5 text-${alert.color}-600 mt-0.5`} />
                        <div>
                          <div className="font-semibold">{alert.org}</div>
                          <div className="text-sm text-muted-foreground mt-1">{alert.issue}</div>
                          <div className="text-xs text-muted-foreground mt-1">Pending for {alert.days}</div>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded-md text-xs font-medium bg-${alert.color}-100 text-${alert.color}-700`}>
                        {alert.severity}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="border-black hover:bg-gray-50 text-xs h-7">
                        {t("auditor.investigate")}
                      </Button>
                      <Button size="sm" className="text-xs h-7">
                        {t("auditor.resolve")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default AuditorDashboard;
