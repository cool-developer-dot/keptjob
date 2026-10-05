/**
 * Activity timeline list (server-safe, no hooks). Entries come from
 * buildTimeline() (src/lib/timeline.ts), newest first. Times are shown in the
 * org timezone with its abbreviation, plus a relative time.
 */
import { cn } from "cn";
import {
  ArrowRightIcon,
  ArrowRightLeftIcon,
  CalendarCheckIcon,
  CirclePlusIcon,
  MessagesSquareIcon,
  PhoneIcon,
  PresentationIcon,
  SparklesIcon,
  StickyNoteIcon,
  UserRoundCogIcon,
  type LucideIcon,
} from "lucide-react";

import { StageBadge } from "@/components/prospects/prospect-badges";
import { Badge } from "@/components/ui/badge";
import { ACTIVITY_TYPE_LABELS, DEAL_HEALTH_LABELS, type ActivityType } from "@/lib/constants";
import { formatDateString, formatOrgDateTime, formatRelativeTime, timeZoneAbbreviation } from "@/lib/time";
import type { TimelineEntry } from "@/lib/timeline";

const ICONS: Record<ActivityType | "created", LucideIcon> = {
  call: PhoneIcon,
  conversation: MessagesSquareIcon,
  note: StickyNoteIcon,
  demo: PresentationIcon,
  follow_up: CalendarCheckIcon,
  stage_change: ArrowRightLeftIcon,
  owner_change: UserRoundCogIcon,
  ai_insight: SparklesIcon,
  created: CirclePlusIcon,
};

const TITLES: Record<ActivityType | "created", string> = {
  ...ACTIVITY_TYPE_LABELS,
  follow_up: "Completed follow-up",
  ai_insight: "AI insight generated",
  created: "Prospect created",
};

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
  const Icon = ICONS[entry.type];
  const absolute = `${formatOrgDateTime(entry.at, timezone)} ${timeZoneAbbreviation(timezone, entry.at)}`;
  return (
    <li className="relative flex gap-3" data-activity-type={entry.type}>
      {!last && <span aria-hidden className="absolute top-9 bottom-[-1.25rem] left-4 w-px bg-border" />}
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground",
          entry.type === "ai_insight" && "text-violet-600 dark:text-violet-300",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 pt-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium">{TITLES[entry.type]}</span>
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

function EntryDetail({ entry }: { entry: TimelineEntry }) {
  const { detail } = entry;
  switch (detail.kind) {
    case "stage_change":
      return (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {detail.from ? <StageBadge stage={detail.from} /> : <span className="text-muted-foreground">—</span>}
          <ArrowRightIcon aria-label="to" className="size-3.5 text-muted-foreground" />
          {detail.to ? <StageBadge stage={detail.to} /> : <span className="text-muted-foreground">—</span>}
          {detail.closeReason && (
            <span className="text-muted-foreground">
              Reason: <span className="text-foreground">{detail.closeReason}</span>
            </span>
          )}
        </div>
      );
    case "owner_change":
      return (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span>{detail.fromName ?? "—"}</span>
          <ArrowRightIcon aria-label="to" className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{detail.toName ?? "—"}</span>
        </div>
      );
    case "follow_up": {
      const showTask = detail.task && detail.task !== entry.content;
      if (!showTask && !detail.dueDate) return null;
      return (
        <p className="text-sm text-muted-foreground">
          {showTask && <>Task: {detail.task}</>}
          {showTask && detail.dueDate && " · "}
          {detail.dueDate && <>Due {formatDateString(detail.dueDate)}</>}
        </p>
      );
    }
    case "ai_insight":
      return detail.dealHealth ? (
        <Badge variant="outline">Deal health: {DEAL_HEALTH_LABELS[detail.dealHealth]}</Badge>
      ) : null;
    case "created":
      return (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Started in <StageBadge stage={detail.stage} />
        </div>
      );
    default:
      return null;
  }
}
