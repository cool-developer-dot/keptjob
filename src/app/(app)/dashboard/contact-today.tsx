import { cn } from "cn";
import { CalendarCheckIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";

import { ObjectionChips, StageBadge } from "@/components/prospects/prospect-badges";
import { Badge } from "@/components/ui/badge";
import { DEAL_HEALTH_LABELS } from "@/lib/constants";
import { dueRelativeLabel } from "@/lib/follow-ups";
import { formatDateString, formatOrgDateTime, type DateString } from "@/lib/time";
import type { ContactTodayRow } from "@/server/data/dashboard";

import { ConversationSnippetText } from "../follow-ups/conversation-snippet";
import { SectionEmpty } from "@/components/section-card";

/**
 * "Contact today" rows: who to contact (overdue + due today, most overdue
 * first), the follow-up task, main objections, last conversation and the
 * latest AI next step (SPEC §1.1–1.5).
 */
export function ContactTodayList({
  rows,
  names,
  showOwner,
  today,
  timezone,
  now,
}: {
  rows: ContactTodayRow[];
  names: Record<string, string>;
  showOwner: boolean;
  today: DateString;
  timezone: string;
  now: string;
}) {
  if (rows.length === 0) {
    return (
      <SectionEmpty
        icon={<CalendarCheckIcon />}
        title="No one to chase today"
        body="Follow-ups due today or overdue (org timezone) show up here."
      />
    );
  }
  return (
    <ul className="-my-3 divide-y" aria-label="Follow-ups due today or overdue">
      {rows.map((row) => (
        <li key={row.id} className="space-y-2 py-3" data-follow-up-id={row.id} data-bucket={row.bucket}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/prospects/${row.prospect.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.prospect.name}
            </Link>
            {row.prospect.company && <span className="text-sm text-muted-foreground">{row.prospect.company}</span>}
            <StageBadge stage={row.prospect.stage} />
            <Badge
              title={formatDateString(row.dueDate)}
              className={cn(
                "border-transparent",
                row.bucket === "overdue"
                  ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                  : "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
              )}
            >
              {dueRelativeLabel(row.dueDate, today)}
            </Badge>
            {showOwner && (
              <span className="text-xs text-muted-foreground">· {names[row.ownerId] ?? "Former user"}</span>
            )}
          </div>
          <p className="text-sm break-words">
            <span className="text-muted-foreground">Follow-up:</span> {row.note}
          </p>
          {row.prospect.objections.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Objections <ObjectionChips objections={row.prospect.objections} max={3} />
            </div>
          )}
          <ConversationSnippetText conversation={row.lastConversation} timezone={timezone} now={now} />
          {row.aiNextStep && (
            <p className="flex items-start gap-1.5 text-xs" data-ai-next-step>
              <SparklesIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
              <span className="min-w-0 break-words">
                <span className="font-medium">AI next step</span>{" "}
                <span className="text-muted-foreground" title={formatOrgDateTime(row.aiNextStep.createdAt, timezone)}>
                  ({DEAL_HEALTH_LABELS[row.aiNextStep.dealHealth]} health)
                </span>
                : {row.aiNextStep.text}
              </span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
