"use client";

import Link from "next/link";
import { useSearch } from "../shared/SearchContext";
import { useCampaigns } from "@/hooks/useCampaigns";

export function SearchDropdown() {
  const { searchQuery, setIsSearchOpen } = useSearch();
  // Searches real on-chain campaign pools. This previously filtered the static
  // @/data/campaigns array, which made every actual campaign unfindable.
  const { campaigns, isLoading } = useCampaigns();

  if (!searchQuery) return null;

  const query = searchQuery.toLowerCase();
  const results = campaigns.filter(
    (c) =>
      c.title.toLowerCase().includes(query) ||
      c.organizationName?.toLowerCase().includes(query) ||
      c.category?.toLowerCase().includes(query)
  );

  return (
    <div className="absolute top-10 left-0 w-full bg-white border border-black rounded-md shadow-lg z-50">
      {isLoading && (
        <div className="px-4 py-3 text-sm text-gray-600">Searching campaigns…</div>
      )}

      {!isLoading && results.length === 0 && (
        <div className="px-4 py-3 text-sm text-gray-600">No results found.</div>
      )}

      {!isLoading &&
        results.slice(0, 5).map((item) => (
          <Link
            key={item.id}
            href={`/campaigns/${item.id}`}
            onClick={() => setIsSearchOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-gray-100"
          >
            {item.title}
          </Link>
        ))}
    </div>
  );
}
