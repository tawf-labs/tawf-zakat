"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { useSearch } from "@/components/shared/SearchContext";
import { SearchDropdown } from "@/components/shared/SearchDropdown";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { useLanguage } from "@/components/providers/language-provider";
import { Sheet, SheetContent, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";

export function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { searchQuery, setSearchQuery, isSearchOpen, setIsSearchOpen } =
    useSearch();
  const { language, setLanguage, t } = useLanguage();

  const handleEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setIsSearchOpen(false);
      window.location.href = `/campaigns?search=${encodeURIComponent(
        searchQuery
      )}`;
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-primary/10 bg-[#F9F6F0]/95 backdrop-blur-lg shadow-sm">
      {/* Height: 80px per guidelines */}
      <div className="container mx-auto flex h-20 items-center justify-between px-4 sm:px-6 lg:px-8">

        {/* LEFT */}
        <div className="flex items-center gap-4 lg:gap-8">
          <Link href="/" className="flex items-center gap-1.5 shrink-0">
            {/* Primary brand: ZKT. Serif per guidelines, scaled up from 24px
                so it leads the hierarchy. Tawf sits below as the ecosystem. */}
            <span className="font-serif text-2xl lg:text-3xl font-medium leading-none text-primary">ZKT</span>
            <span className="w-2 h-2 rounded-full bg-secondary self-start mt-1.5"></span>
            <span className="hidden sm:inline ml-1 text-[10px] font-medium uppercase tracking-wide-label text-muted-foreground leading-none">
              by Tawf<br />Foundation
            </span>
          </Link>

          {/* Nav links: Uppercase, wide tracking (0.2em), 14px per guidelines */}
          <nav className="hidden md:flex items-center gap-4 lg:gap-6 text-xs font-medium uppercase tracking-wide-label shrink-0">
            <Link href="/campaigns" className="relative text-foreground hover:text-primary transition-colors after:content-[''] after:absolute after:-bottom-1 after:left-0 after:w-0 after:h-0.5 after:bg-primary after:transition-all hover:after:w-full">{t("header.campaigns")}</Link>
            <Link href="/governance" className="relative text-foreground hover:text-primary transition-colors after:content-[''] after:absolute after:-bottom-1 after:left-0 after:w-0 after:h-0.5 after:bg-primary after:transition-all hover:after:w-full">{t("header.governance")}</Link>
            <Link href="/explorer" className="relative text-foreground hover:text-primary transition-colors after:content-[''] after:absolute after:-bottom-1 after:left-0 after:w-0 after:h-0.5 after:bg-primary after:transition-all hover:after:w-full">{t("header.explorer")}</Link>
          </nav>
        </div>

        {/* RIGHT */}
        <div className="flex items-center gap-2 lg:gap-3 shrink-0">

          {/* SEARCH BAR - Only on XL screens to prevent overcrowding */}
          <div className="relative hidden xl:block w-48 2xl:w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

            <input
              type="search"
              placeholder={t("header.search")}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              onKeyDown={handleEnter}
              className="w-full pl-9 pr-3 h-9 bg-white/70 border border-primary/20 rounded-full outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all text-xs"
            />

            {/* DROPDOWN */}
            {isSearchOpen && searchQuery && <SearchDropdown />}
          </div>

          {/* Language Toggle */}
          <div className="hidden md:flex items-center gap-0.5 border border-primary/10 rounded-full p-0.5 bg-white/50 shrink-0">
            <button
              onClick={() => setLanguage("id")}
              className={`btn-touch-target px-2.5 py-1 rounded-full text-[11px] font-medium uppercase tracking-wide-label transition-all ${
                language === "id"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground hover:bg-white/50"
              }`}
            >
              ID
            </button>
            <button
              onClick={() => setLanguage("en")}
              className={`btn-touch-target px-2.5 py-1 rounded-full text-[11px] font-medium uppercase tracking-wide-label transition-all ${
                language === "en"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground hover:bg-white/50"
              }`}
            >
              EN
            </button>
          </div>

          {/* Start Campaign - Show on XL screens */}
          <Link href="/organizer" className="hidden xl:flex items-center gap-1.5 border border-primary/20 h-9 px-4 rounded-full hover:bg-primary hover:text-primary-foreground transition-all text-xs font-medium uppercase tracking-wide-label whitespace-nowrap shrink-0">
            {t("header.start_campaign")}
          </Link>

          <ConnectWalletButton />

          {/* Mobile Menu Sheet */}
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <button className="md:hidden size-11 flex items-center justify-center rounded-full hover:bg-accent transition-colors" aria-label="Open menu">
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] sm:w-[320px] p-0">
              <div className="flex flex-col h-full">
                {/* Mobile Menu Header */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-xl font-medium text-primary">ZKT</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide-label text-muted-foreground">
                      by Tawf Foundation
                    </span>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-secondary"></span>
                </div>

                {/* Mobile Search */}
                <div className="p-4 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="search"
                      placeholder={t("header.search")}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          setIsMobileMenuOpen(false);
                          window.location.href = `/campaigns?search=${encodeURIComponent(searchQuery)}`;
                        }
                      }}
                      className="w-full pl-10 h-11 bg-background border-border"
                    />
                  </div>
                </div>

                {/* Navigation Links */}
                <nav className="flex flex-col p-4 gap-1">
                  <SheetClose asChild>
                    <Link href="/campaigns" className="btn-touch-target flex items-center px-4 py-3.5 text-base font-medium rounded-lg hover:bg-accent transition-colors">
                      {t("header.campaigns")}
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link href="/governance" className="btn-touch-target flex items-center px-4 py-3.5 text-base font-medium rounded-lg hover:bg-accent transition-colors">
                      {t("header.governance")}
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link href="/explorer" className="btn-touch-target flex items-center px-4 py-3.5 text-base font-medium rounded-lg hover:bg-accent transition-colors">
                      {t("header.explorer")}
                    </Link>
                  </SheetClose>
                </nav>

                {/* Start Campaign Button */}
                <div className="px-4 py-2 border-t border-border">
                  <SheetClose asChild>
                    <Link href="/organizer" className="btn-touch-target flex items-center justify-center gap-2 border border-primary/20 h-12 px-6 rounded-full hover:bg-primary hover:text-primary-foreground transition-all text-xs font-medium uppercase tracking-wide-label">
                      {t("header.start_campaign")}
                    </Link>
                  </SheetClose>
                </div>

                {/* Language Toggle */}
                <div className="mt-auto p-4 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wide-label">Language</p>
                  <div className="flex items-center gap-1 border border-primary/10 rounded-full p-1 bg-background">
                    <button
                      onClick={() => setLanguage("id")}
                      className={`btn-touch-target flex-1 py-2.5 rounded-full text-xs font-medium uppercase tracking-wide-label transition-all ${
                        language === "id"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-foreground/60 hover:text-foreground"
                      }`}
                    >
                      ID
                    </button>
                    <button
                      onClick={() => setLanguage("en")}
                      className={`btn-touch-target flex-1 py-2.5 rounded-full text-xs font-medium uppercase tracking-wide-label transition-all ${
                        language === "en"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-foreground/60 hover:text-foreground"
                      }`}
                    >
                      EN
                    </button>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
