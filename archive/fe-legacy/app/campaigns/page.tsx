"use client";

import { useState } from 'react';
import { Search, Filter, SlidersHorizontal, Loader2, X } from 'lucide-react';
import { useCampaigns } from '@/hooks/useCampaigns';
import { CampaignCard } from '@/components/shared/campaign-card';
import { useSearch } from "@/components/shared/SearchContext";
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetClose } from '@/components/ui/sheet';
import { useLanguage } from "@/components/providers/language-provider";

export default function ExploreCampaigns() {
  const { t } = useLanguage()
  const { searchQuery, setSearchQuery } = useSearch();
  const { campaigns, isLoading, error, refetch } = useCampaigns();
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Filter states
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedLocations, setSelectedLocations] = useState<string[]>([])
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([])

  // Calculate active filter count
  const activeFilterCount = selectedCategories.length + selectedLocations.length + selectedOrgs.length;

  // Sort state
  type SortOption = 'default' | 'raised' | 'endingSoon' | 'alphabetical' | 'mostDonors';
  const [sortBy, setSortBy] = useState<SortOption>('default');

  // Filter campaigns based on search query AND selected filters
  const filteredCampaigns = campaigns.filter((c) => {
    // Search query filter
    const matchesSearch = !searchQuery || (
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.organizationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Category filter
    const matchesCategory = selectedCategories.length === 0 || selectedCategories.includes(c.category);

    // Location filter
    const matchesLocation = selectedLocations.length === 0 || selectedLocations.includes(c.location);

    // Organization filter
    const matchesOrg = selectedOrgs.length === 0 || selectedOrgs.includes(c.organizationName);

    return matchesSearch && matchesCategory && matchesLocation && matchesOrg;
  });

  // Sort filtered campaigns
  const sortedCampaigns = [...filteredCampaigns].sort((a, b) => {
    switch (sortBy) {
      case 'raised':
        return b.raised - a.raised; // Most raised first
      case 'endingSoon':
        return a.daysLeft - b.daysLeft; // Fewest days first
      case 'alphabetical':
        return a.title.localeCompare(b.title);
      case 'mostDonors':
        return b.donors - a.donors; // Most donors first
      default:
        return 0; // Default order
    }
  });

  // Extract unique categories, locations, and organizations from real data
  const categories = [...new Set(campaigns.map(c => c.category))];
  const locations = [...new Set(campaigns.map(c => c.location))];
  const organizations = [...new Set(campaigns.map(c => c.organizationName))];

  return (
    <main className="flex-1 py-8 lg:py-12 bg-background">
      <div className="container px-4 mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("campaigns.explore")}</h1>
            <p className="text-muted-foreground">{t("campaigns.findAndSupport")} ({sortedCampaigns.length} {t("campaigns.campaignCount")})</p>
          </div>

          {/* Search and Filter */}
          <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
            <div className="relative flex-1 min-w-[140px] md:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t("campaigns.search")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-11"
              />
            </div>

            <Button
              onClick={() => refetch()}
              disabled={isLoading}
              variant="outline"
              size="icon"
              className="btn-touch-target h-11 w-11 lg:hidden shrink-0"
            >
              <Loader2 className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="sr-only">Refresh</span>
            </Button>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <SelectTrigger className="btn-touch-target w-full max-w-[140px] md:max-w-[180px] min-w-[120px] h-11">
                <SlidersHorizontal className="h-4 w-4 mr-1.5 shrink-0" />
                <SelectValue placeholder={t("campaigns.sort")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("campaigns.sortDefault")}</SelectItem>
                <SelectItem value="raised">{t("campaigns.sortRaised")}</SelectItem>
                <SelectItem value="endingSoon">{t("campaigns.sortEndingSoon")}</SelectItem>
                <SelectItem value="alphabetical">{t("campaigns.sortAlpha")}</SelectItem>
                <SelectItem value="mostDonors">{t("campaigns.sortDonors")}</SelectItem>
              </SelectContent>
            </Select>

            {/* Mobile Filter Button */}
            <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="default" className="btn-touch-target h-11 min-h-[44px] lg:hidden relative shrink-0">
                  <Filter className="h-4 w-4 mr-1.5" />
                  <span className="truncate">{t("campaigns.filters")}</span>
                  {activeFilterCount > 0 && (
                    <span className="ml-1.5 h-5 min-w-[20px] px-1.5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-full sm:w-[320px] p-0 overflow-y-auto">
                <SheetHeader className="p-4 border-b sticky top-0 bg-background z-10">
                  <div className="flex items-center justify-between">
                    <SheetTitle>{t("campaigns.filters")}</SheetTitle>
                    {activeFilterCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedCategories([]);
                          setSelectedLocations([]);
                          setSelectedOrgs([]);
                        }}
                        className="text-xs"
                      >
                        {t("campaigns.clearFilters")}
                      </Button>
                    )}
                  </div>
                </SheetHeader>

                <div className="p-4 space-y-6">
                  {/* Categories */}
                  <div>
                    <h3 className="font-semibold mb-4">{t("campaigns.categories")}</h3>
                    <div className="space-y-3">
                      {categories.length > 0 ? (
                        categories.map((cat) => (
                          <label key={cat} htmlFor={`mobile-cat-${cat}`} className="flex items-center space-x-3 tap-target-min cursor-pointer">
                            <Checkbox
                              id={`mobile-cat-${cat}`}
                              checked={selectedCategories.includes(cat)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedCategories([...selectedCategories, cat])
                                } else {
                                  setSelectedCategories(selectedCategories.filter(c => c !== cat))
                                }
                              }}
                              className="shrink-0"
                            />
                            <span className="text-sm font-medium py-3 select-none">
                              {cat}
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">{t("campaigns.noCategories")}</p>
                      )}
                    </div>
                  </div>

                  <div className="h-px w-full bg-border" />

                  {/* Locations */}
                  <div>
                    <h3 className="font-semibold mb-4">{t("campaigns.location")}</h3>
                    <div className="space-y-3">
                      {locations.length > 0 ? (
                        locations.map((loc) => (
                          <label key={loc} htmlFor={`mobile-loc-${loc}`} className="flex items-center space-x-3 tap-target-min cursor-pointer">
                            <Checkbox
                              id={`mobile-loc-${loc}`}
                              checked={selectedLocations.includes(loc)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedLocations([...selectedLocations, loc])
                                } else {
                                  setSelectedLocations(selectedLocations.filter(l => l !== loc))
                                }
                              }}
                              className="shrink-0"
                            />
                            <span className="text-sm font-medium py-3 select-none">
                              {loc}
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">{t("campaigns.noLocations")}</p>
                      )}
                    </div>
                  </div>

                  <div className="h-px w-full bg-border" />

                  {/* Organizations */}
                  <div>
                    <h3 className="font-semibold mb-4">{t("campaigns.organization")}</h3>
                    <div className="space-y-3">
                      {organizations.length > 0 ? (
                        organizations.map((org) => (
                          <label key={org} htmlFor={`mobile-org-${org}`} className="flex items-center space-x-3 tap-target-min cursor-pointer">
                            <Checkbox
                              id={`mobile-org-${org}`}
                              checked={selectedOrgs.includes(org)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedOrgs([...selectedOrgs, org])
                                } else {
                                  setSelectedOrgs(selectedOrgs.filter(o => o !== org))
                                }
                              }}
                              className="shrink-0"
                            />
                            <span className="text-sm font-medium py-3 select-none">
                              {org}
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">{t("campaigns.noOrganizations")}</p>
                      )}
                    </div>
                  </div>

                  {/* Apply and Close Button */}
                  <SheetClose asChild>
                    <Button className="btn-touch-target w-full mt-4">
                      {activeFilterCount > 0
                        ? `${t("campaigns.applyFilters")} (${activeFilterCount})`
                        : t("common.close")}
                    </Button>
                  </SheetClose>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-8">

          {/* Sidebar Filters */}
          <aside className="hidden lg:block space-y-6">
            {/* Categories */}
            <div>
              <h3 className="font-semibold mb-4">{t("campaigns.categories")}</h3>
              <div className="space-y-3">
                {categories.length > 0 ? (
                  categories.map((cat) => (
                    <label key={cat} htmlFor={`cat-${cat}`} className="flex items-center space-x-2 cursor-pointer">
                      <Checkbox
                        id={`cat-${cat}`}
                        checked={selectedCategories.includes(cat)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedCategories([...selectedCategories, cat])
                          } else {
                            setSelectedCategories(selectedCategories.filter(c => c !== cat))
                          }
                        }}
                        className="shrink-0"
                      />
                      <span className="text-sm font-medium cursor-pointer select-none">
                        {cat}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">{t("campaigns.noCategories")}</p>
                )}
              </div>
            </div>

            <div className="h-px w-full bg-border" />

            {/* Locations */}
            <div>
              <h3 className="font-semibold mb-4">{t("campaigns.location")}</h3>
              <div className="space-y-3">
                {locations.length > 0 ? (
                  locations.map((loc) => (
                    <label key={loc} htmlFor={`loc-${loc}`} className="flex items-center space-x-2 cursor-pointer">
                      <Checkbox
                        id={`loc-${loc}`}
                        checked={selectedLocations.includes(loc)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedLocations([...selectedLocations, loc])
                          } else {
                            setSelectedLocations(selectedLocations.filter(l => l !== loc))
                          }
                        }}
                        className="shrink-0"
                      />
                      <span className="text-sm font-medium cursor-pointer select-none">
                        {loc}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">{t("campaigns.noLocations")}</p>
                )}
              </div>
            </div>

            <div className="h-px w-full bg-border" />

            {/* Organizations */}
            <div>
              <h3 className="font-semibold mb-4">{t("campaigns.organization")}</h3>
              <div className="space-y-3">
                {organizations.length > 0 ? (
                  organizations.map((org) => (
                    <label key={org} htmlFor={`org-${org}`} className="flex items-center space-x-2 cursor-pointer">
                      <Checkbox
                        id={`org-${org}`}
                        checked={selectedOrgs.includes(org)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedOrgs([...selectedOrgs, org])
                          } else {
                            setSelectedOrgs(selectedOrgs.filter(o => o !== org))
                          }
                        }}
                        className="shrink-0"
                      />
                      <span className="text-sm font-medium cursor-pointer select-none">
                        {org}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">{t("campaigns.noOrganizations")}</p>
                )}
              </div>
            </div>

            {/* Clear Filters Button - only show when filters are applied */}
            {(selectedCategories.length > 0 || selectedLocations.length > 0 || selectedOrgs.length > 0) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedCategories([]);
                  setSelectedLocations([]);
                  setSelectedOrgs([]);
                }}
                className="w-full"
              >
                {t("campaigns.clearFilters")}
              </Button>
            )}
          </aside>

          {/* Campaign Grid */}
          <div className="lg:col-span-3">
            {/* Loading State */}
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="space-y-4">
                    <Skeleton className="h-48 w-full rounded-lg" />
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12">
                <p className="text-red-500 font-semibold mb-4">{t("campaigns.error")}</p>
                <p className="text-muted-foreground mb-4">{error.message}</p>
                <Button onClick={() => refetch()}>
                  {t("campaigns.retry")}
                </Button>
              </div>
            ) : sortedCampaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground">{t("campaigns.noResults")}</p>
                {searchQuery && (
                  <Button
                    onClick={() => setSearchQuery('')}
                    variant="outline"
                    className="mt-4"
                  >
                    {t("campaigns.clearSearch")}
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {sortedCampaigns.map((campaign, index) => (
                    <CampaignCard
                      key={campaign.id}
                      campaign={campaign}
                      priority={index < 3}  // Priority for first 3 above-the-fold cards
                      onDonationSuccess={() => {
                        setTimeout(() => refetch(), 1000); // Delay to ensure Supabase is updated
                      }}
                    />
                  ))}
                </div>

                {/* Load More */}
                <div className="mt-12 flex justify-center">
                  <Button variant="outline" size="default" className="w-full sm:w-auto">
                    {t("campaigns.loadMore")}
                  </Button>
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </main>
  );
}
