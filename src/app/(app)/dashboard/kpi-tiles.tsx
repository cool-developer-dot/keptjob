import { cn } from "cn";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  ClockIcon,
  type LucideIcon,
  TrophyIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";

import { formatWinRate } from "@/lib/dashboard";
import { formatMoney } from "@/lib/money";
import { formatDateString } from "@/lib/time";
import type { DashboardKpis } from "@/server/data/dashboard";

type Tone = "default" | "critical" | "warning";

/** Six KPI tiles (SPEC §1 / §12); each links to the page that lists the items. */
export function KpiTiles({ kpis, owner }: { kpis: DashboardKpis; owner: string | null }) {
  const ownerQuery = owner ? `owner=${encodeURIComponent(owner)}` : "";
  const withOwner = (path: string, query = "") => {
    const params = [query, ownerQuery].filter(Boolean).join("&");
    return params ? `${path}?${params}` : path;
  };
  const { pipelineValue: pipeline, winRate } = kpis;
  const decided = winRate.won + winRate.lost;

  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        id="open"
        icon={UsersIcon}
        label="Open prospects"
        value={kpis.openProspects.toLocaleString("en-US")}
        hint="Not closed"
        href={withOwner("/prospects")}
      />
      <Tile
        id="pipeline"
        icon={WalletIcon}
        label="Pipeline value"
        value={
          pipeline.totals.length === 0 ? (
            "—"
          ) : (
            <span className="flex flex-col">
              {pipeline.totals.map((total) => (
                <span key={total.currency} data-currency={total.currency}>
                  {formatMoney(total.total, total.currency, { compact: true })}
                </span>
              ))}
            </span>
          )
        }
        hint={`${pipeline.withoutValueCount.toLocaleString("en-US")} without value`}
        href={withOwner("/pipeline")}
        small={pipeline.totals.length > 1}
      />
      <Tile
        id="due-today"
        icon={CalendarClockIcon}
        label="Due today"
        value={kpis.dueToday.toLocaleString("en-US")}
        hint="Follow-ups"
        href={withOwner("/follow-ups", "tab=today")}
      />
      <Tile
        id="overdue"
        icon={AlertTriangleIcon}
        label="Overdue"
        value={kpis.overdue.toLocaleString("en-US")}
        hint={kpis.overdue > 0 ? "Follow-ups past due" : "Nothing past due"}
        href={withOwner("/follow-ups")}
        tone={kpis.overdue > 0 ? "critical" : "default"}
      />
      <Tile
        id="stale"
        icon={ClockIcon}
        label="Stale deals"
        value={kpis.stale.toLocaleString("en-US")}
        hint="No recent activity"
        href={withOwner("/prospects", "stale=1")}
        tone={kpis.stale > 0 ? "warning" : "default"}
      />
      <Tile
        id="win-rate"
        icon={TrophyIcon}
        label="Win rate · 90 days"
        value={formatWinRate(winRate.rate)}
        hint={decided === 0 ? "No deals closed" : `${winRate.won} won · ${winRate.lost} lost`}
        title={`Prospects closed ${formatDateString(winRate.from)} – ${formatDateString(winRate.to)} (org timezone)`}
        href="/reports"
      />
    </section>
  );
}

const TONE_CLASSES: Record<Tone, string> = {
  default: "text-muted-foreground",
  critical: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
};

function Tile({
  id,
  icon: Icon,
  label,
  value,
  hint,
  href,
  title,
  tone = "default",
  small = false,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint: string;
  href: string;
  title?: string;
  tone?: Tone;
  small?: boolean;
}) {
  return (
    <Link
      href={href}
      data-kpi={id}
      title={title}
      className="group flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-4 text-card-foreground shadow-xs transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        <Icon aria-hidden className={cn("size-4 shrink-0", TONE_CLASSES[tone])} />
      </span>
      <span
        data-kpi-value
        className={cn("font-semibold tracking-tight tabular-nums", small ? "text-lg leading-snug" : "text-2xl")}
      >
        {value}
      </span>
      <span className={cn("truncate text-xs", tone === "default" ? "text-muted-foreground" : TONE_CLASSES[tone])}>
        {hint}
      </span>
    </Link>
  );
}
