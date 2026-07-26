"use client";

import { Circle, CheckCircle2, Clock, Calendar } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";

interface JourneyItem {
  date: string;
  title: string;
  description: string;
  status: 'completed' | 'current' | 'upcoming';
}

interface JourneyTimelineProps {
  journey: JourneyItem[];
}

export function JourneyTimeline({ journey }: JourneyTimelineProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">{t("journey.title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("journey.subtitle")}
        </p>
      </div>

      <div className="relative">
        {/* Timeline Line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

        {/* Timeline Items */}
        <div className="space-y-6">
          {journey.map((item, index) => (
            <div key={index} className="relative pl-12">
              {/* Timeline Dot */}
              <div className="absolute left-0 top-0">
                {item.status === 'completed' ? (
                  <div className="h-8 w-8 rounded-full bg-green-500 flex items-center justify-center border-4 border-background">
                    <CheckCircle2 className="h-4 w-4 text-white" />
                  </div>
                ) : item.status === 'current' ? (
                  <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center border-4 border-background animate-pulse">
                    <Circle className="h-3 w-3 text-white fill-white" />
                  </div>
                ) : (
                  <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center border-4 border-background">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Card */}
              <div
                className={`
                  rounded-lg border p-4 transition-all
                  ${item.status === 'completed'
                    ? 'bg-card border-border opacity-75'
                    : item.status === 'current'
                    ? 'bg-primary/5 border-primary/30 shadow-sm'
                    : 'bg-card border-border opacity-50'
                  }
                `}
              >
                {/* Date Badge */}
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">{item.date}</span>
                  {item.status === 'current' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium">
                      {t("journey.current")}
                    </span>
                  )}
                  {item.status === 'upcoming' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs font-medium">
                      {t("journey.upcoming")}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h4 className={`font-semibold mb-1 ${
                  item.status === 'current' ? 'text-primary' : 'text-foreground'
                }`}>
                  {item.title}
                </h4>

                {/* Description */}
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="flex items-center justify-between text-sm pt-4 border-t border-border">
        <span className="text-muted-foreground">
          {t("journey.milestonesCompleted")
            .replace("{completed}", String(journey.filter(j => j.status === 'completed').length))
            .replace("{total}", String(journey.length))}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{t("journey.progress")}</span>
          <span className="font-bold text-primary">
            {Math.round((journey.filter(j => j.status === 'completed').length / journey.length) * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
