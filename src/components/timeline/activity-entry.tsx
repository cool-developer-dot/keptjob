/**
 * Activity display pieces shared by the prospect timeline (Prompt 8) and the
 * dashboard's recent activity feed (Prompt 12): icon + title per activity type
 * and the type-specific detail line (stage from → to, owner change, follow-up
 * task, AI deal health). Server-safe (no hooks).
 */
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
import { ACTIVITY_TYPE_LABELS, DEAL_HEALTH_LABELS } from "@/lib/constants";
import { formatDateString } from "@/lib/time";
import type { TimelineEntry } from "@/lib/timeline";

export const ACTIVITY_ICONS: Record<TimelineEntry["type"], LucideIcon> = {
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

export const ACTIVITY_TITLES: Record<TimelineEntry["type"], string> = {
  ...ACTIVITY_TYPE_LABELS,
  follow_up: "Completed follow-up",
  ai_insight: "AI insight generated",
  created: "Prospect created",
};

/** Type-specific detail line of a timeline entry (or nothing). */
export function EntryDetail({ entry }: { entry: TimelineEntry }) {
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
