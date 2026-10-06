import { SparklesIcon } from "lucide-react";
import Link from "next/link";

import { DealHealthBadge } from "@/components/prospects/prospect-badges";
import { formatOrgDateTime, formatRelativeTime } from "@/lib/time";
import type { AiRecommendationRow } from "@/server/data/dashboard";

import { SectionEmpty } from "@/components/section-card";

/** Latest AI next step per open prospect, newest insights first (generated manually on the prospect page). */
export function AiRecommendationsList({
  rows,
  timezone,
  now,
}: {
  rows: AiRecommendationRow[];
  timezone: string;
  now: string;
}) {
  if (rows.length === 0) {
    return (
      <SectionEmpty
        icon={<SparklesIcon />}
        title="No AI recommendations yet"
        body="Open a prospect and click “Generate AI Insights” to get a recommended next step."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Latest AI recommendations">
      {rows.map((row) => (
        <li
          key={row.insightId}
          className="glass-tile relative space-y-2 rounded-2xl p-3.5 transition-colors hover:bg-white/90 dark:hover:bg-white/10"
          data-prospect-id={row.prospect.id}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/prospects/${row.prospect.id}`}
              className="min-w-0 truncate text-sm font-semibold tracking-tight underline-offset-4 after:absolute after:inset-0 after:rounded-2xl hover:underline"
            >
              {row.prospect.name}
            </Link>
            <DealHealthBadge health={row.dealHealth} prefix="AI" />
          </div>
          <p className="line-clamp-3 text-sm break-words text-foreground/85">{row.nextStep}</p>
          <p className="text-xs text-muted-foreground">
            <time dateTime={row.createdAt} title={formatOrgDateTime(row.createdAt, timezone)}>
              {formatRelativeTime(row.createdAt, now)}
            </time>
            {row.prospect.company && <> · {row.prospect.company}</>}
          </p>
        </li>
      ))}
    </ul>
  );
}
