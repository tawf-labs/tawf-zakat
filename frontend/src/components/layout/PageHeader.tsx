import React from "react";
import { Container } from "./Container";
import { Badge } from "../ui/Badge";

interface PageHeaderProps {
  badgeText?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({
  badgeText,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <div className="relative overflow-hidden border-b border-[#dbe7dd] bg-gradient-to-b from-[#f4f8f3] via-white to-white py-10 sm:py-14">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(45rem_20rem_at_50%_0%,rgba(196,237,112,0.18),transparent)]" />
      <Container>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-2xl">
            {badgeText && (
              <Badge variant="sharia" className="mb-3">
                {badgeText}
              </Badge>
            )}
            <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-[#17332c]">
              {title}
            </h1>
            {description && (
              <p className="mt-3 text-base text-[#5e7a70] leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
        </div>
      </Container>
    </div>
  );
}
