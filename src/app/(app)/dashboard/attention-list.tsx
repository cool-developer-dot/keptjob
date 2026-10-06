import { cn } from "cn";
import { ThumbsUpIcon } from "lucide-react";
import Link from "next/link";

import { StageBadge } from "@/components/prospects/prospect-badges";
import { Badge } from "@/components/ui/badge";
import { attentionReasonLabel, type AttentionReason } from "@/lib/dashboard";
import { formatOrgDateTime, formatRelativeTime } from "@/lib/time";
import type { AttentionDealRow } from "@/server/data/dashboard";

import { SectionEmpty } from "@/components/section-card";

const REASON_CLASSES: Record<AttentionReason, string> = {
  overdue_follow_up: "border-transparent bg-red-500/12 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  stale: "border-transparent bg-amber-500/14 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  low_health: "border-transparent bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  no_follow_up: "border-transparent bg-slate-500/10 text-slate-600 dark:bg-white/10 dark:text-slate-300",
};

const RANK_DOT: Record<number, string> = {
  1: "bg-red-500 shadow-[0_0_0_4px_oklch(0.64_0.21_25/0.15)]",
  2: "bg-amber-500 shadow-[0_0_0_4px_oklch(0.77_0.16_70/0.18)]",
  3: "bg-rose-400 shadow-[0_0_0_4px_oklch(0.7_0.17_10/0.15)]",
  4: "bg-slate-400 shadow-[0_0_0_4px_oklch(0.6_0.01_255/0.12)]",
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
    <ol
      className="-my-2 divide-y divide-[oklch(0.3_0.01_255/0.07)] dark:divide-white/5"
      aria-label="Deals needing attention, most urgent first"
    >
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex gap-3.5 py-3.5"
          data-prospect-id={row.id}
          data-attention-rank={row.rank}
        >
          <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", RANK_DOT[row.rank] ?? RANK_DOT[4])} />
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/prospects/${row.id}`} className="font-semibold tracking-tight underline-offset-4 hover:underline">
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
          </div>
        </li>
      ))}
    </ol>
  );
}
