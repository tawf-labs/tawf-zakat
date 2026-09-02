'use client';

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, FileText, Upload, CheckCircle2, AlertCircle, Building2, Users, Clock, Target, Wallet, ArrowRight, Settings, ChevronRight, LayoutDashboard, PlusCircle } from "lucide-react";
import { useIsVerifiedOrganizer } from "@/hooks/useOrganizerApplication";
import { useAccount } from "wagmi";
import { useLanguage } from "@/components/providers/language-provider";

export default function OrganizerPage() {
  const { t } = useLanguage()
  const { address, isConnected } = useAccount();
  const { isVerified } = useIsVerifiedOrganizer(address);

  // Organizer navigation items
  const organizerNavItems = [
    { href: "/organizer", label: "Dashboard", key: "organizer.nav.dashboard", icon: LayoutDashboard },
    { href: "/organizer/proposals", label: "My Proposals", key: "organizer.nav.myProposals", icon: FileText },
    { href: "/organizer/campaigns", label: "My Campaigns", key: "organizer.nav.myCampaigns", icon: Target },
    { href: "/organizer/create", label: "Create Proposal", key: "organizer.nav.createProposal", icon: PlusCircle },
    { href: "/organizer/settings", label: "Settings", key: "organizer.nav.settings", icon: Settings },
  ];

  // Show wallet connection prompt if not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-accent flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-6">
            <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <Wallet className="h-8 w-8 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold">{t('organizer.connectWallet.title')}</h1>
            <p className="text-muted-foreground">
              {t('organizer.connectWallet.description')}
            </p>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t('organizer.connectWallet.needWallet')}
              </AlertDescription>
            </Alert>
            <Link href="/">
              <Button variant="outline" className="w-full">
                {t('organizer.connectWallet.returnHome')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isConnected && !isVerified) {
    // Show application page if connected but not verified
    return <OrganizerNotVerified />;
  }

  // Show dashboard if verified
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
              <div className="font-bold text-sm">{t('organizer.sidebar.title')}</div>
              <div className="text-xs text-muted-foreground">{t('organizer.sidebar.verified')}</div>
            </div>
          </div>

          {/* User Info */}
          <div className="mb-6 p-3 bg-secondary/30 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">{t('organizer.sidebar.connectedAs')}</div>
            <div className="text-sm font-mono truncate">{address}</div>
          </div>

          <nav className="space-y-1">
            {organizerNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <item.icon className="h-4 w-4" />
                {t(item.key)}
                {item.href === "/organizer/create" && (
                  <ChevronRight className="h-4 w-4 ml-auto" />
                )}
              </Link>
            ))}
          </nav>

          <div className="mt-auto pt-6 border-t border-gray-200">
            <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowRight className="h-4 w-4" />
              {t('organizer.sidebar.backToDonor')}
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
        <OrganizerDashboardContent />
      </main>

      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-2">
        <div className="flex justify-around">
          {organizerNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-1 px-3 py-2 text-xs text-muted-foreground"
            >
              <item.icon className="h-4 w-4" />
              {t(item.key)}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function OrganizerNotVerified() {
  const { t } = useLanguage()

  return (
    <div className="min-h-screen bg-accent flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-6">
          <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto">
            <Building2 className="h-8 w-8 text-blue-600" />
          </div>

          <h1 className="text-2xl font-bold">{t('organizer.notVerified.title')}</h1>
          <p className="text-muted-foreground">
            {t('organizer.notVerified.description')}
          </p>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t('organizer.notVerified.needApply')}
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <Link href="/organizer/apply">
              <Button className="w-full">
                {t('organizer.notVerified.applyButton')}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>

            <Link href="/">
              <Button variant="outline" className="w-full">
                {t('organizer.notVerified.returnToDonor')}
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OrganizerDashboardContent() {
  const { t } = useLanguage()

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">{t('organizer.dashboard.title')}</h1>
        <p className="text-muted-foreground">
          {t('organizer.dashboard.subtitle')}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title={t('organizer.stats.activeCampaigns')}
          value="0"
          description={t('organizer.stats.activeCampaignsDesc')}
          icon={Target}
          color="blue"
        />
        <StatCard
          title={t('organizer.stats.totalRaised')}
          value="0 IDRX"
          description={t('organizer.stats.totalRaisedDesc')}
          icon={Wallet}
          color="green"
        />
        <StatCard
          title={t('organizer.stats.milestonesCompleted')}
          value="0/0"
          description={t('organizer.stats.milestonesCompletedDesc')}
          icon={CheckCircle2}
          color="purple"
        />
        <StatCard
          title={t('organizer.stats.donors')}
          value="0"
          description={t('organizer.stats.donorsDesc')}
          icon={Users}
          color="orange"
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <QuickActionCard
          title={t('organizer.actions.createCampaign')}
          description={t('organizer.actions.createCampaignDesc')}
          icon={Upload}
          href="/organizer/create"
        />
        <QuickActionCard
          title={t('organizer.actions.myProposals')}
          description={t('organizer.actions.myProposalsDesc')}
          icon={FileText}
          href="/organizer/proposals"
        />
        <QuickActionCard
          title={t('organizer.actions.campaignSettings')}
          description={t('organizer.actions.campaignSettingsDesc')}
          icon={Settings}
          href="/organizer/settings"
        />
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>{t('organizer.activity.title')}</CardTitle>
          <CardDescription>
            {t('organizer.activity.subtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t('organizer.activity.empty')}</p>
            <p className="text-sm">{t('organizer.activity.emptyHint')}</p>
          </div>
        </CardContent>
      </Card>

      {/* Getting Started Card */}
      <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
        <CardHeader>
          <CardTitle>{t('organizer.gettingStarted.title')}</CardTitle>
          <CardDescription>
            {t('organizer.gettingStarted.subtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">1</span>
              <span className="font-medium">{t('organizer.gettingStarted.step1')}</span>
            </li>
            <li className="flex gap-3">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">2</span>
              <span className="font-medium">{t('organizer.gettingStarted.step2')}</span>
            </li>
            <li className="flex gap-3">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">3</span>
              <span className="font-medium">{t('organizer.gettingStarted.step3')}</span>
            </li>
            <li className="flex gap-3">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">4</span>
              <span className="font-medium">{t('organizer.gettingStarted.step4')}</span>
            </li>
            <li className="flex gap-3">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">5</span>
              <span className="font-medium">{t('organizer.gettingStarted.step5')}</span>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
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

function QuickActionCard({
  title,
  description,
  icon: Icon,
  href
}: {
  title: string;
  description: string;
  icon: any;
  href: string;
}) {
  return (
    <Link href={href} className="group">
      <Card className="transition-all hover:shadow-md hover:border-primary/50 h-full">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-semibold group-hover:text-primary transition-colors">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground ml-auto" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
