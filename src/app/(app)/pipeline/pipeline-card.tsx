/**
 * Kanban card body (presentational; also rendered inside the DragOverlay).
 * Name, company, owner initials (managers), next follow-up (Overdue / Today in
 * the org tz), decision-maker, stale and latest AI deal-health badges, deal value.
 */
import { cn } from "cn";
import { CalendarClockIcon, SparklesIcon } from "lucide-react";

import { FollowUpBadge, StaleBadge } from "@/components/prospects/prospect-badges";
import { Badge } from "@/components/ui/badge";
import { DEAL_HEALTH_LABELS, DECISION_MAKER_STATUS_LABELS, type DealHealth } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { initials, type PipelineCard } from "@/lib/pipeline";

const HEALTH_CLASSES: Record<DealHealth, string> = {
  high: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  medium: "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  low: "border-transparent bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

export function PipelineCardBody({
  card,
  ownerName,
  timezone,
  staleDays,
  now,
}: {
  card: PipelineCard;
  /** Managers only (owner initials); null for reps. */
  ownerName: string | null;
  timezone: string;
  staleDays: number;
  now: Date;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={card.name}>
            {card.name}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={card.company ?? undefined}>
            {card.company ?? "No company"}
          </p>
        </div>
        {ownerName !== null && (
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary"
            title={`Owner: ${ownerName}`}
            aria-label={`Owner: ${ownerName}`}
            data-testid="owner-initials"
          >
            {initials(ownerName)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        {card.follow_up_date && (
          <span className="inline-flex items-center gap-1" title="Next follow-up">
            <CalendarClockIcon aria-hidden className="size-3.5 text-muted-foreground" />
            <span className="sr-only">Next follow-up:</span>
            <FollowUpBadge dueDate={card.follow_up_date} timezone={timezone} now={now} />
          </span>
        )}
        <Badge
          variant="outline"
          className={cn(card.decision_maker_status === "unknown" && "text-muted-foreground")}
          title={`Decision maker: ${DECISION_MAKER_STATUS_LABELS[card.decision_maker_status]}`}
        >
          DM: {DECISION_MAKER_STATUS_LABELS[card.decision_maker_status]}
        </Badge>
        {card.is_stale && <StaleBadge staleDays={staleDays} />}
        {card.ai_health && (
          <Badge className={HEALTH_CLASSES[card.ai_health]} title="Latest AI deal health">
            <SparklesIcon aria-hidden />
            AI: {DEAL_HEALTH_LABELS[card.ai_health]}
          </Badge>
        )}
      </div>

      {card.deal_value !== null && (
        <p className="text-xs font-medium tabular-nums">{formatMoney(card.deal_value, card.currency)}</p>
      )}
    </div>
  );
}
