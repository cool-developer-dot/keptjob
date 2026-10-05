"use client";

import { AlertTriangleIcon, CalendarPlusIcon, ClockIcon } from "lucide-react";
import Link from "next/link";

import { useScheduleFollowUp } from "@/components/follow-ups/schedule-follow-up-dialog";
import { useOrgSettings } from "@/components/org-settings-provider";
import { FollowUpBadge, StageBadge } from "@/components/prospects/prospect-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { needsAttentionReasonLabel } from "@/lib/follow-ups";
import { formatOrgDateTime, formatRelativeTime } from "@/lib/time";
import type { NeedsAttentionRow } from "@/server/data/follow-up-views";

import { ConversationSnippetText } from "./conversation-snippet";
import { FollowUpsEmptyState } from "./empty-state";

const REASON_CLASSES = {
  stale: "border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300",
  no_follow_up: "border-red-300 text-red-800 dark:border-red-500/40 dark:text-red-300",
} as const;

/**
 * Open deals that are stale (no human activity for stale_days) or have no
 * pending follow-up, least recently active first, with the reason(s).
 * A warning only (SPEC §9.6): nothing changes automatically.
 */
export function NeedsAttentionList({
  rows,
  total,
  names,
  showOwner,
  now,
}: {
  rows: NeedsAttentionRow[];
  total: number;
  names: Record<string, string>;
  showOwner: boolean;
  now: string;
}) {
  const { timezone, staleDays } = useOrgSettings();
  const { openScheduleFollowUp, dialog } = useScheduleFollowUp();

  return (
    <>
      {rows.length === 0 ? (
        <FollowUpsEmptyState tab="attention" />
      ) : (
        <>
          {total > rows.length && (
            <p role="status" className="mb-3 text-sm text-muted-foreground">
              Showing the {rows.length} least recently active of {total} deals.
            </p>
          )}
          <ul aria-label="Deals that need attention" className="divide-y rounded-lg border">
            {rows.map((row) => (
              <li
                key={row.id}
                data-prospect-id={row.id}
                className="grid gap-3 p-4 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] md:items-start md:gap-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/prospects/${row.id}`}
                    className="block truncate font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {row.name}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">{row.company ?? "—"}</p>
                  <StageBadge stage={row.stage} className="mt-1.5" />
                </div>

                <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:gap-4">
                  <div className="space-y-1.5 text-sm xl:w-52 xl:shrink-0">
                    <ul aria-label="Reasons" className="flex flex-wrap gap-1">
                      {row.reasons.map((reason) => (
                        <li key={reason}>
                          <Badge variant="outline" data-reason={reason} className={REASON_CLASSES[reason]}>
                            {reason === "stale" ? <ClockIcon aria-hidden /> : <AlertTriangleIcon aria-hidden />}
                            {needsAttentionReasonLabel(reason, staleDays)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      Last activity{" "}
                      <time dateTime={row.lastActivityAt} title={formatOrgDateTime(row.lastActivityAt, timezone)}>
                        {formatRelativeTime(row.lastActivityAt, now)}
                      </time>
                    </p>
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="flex items-center gap-1.5 text-sm">
                      <span className="text-muted-foreground">Next follow-up:</span>
                      {row.followUpDate ? (
                        <FollowUpBadge dueDate={row.followUpDate} timezone={timezone} now={new Date(now)} />
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </p>
                    <ConversationSnippetText conversation={row.lastConversation} timezone={timezone} now={now} />
                  </div>

                  {showOwner && (
                    <div className="text-sm xl:w-32 xl:shrink-0">
                      <span className="text-muted-foreground xl:hidden">Owner: </span>
                      <span data-owner>{names[row.ownerId] ?? "—"}</span>
                    </div>
                  )}
                </div>

                <div className="shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Add follow-up for ${row.name}`}
                    onClick={() => openScheduleFollowUp({ prospectId: row.id, prospectName: row.name })}
                  >
                    <CalendarPlusIcon aria-hidden />
                    Add follow-up
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {dialog}
    </>
  );
}
