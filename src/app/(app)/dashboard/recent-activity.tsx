import { cn } from "cn";
import { HistoryIcon } from "lucide-react";
import Link from "next/link";

import { ACTIVITY_ICONS, ACTIVITY_TITLES, EntryDetail } from "@/components/timeline/activity-entry";
import { formatOrgDateTime, formatRelativeTime, timeZoneAbbreviation } from "@/lib/time";
import { buildTimeline, type TimelineUser } from "@/lib/timeline";
import type { RecentActivityRow } from "@/server/data/dashboard";

import { SectionEmpty } from "./section-card";

/** Last 15 activities on visible prospects, rendered like the prospect timeline (org-tz timestamps). */
export function RecentActivityFeed({
  rows,
  users,
  timezone,
  now,
}: {
  rows: RecentActivityRow[];
  users: TimelineUser[];
  timezone: string;
  now: string;
}) {
  if (rows.length === 0) {
    return (
      <SectionEmpty
        icon={<HistoryIcon />}
        title="No activity yet"
        body="Calls, notes, stage changes and completed follow-ups show up here."
      />
    );
  }
  const prospects = new Map(rows.map((row) => [`activity:${row.id}`, row.prospect]));
  const entries = buildTimeline({ activities: rows, users });

  return (
    <ol className="space-y-4" aria-label="Recent activity">
      {entries.map((entry) => {
        const Icon = ACTIVITY_ICONS[entry.type];
        const prospect = prospects.get(entry.key);
        const absolute = `${formatOrgDateTime(entry.at, timezone)} ${timeZoneAbbreviation(timezone, entry.at)}`;
        return (
          <li key={entry.key} className="flex gap-3" data-activity-type={entry.type}>
            <span
              aria-hidden
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground",
                entry.type === "ai_insight" && "text-violet-600 dark:text-violet-300",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm break-words">
                <span className="font-medium">{ACTIVITY_TITLES[entry.type]}</span>
                {prospect && (
                  <>
                    {" · "}
                    <Link href={`/prospects/${prospect.id}`} className="underline-offset-4 hover:underline">
                      {prospect.name}
                    </Link>
                  </>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className={cn(entry.isSystem && "italic")}>{entry.authorName}</span> ·{" "}
                <time dateTime={new Date(entry.at).toISOString()} title={absolute}>
                  {formatRelativeTime(entry.at, now)}
                </time>
                <span className="hidden sm:inline"> · {absolute}</span>
              </p>
              <EntryDetail entry={entry} />
              {entry.content && <p className="line-clamp-2 text-sm break-words text-foreground/80">{entry.content}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
