import { cn } from "cn";
import { CalendarCheckIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";

import { ObjectionChips, StageBadge } from "@/components/prospects/prospect-badges";
import { DEAL_HEALTH_LABELS } from "@/lib/constants";
import { dueRelativeLabel } from "@/lib/follow-ups";
import { initials } from "@/lib/pipeline";
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
    <ul className="flex flex-col gap-3" aria-label="Follow-ups due today or overdue">
      {rows.map((row) => (
        <li
          key={row.id}
          className="glass-tile group/row relative flex gap-3.5 rounded-2xl p-4 transition-colors hover:bg-white/90 dark:hover:bg-white/10"
          data-follow-up-id={row.id}
          data-bucket={row.bucket}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold shadow-[inset_0_1px_0_0_oklch(1_0_0/0.6)]",
              row.bucket === "overdue"
                ? "bg-[linear-gradient(135deg,oklch(0.9_0.06_25),oklch(0.85_0.08_10))] text-red-800"
                : "bg-[linear-gradient(135deg,oklch(0.93_0.07_85),oklch(0.88_0.09_70))] text-amber-900",
            )}
          >
            {initials(row.prospect.name)}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/prospects/${row.prospect.id}`}
                    className="font-semibold tracking-tight underline-offset-4 after:absolute after:inset-0 after:rounded-2xl hover:underline"
                  >
                    {row.prospect.name}
                  </Link>
                  {row.prospect.company && (
                    <span className="truncate text-sm text-muted-foreground">{row.prospect.company}</span>
                  )}
                </p>
                <p className="mt-0.5 text-sm break-words text-foreground/90">
                  <span className="sr-only">Follow-up: </span>
                  {row.note}
                </p>
              </div>
              <span
                title={formatDateString(row.dueDate)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                  row.bucket === "overdue"
                    ? "bg-red-500/12 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                    : "bg-amber-500/15 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
                )}
              >
                {dueRelativeLabel(row.dueDate, today)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <StageBadge stage={row.prospect.stage} />
              {row.prospect.objections.length > 0 && (
                <>
                  <span className="sr-only">Objections</span>
                  <ObjectionChips objections={row.prospect.objections} max={2} />
                </>
              )}
              {showOwner && <span className="ml-1">· {names[row.ownerId] ?? "Former user"}</span>}
            </div>

            <div className="[&_[data-snippet]>span]:line-clamp-1">
              <ConversationSnippetText conversation={row.lastConversation} timezone={timezone} now={now} />
            </div>

            {row.aiNextStep && (
              <p
                className="flex items-start gap-2 rounded-xl bg-[oklch(0.3_0.01_255/0.045)] px-3 py-2 text-xs text-foreground/90 ring-1 ring-[oklch(0.3_0.01_255/0.07)] dark:bg-white/5 dark:ring-white/10"
                data-ai-next-step
                title={formatOrgDateTime(row.aiNextStep.createdAt, timezone)}
              >
                <SparklesIcon aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                <span className="line-clamp-2 min-w-0 break-words">
                  <span className="font-semibold">AI next step</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {DEAL_HEALTH_LABELS[row.aiNextStep.dealHealth]} health
                  </span>
                  {" — "}
                  {row.aiNextStep.text}
                </span>
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
