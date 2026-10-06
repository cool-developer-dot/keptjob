/**
 * Kanban card body (presentational; also rendered inside the DragOverlay).
 * Name, company, owner initials (managers), next follow-up (Overdue / Today in
 * the org tz), decision-maker, stale and latest AI deal-health badges, deal value.
 */
import { cn } from "cn";
import { CalendarClockIcon } from "lucide-react";

import { DealHealthBadge, FollowUpBadge, StaleBadge } from "@/components/prospects/prospect-badges";
import { Badge } from "@/components/ui/badge";
import { DECISION_MAKER_STATUS_LABELS } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { initials, type PipelineCard } from "@/lib/pipeline";

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
  const showDm = card.decision_maker_status !== "unknown";
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight" title={card.name}>
            {card.name}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={card.company ?? undefined}>
            {card.company ?? "No company"}
          </p>
        </div>
        {ownerName !== null && (
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold bg-[linear-gradient(135deg,oklch(0.95_0.012_80),oklch(0.87_0.012_250))] text-[oklch(0.28_0.01_255)] shadow-[inset_0_1px_0_0_oklch(1_0_0/0.7),0_1px_2px_oklch(0.25_0.01_255/0.1)] dark:bg-[linear-gradient(135deg,oklch(0.4_0.006_255),oklch(0.3_0.006_255))] dark:text-white"
            title={`Owner: ${ownerName}`}
            aria-label={`Owner: ${ownerName}`}
            data-testid="owner-initials"
          >
            {initials(ownerName)}
          </span>
        )}
      </div>

      {(card.deal_value !== null || card.follow_up_date) && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 text-xs">
          <span className="font-semibold tabular-nums">
            {card.deal_value !== null ? formatMoney(card.deal_value, card.currency) : ""}
          </span>
          {card.follow_up_date && (
            <span className="inline-flex items-center gap-1 text-muted-foreground" title="Next follow-up">
              <CalendarClockIcon aria-hidden className="size-3.5" />
              <span className="sr-only">Next follow-up:</span>
              <FollowUpBadge dueDate={card.follow_up_date} timezone={timezone} now={now} />
            </span>
          )}
        </div>
      )}

      {(showDm || card.is_stale || card.ai_health) && (
        <div className="flex flex-wrap items-center gap-1 border-t border-[oklch(0.3_0.01_255/0.07)] pt-2.5 text-xs dark:border-white/5">
          {showDm && (
            <Badge
              variant="outline"
              className={cn(card.decision_maker_status === "no" && "text-muted-foreground")}
              title={`Decision maker: ${DECISION_MAKER_STATUS_LABELS[card.decision_maker_status]}`}
            >
              DM: {DECISION_MAKER_STATUS_LABELS[card.decision_maker_status]}
            </Badge>
          )}
          {card.is_stale && <StaleBadge staleDays={staleDays} />}
          {card.ai_health && <DealHealthBadge health={card.ai_health} prefix="AI" title="Latest AI deal health" />}
        </div>
      )}
    </div>
  );
}
