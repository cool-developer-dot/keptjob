import { cn } from "cn";
import { ThumbsUpIcon } from "lucide-react";
import Link from "next/link";

import { StageBadge } from "@/components/prospects/prospect-badges";
import { Badge } from "@/components/ui/badge";
import { attentionReasonLabel, type AttentionReason } from "@/lib/dashboard";
import { formatOrgDateTime, formatRelativeTime } from "@/lib/time";
import type { AttentionDealRow } from "@/server/data/dashboard";

import { SectionEmpty } from "./section-card";

const REASON_CLASSES: Record<AttentionReason, string> = {
  overdue_follow_up: "border-transparent bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  stale: "border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300",
  low_health: "border-red-300 text-red-700 dark:border-red-500/40 dark:text-red-300",
  no_follow_up: "text-muted-foreground",
};

/** Ranked open deals (overdue follow-up > stale > AI health low > no follow-up) with every reason. */
export function AttentionList({
  rows,
  names,
  showOwner,
  staleDays,
  timezone,
  now,
}: {
  rows: AttentionDealRow[];
  names: Record<string, string>;
  showOwner: boolean;
  staleDays: number;
  timezone: string;
  now: string;
}) {
  if (rows.length === 0) {
    return (
      <SectionEmpty
        icon={<ThumbsUpIcon />}
        title="No deals need attention"
        body="Every open deal has recent activity, a follow-up on time and no low AI health."
      />
    );
  }
  return (
    <ol className="-my-3 divide-y" aria-label="Deals needing attention, most urgent first">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
          data-prospect-id={row.id}
          data-attention-rank={row.rank}
        >
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/prospects/${row.id}`} className="font-medium underline-offset-4 hover:underline">
                {row.name}
              </Link>
              {row.company && <span className="text-sm text-muted-foreground">{row.company}</span>}
              <StageBadge stage={row.stage} />
              {showOwner && (
                <span className="text-xs text-muted-foreground">· {names[row.ownerId] ?? "Former user"}</span>
              )}
            </div>
            <ul className="flex flex-wrap gap-1.5" aria-label="Reasons">
              {row.reasons.map((reason) => (
                <li key={reason}>
                  <Badge variant="outline" data-reason={reason} className={cn(REASON_CLASSES[reason])}>
                    {attentionReasonLabel(reason, staleDays)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            Last activity{" "}
            <time dateTime={row.lastActivityAt} title={formatOrgDateTime(row.lastActivityAt, timezone)}>
              {formatRelativeTime(row.lastActivityAt, now)}
            </time>
          </p>
        </li>
      ))}
    </ol>
  );
}
