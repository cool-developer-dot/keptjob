/**
 * Small, server-safe display pieces for prospects, shared by the list (Prompt 7),
 * detail page (8), Kanban (9) and follow-ups (10). No hooks: pass the org
 * timezone explicitly (getOrgSettings() on the server, useOrgSettings() on the client).
 */
import { cn } from "cn";
import { AlertTriangleIcon, ClockIcon, SparklesIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  DEAL_HEALTH_LABELS,
  DECISION_MAKER_STATUS_LABELS,
  OBJECTION_LABELS,
  STAGE_LABELS,
  type DealHealth,
  type DecisionMakerStatus,
  type ObjectionCategory,
  type PipelineStage,
} from "@/lib/constants";
import { followUpBucket, formatDateString, type DateString } from "@/lib/time";

const STAGE_CLASSES: Partial<Record<PipelineStage, string>> = {
  closed_won:
    "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  closed_lost: "border-transparent bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

/** Pipeline stage pill (closed won green, closed lost red, open stages neutral). */
export function StageBadge({ stage, className }: { stage: PipelineStage; className?: string }) {
  return (
    <Badge variant="secondary" data-stage={stage} className={cn(STAGE_CLASSES[stage], className)}>
      {STAGE_LABELS[stage]}
    </Badge>
  );
}

const OVERDUE_CLASSES = "border-transparent bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300";
const TODAY_CLASSES =
  "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300";

/**
 * Next follow-up date with a red "Overdue" / amber "Today" badge, bucketed in
 * the org timezone (followUpBucket). For pending follow-ups only. null → "—".
 */
export function FollowUpBadge({
  dueDate,
  timezone,
  now,
  className,
}: {
  dueDate: DateString | null;
  timezone: string;
  now?: Date;
  className?: string;
}) {
  if (!dueDate) return <span className="text-muted-foreground">—</span>;
  const bucket = followUpBucket(dueDate, timezone, now);
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      {bucket === "overdue" && <Badge className={OVERDUE_CLASSES}>Overdue</Badge>}
      {bucket === "today" && <Badge className={TODAY_CLASSES}>Today</Badge>}
      {bucket !== "today" && (
        <span className={cn(bucket === "overdue" && "text-red-700 dark:text-red-300")}>
          {formatDateString(dueDate)}
        </span>
      )}
    </span>
  );
}

/** "Stale" warning (open deal with no human activity for stale_days; SPEC §9.6). */
export function StaleBadge({ staleDays, className }: { staleDays?: number; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300", className)}
      title={staleDays ? `No activity for ${staleDays}+ days` : "No recent activity"}
    >
      <ClockIcon aria-hidden />
      Stale
    </Badge>
  );
}

/** "Overdue" pill without a date (e.g. Kanban cards). */
export function OverdueBadge({ className }: { className?: string }) {
  return (
    <Badge className={cn(OVERDUE_CLASSES, className)}>
      <AlertTriangleIcon aria-hidden />
      Overdue
    </Badge>
  );
}

/** Objection chips; with `max`, extra ones collapse into "+N" (full list in the title). */
export function ObjectionChips({
  objections,
  max,
  className,
}: {
  objections: readonly ObjectionCategory[];
  max?: number;
  className?: string;
}) {
  if (objections.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = max === undefined ? objections : objections.slice(0, max);
  const hidden = objections.length - shown.length;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {shown.map((objection) => (
        <Badge key={objection} variant="outline">
          {OBJECTION_LABELS[objection]}
        </Badge>
      ))}
      {hidden > 0 && (
        <Badge
          variant="outline"
          className="text-muted-foreground"
          title={objections.map((o) => OBJECTION_LABELS[o]).join(", ")}
        >
          +{hidden}
        </Badge>
      )}
    </span>
  );
}

/** Decision-maker status as text (Yes / No / Unknown, unknown muted). */
export function DecisionMakerLabel({ status }: { status: DecisionMakerStatus }) {
  return (
    <span className={cn(status === "unknown" && "text-muted-foreground")}>
      {DECISION_MAKER_STATUS_LABELS[status]}
    </span>
  );
}

const HEALTH_CLASSES: Record<DealHealth, string> = {
  high: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  medium: "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  low: "border-transparent bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

/** AI deal health pill (high green, medium amber, low red), e.g. "AI: High" on Kanban cards. */
export function DealHealthBadge({
  health,
  prefix = "Deal health",
  title,
  className,
}: {
  health: DealHealth;
  prefix?: string;
  title?: string;
  className?: string;
}) {
  return (
    <Badge className={cn(HEALTH_CLASSES[health], className)} data-deal-health={health} title={title}>
      <SparklesIcon aria-hidden />
      {prefix}: {DEAL_HEALTH_LABELS[health]}
    </Badge>
  );
}
