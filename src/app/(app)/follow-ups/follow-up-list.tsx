"use client";

import { cn } from "cn";
import Link from "next/link";

import { CompleteFollowUpButton, RescheduleFollowUpButton } from "@/components/follow-ups/follow-up-actions";
import { useScheduleFollowUp } from "@/components/follow-ups/schedule-follow-up-dialog";
import { useOrgSettings } from "@/components/org-settings-provider";
import { StageBadge } from "@/components/prospects/prospect-badges";
import { dueRelativeLabel, type FollowUpListTab } from "@/lib/follow-ups";
import { formatDateString, formatOrgDateTime } from "@/lib/time";
import type { FollowUpListRow } from "@/server/data/follow-up-views";

import { ConversationSnippetText } from "./conversation-snippet";
import { FollowUpsEmptyState } from "./empty-state";

type Props = {
  tab: FollowUpListTab;
  rows: FollowUpListRow[];
  /** user id → full name (owner column, "completed by"). */
  names: Record<string, string>;
  showOwner: boolean;
  currentUserId: string;
  /** Org-local today and the server's "now" (stable across server/client render). */
  today: string;
  now: string;
};

/**
 * One tab of follow-ups. Pending rows: Complete (→ toast with "Schedule next
 * follow-up", which opens the dialog rendered here — above the rows, so it
 * survives the completed row disappearing) and Reschedule.
 */
export function FollowUpList({ tab, rows, names, showOwner, currentUserId, today, now }: Props) {
  const { timezone } = useOrgSettings();
  const { openScheduleFollowUp, dialog } = useScheduleFollowUp();

  return (
    <>
      {rows.length === 0 ? (
        <FollowUpsEmptyState tab={tab} />
      ) : (
        <ul aria-label={`${tab} follow-ups`} className="glass divide-y divide-[oklch(0.3_0.01_255/0.07)] overflow-hidden rounded-2xl dark:divide-white/5">
          {rows.map((row) => {
            const href = `/prospects/${row.prospect.id}`;
            const ownerName = names[row.ownerId] ?? "—";
            return (
              <li
                key={row.id}
                data-follow-up-id={row.id}
                className="grid gap-3 px-5 py-4 transition-colors hover:bg-white/45 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] md:items-start md:gap-5 dark:hover:bg-white/5"
              >
                <div className="min-w-0">
                  <Link
                    href={href}
                    className="block truncate font-semibold tracking-tight hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {row.prospect.name}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">{row.prospect.company ?? "—"}</p>
                  <StageBadge stage={row.prospect.stage} className="mt-1.5" />
                </div>

                <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:gap-4">
                  <div className="text-sm xl:w-40 xl:shrink-0">
                    {row.status === "completed" && row.completedAt ? (
                      <>
                        <p>
                          <span className="text-muted-foreground">Completed </span>
                          <time dateTime={row.completedAt}>{formatOrgDateTime(row.completedAt, timezone)}</time>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Due {formatDateString(row.dueDate)}
                          {row.completedBy &&
                            ` · by ${row.completedBy === currentUserId ? "you" : (names[row.completedBy] ?? "—")}`}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium">
                          <time dateTime={row.dueDate}>{formatDateString(row.dueDate)}</time>
                        </p>
                        <p
                          className={cn(
                            "text-xs",
                            row.bucket === "overdue" && "font-medium text-red-700 dark:text-red-300",
                            row.bucket === "today" && "font-medium text-amber-700 dark:text-amber-300",
                            row.bucket === "upcoming" && "text-muted-foreground",
                          )}
                        >
                          {dueRelativeLabel(row.dueDate, today)}
                        </p>
                      </>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm break-words">{row.note}</p>
                    <ConversationSnippetText conversation={row.lastConversation} timezone={timezone} now={now} />
                  </div>

                  {showOwner && (
                    <div className="text-sm xl:w-32 xl:shrink-0">
                      <span className="text-muted-foreground xl:hidden">Owner: </span>
                      <span data-owner>{ownerName}</span>
                    </div>
                  )}
                </div>

                {row.status === "pending" && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                    <CompleteFollowUpButton
                      followUp={{ id: row.id, note: row.note, due_date: row.dueDate }}
                      nextAction={{
                        label: "Schedule next follow-up",
                        onClick: () =>
                          openScheduleFollowUp(
                            { prospectId: row.prospect.id, prospectName: row.prospect.name },
                            { title: "Schedule next follow-up" },
                          ),
                      }}
                    />
                    <RescheduleFollowUpButton followUp={{ id: row.id, note: row.note, due_date: row.dueDate }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {dialog}
    </>
  );
}
