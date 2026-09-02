'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useIsVerifiedOrganizer } from '@/hooks/useOrganizerApplication';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Settings, AlertCircle, CheckCircle2, LayoutDashboard, FileText, Target, PlusCircle, ArrowRight, Bell, Shield, Globe, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function OrganizerSettingsPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { isVerified } = useIsVerifiedOrganizer(address);

  const [notifications, setNotifications] = useState({
    emailProposalUpdates: true,
    emailDonationAlerts: true,
    emailVotingReminders: false,
    emailMilestoneDeadlines: true,
    telegramNotifications: false,
  });

  const [profile, setProfile] = useState({
    organizationName: '',
    displayName: '',
    bio: '',
    website: '',
    twitter: '',
    telegram: '',
  });

  // Redirect if not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-accent flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="h-16 w-16 text-amber-600 mx-auto" />
            <h2 className="text-2xl font-bold">Wallet Not Connected</h2>
            <p className="text-muted-foreground">Please connect your wallet to access settings.</p>
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
            <p className="text-muted-foreground">You need to be verified as an organizer to access settings.</p>
            <Button onClick={() => router.push('/organizer/apply')}>Apply to Become an Organizer</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSaveProfile = () => {
    // In a real implementation, this would update the profile on-chain or via IPFS
    console.log('Saving profile:', profile);
    alert('Profile saved successfully!');
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
            <Link href="/organizer/proposals" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors">
              <FileText className="h-4 w-4" />
              My Proposals
            </Link>
            <Link href="/organizer/campaigns" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors">
              <Target className="h-4 w-4" />
              My Campaigns
            </Link>
            <Link href="/organizer/create" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors">
              <PlusCircle className="h-4 w-4" />
              Create Proposal
            </Link>
            <Link href="/organizer/settings" className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 text-primary font-medium">
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
            <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
            <p className="text-muted-foreground">
              Manage your organizer profile and preferences
            </p>
          </div>

          {/* Profile Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Profile Information
              </CardTitle>
              <CardDescription>
                Update your organization's public profile
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input
                    id="displayName"
                    placeholder="Yayasan Amal Zakat"
                    value={profile.displayName}
                    onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    placeholder="https://yayasanamal.org"
                    value={profile.website}
                    onChange={(e) => setProfile({ ...profile, website: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  placeholder="Tell donors about your organization's mission..."
                  value={profile.bio}
                  onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="twitter">Twitter / X</Label>
                  <Input
                    id="twitter"
                    placeholder="@yayasanamal"
                    value={profile.twitter}
                    onChange={(e) => setProfile({ ...profile, twitter: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="telegram">Telegram</Label>
                  <Input
                    id="telegram"
                    placeholder="@yayasanamal_official"
                    value={profile.telegram}
                    onChange={(e) => setProfile({ ...profile, telegram: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveProfile}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Save Profile
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Notification Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notification Preferences
              </CardTitle>
              <CardDescription>
                Choose which notifications you want to receive
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { key: 'emailProposalUpdates', label: 'Proposal status updates', desc: 'Get notified when your proposal status changes' },
                { key: 'emailDonationAlerts', label: 'New donation alerts', desc: 'Receive alerts when someone donates to your campaigns' },
                { key: 'emailVotingReminders', label: 'Voting reminders', desc: 'Get reminded about upcoming and active votes' },
                { key: 'emailMilestoneDeadlines', label: 'Milestone deadlines', desc: 'Reminders for upcoming milestone deadlines' },
                { key: 'telegramNotifications', label: 'Telegram notifications', desc: 'Receive notifications via Telegram bot' },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between py-3 border-b last:border-0">
                  <div>
                    <div className="font-medium">{item.label}</div>
                    <div className="text-sm text-muted-foreground">{item.desc}</div>
                  </div>
                  <Switch
                    checked={notifications[item.key as keyof typeof notifications]}
                    onCheckedChange={(checked) =>
                      setNotifications({ ...notifications, [item.key]: checked })
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Security Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Security
              </CardTitle>
              <CardDescription>
                Manage your security settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b">
                <div>
                  <div className="font-medium">Organizer NFT Status</div>
                  <div className="text-sm text-muted-foreground">
                    Your verified organizer credential
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-600">Verified</span>
                </div>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">Wallet Address</div>
                  <div className="text-sm text-muted-foreground">
                    Your connected wallet address
                  </div>
                </div>
                <div className="text-sm font-mono bg-secondary px-3 py-1 rounded">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="text-red-600">Danger Zone</CardTitle>
              <CardDescription>
                Irreversible actions for your organizer account
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Organizer NFTs are soulbound and cannot be transferred. Your verification status
                  is permanently tied to this wallet address.
                </AlertDescription>
              </Alert>

              <div className="flex items-center justify-between py-3 border-b">
                <div>
                  <div className="font-medium">Deactivate Account</div>
                  <div className="text-sm text-muted-foreground">
                    Temporarily deactivate your organizer profile
                  </div>
                </div>
                <Button variant="outline" className="text-red-600 border-red-600 hover:bg-red-50">
                  Deactivate
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
