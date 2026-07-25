"use client";

import { Github } from "lucide-react";
import Link from "next/link"
import { useLanguage } from "@/components/providers/language-provider"

export function Footer() {
  const { t } = useLanguage()
  return (
    // Padding: 64px vertical per guidelines
    <footer className="bg-[#1A1A1A] text-white/80 pt-16 pb-8">
      <div className="container px-4 sm:px-6 mx-auto">

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8 md:gap-12 mb-12">

          {/* Logo + description */}
          <div className="col-span-2 lg:col-span-2 space-y-6">
             <Link href="/" className="flex items-baseline gap-2">
            <span className="font-serif text-3xl font-medium text-white">
              ZKT
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide-label text-white/60">
              by Tawf Foundation
            </span>
          </Link>

            <p className="text-white/80 max-w-sm leading-relaxed">
              {t("footer.description")}
            </p>

            {/* Social Icons - Hover to tawf-gold per guidelines.
                Only GitHub has a real destination; Twitter/LinkedIn/Instagram
                were href="#" placeholders and are omitted until accounts exist. */}
            <div className="flex gap-4">
              <a
                href="https://github.com/tawf-labs/zkt-hackathon"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ZKT on GitHub"
                className="text-white/70 hover:text-tawf-gold transition-colors"
              >
                <Github className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Platform Column */}
          <div className="space-y-4">
            <h3 className="font-serif font-bold text-lg text-white">{t("footer.platform")}</h3>
            <ul className="space-y-2">
              <li><a href="/campaigns" className="text-white/70 hover:text-tawf-gold transition-colors">{t("footer.exploreCampaigns")}</a></li>
              <li><a href="/zakat" className="text-white/70 hover:text-tawf-gold transition-colors">{t("header.zakat")}</a></li>
              <li><a href="/governance" className="text-white/70 hover:text-tawf-gold transition-colors">{t("footer.daoGovernance")}</a></li>
              {/* Impact reports live in the on-chain explorer until a dedicated
                  /impact page exists — this used to 404. */}
              <li><a href="/explorer" className="text-white/70 hover:text-tawf-gold transition-colors">{t("footer.impactReports")}</a></li>
            </ul>
          </div>

          {/* For Users Column */}
          <div className="space-y-4">
            <h3 className="font-serif font-bold text-lg text-white">{t("footer.forUsers")}</h3>
            <ul className="space-y-2">
              <li><a href="/dashboard/donor" className="text-white/70 hover:text-tawf-gold transition-colors">{t("footer.donorDashboard")}</a></li>
              {/* /my-donations does not exist; receipts live on the donor dashboard. */}
              <li><a href="/dashboard/donor" className="text-white/70 hover:text-tawf-gold transition-colors">{t("footer.myDonations")}</a></li>
            </ul>
          </div>

          {/* For Organizations Column */}
          <div className="space-y-4">
            <h3 className="font-serif font-bold text-lg text-white">{t("footer.forOrganizations")}</h3>
            <ul className="space-y-2">
              <li><a href="/partners" className="text-white/70 hover:text-tawf-gold transition-colors">{t("footer.becomePartner")}</a></li>
              <li><a href="/organizer" className="text-white/70 hover:text-tawf-gold transition-colors">{t("footer.organizationDashboard")}</a></li>
              {/* /verification and /resources do not exist; the verification
                  flow is the partner application itself. */}
              <li><a href="/organizer/apply" className="text-white/70 hover:text-tawf-gold transition-colors">{t("footer.verificationProcess")}</a></li>
            </ul>
          </div>

          {/* Legal column intentionally omitted: /privacy, /terms, /compliance
              and /audit have no page.tsx and returned 404. Restore this column
              once those routes exist rather than shipping dead links. */}

        </div>

        {/* Bottom Section */}
        <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-white/70">© 2026 Tawf Foundation. {t("footer.allRights")}</p>

          <div className="flex gap-6 text-sm text-white/70">
            <span>{t("footer.poweredBy")} Xellar</span>
            <span>{t("footer.awardBadge")}</span>
          </div>
        </div>

      </div>
    </footer>
  );
}
