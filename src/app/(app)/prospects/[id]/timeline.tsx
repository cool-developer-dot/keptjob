/**
 * Activity timeline list (server-safe, no hooks). Entries come from
 * buildTimeline() (src/lib/timeline.ts), newest first. Times are shown in the
 * org timezone with its abbreviation, plus a relative time.
 */
import { cn } from "cn";

import { ACTIVITY_ICONS, ACTIVITY_TITLES, EntryDetail } from "@/components/timeline/activity-entry";
import { formatOrgDateTime, formatRelativeTime, timeZoneAbbreviation } from "@/lib/time";
import type { TimelineEntry } from "@/lib/timeline";

export function Timeline({ entries, timezone, now }: { entries: TimelineEntry[]; timezone: string; now: Date }) {
  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>;
  }
  return (
    <ol aria-label="Timeline" className="relative space-y-5">
      {entries.map((entry, index) => (
        <TimelineItem key={entry.key} entry={entry} timezone={timezone} now={now} last={index === entries.length - 1} />
      ))}
    </ol>
  );
}

function TimelineItem({
  entry,
  timezone,
  now,
  last,
}: {
  entry: TimelineEntry;
  timezone: string;
  now: Date;
  last: boolean;
}) {
  const Icon = ACTIVITY_ICONS[entry.type];
  const absolute = `${formatOrgDateTime(entry.at, timezone)} ${timeZoneAbbreviation(timezone, entry.at)}`;
  return (
    <li className="relative flex gap-3" data-activity-type={entry.type}>
      {!last && <span aria-hidden className="absolute top-9 bottom-[-1.25rem] left-4 w-px bg-border" />}
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border border-white/90 bg-white text-muted-foreground shadow-[0_1px_3px_oklch(0.25_0.01_255/0.1)] dark:border-white/10 dark:bg-[oklch(0.3_0.006_255)]",
          entry.type === "ai_insight" && "text-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 pt-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium">{ACTIVITY_TITLES[entry.type]}</span>
          <span className={cn("text-muted-foreground", entry.isSystem && "italic")}>by {entry.authorName}</span>
          <time dateTime={new Date(entry.at).toISOString()} title={absolute} className="text-xs text-muted-foreground">
            {absolute} · {formatRelativeTime(entry.at, now)}
          </time>
        </div>
        <EntryDetail entry={entry} />
        {entry.content && (
          <p className="text-sm break-words whitespace-pre-wrap text-foreground/90">{entry.content}</p>
        )}
      </div>
    </li>
  );
}
