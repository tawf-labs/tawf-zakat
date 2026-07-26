"use client";

import Image from "next/image";
import { Quote, Shield } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";

interface OrganizerMessageProps {
  name: string;
  role: string;
  photo: string;
  message: string;
  verified: boolean;
  organizationName: string;
}

export function OrganizerMessage({
  name,
  role,
  photo,
  message,
  verified,
  organizationName,
}: OrganizerMessageProps) {
  const { t } = useLanguage();

  return (
    <div className="bg-card border border-primary/20 rounded-xl p-6 lg:p-8">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Photo */}
        <div className="flex-shrink-0">
          <div className="relative w-24 h-24 lg:w-32 lg:h-32 rounded-full overflow-hidden border-4 border-background shadow-lg">
            <Image
              src={photo}
              alt={name}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 96px, 128px"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4">
          {/* Header */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xl font-bold text-foreground">{t("organizer.message")}</h3>
              {verified && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-600 text-xs font-medium">
                  <Shield className="h-3 w-3" />
                  {t("campaign.verified")}
                </span>
              )}
            </div>
            <div>
              <p className="font-semibold text-foreground">{name}</p>
              <p className="text-sm text-muted-foreground">
                {role} &bull; {organizationName}
              </p>
            </div>
          </div>

          {/* Quote */}
          <div className="relative">
            <Quote className="absolute -top-2 -left-2 h-8 w-8 text-primary/20" />
            <blockquote className="relative pl-6 italic text-foreground/90 leading-relaxed">
              {message}
            </blockquote>
          </div>

          {/* Organization Badge */}
          <div className="flex items-center gap-2 pt-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-xs font-bold text-primary">
                {organizationName.charAt(0)}
              </span>
            </div>
            <span className="text-sm font-medium text-foreground">{organizationName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
