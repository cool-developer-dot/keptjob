import { cn } from "cn";
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  CalendarClockIcon,
  ClockIcon,
  type LucideIcon,
  TrophyIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";

import { IconChip, type IconTone } from "@/components/section-card";
import { formatWinRate } from "@/lib/dashboard";
import { formatMoney } from "@/lib/money";
import { formatDateString } from "@/lib/time";
import type { DashboardKpis } from "@/server/data/dashboard";


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
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        id="open"
        icon={UsersIcon}
        label="Open prospects"
        value={kpis.openProspects.toLocaleString("en-US")}
        hint="Not closed"
        href={withOwner("/prospects")}
        tone="neutral"
      />
      <Tile
        id="pipeline"
        icon={WalletIcon}
        label="Pipeline value"
        value={
          pipeline.totals.length === 0 ? (
            "—"
          ) : (
            <span className="flex flex-wrap items-baseline gap-x-2">
              {[...pipeline.totals]
                .sort((a, b) => Number(b.total) - Number(a.total))
                .map((total, index) => (
                <span
                  key={total.currency}
                  data-currency={total.currency}
                  className={cn(index > 0 && "text-base font-medium text-muted-foreground")}
                >
                  {formatMoney(total.total, total.currency, { compact: true })}
                </span>
              ))}
            </span>
          )
        }
        hint={`${pipeline.withoutValueCount.toLocaleString("en-US")} without value`}
        href={withOwner("/pipeline")}
        tone="sky"
      />
      <Tile
        id="due-today"
        icon={CalendarClockIcon}
        label="Due today"
        value={kpis.dueToday.toLocaleString("en-US")}
        hint="Follow-ups"
        href={withOwner("/follow-ups", "tab=today")}
        tone="neutral"
      />
      <Tile
        id="overdue"
        icon={AlertTriangleIcon}
        label="Overdue"
        value={kpis.overdue.toLocaleString("en-US")}
        hint={kpis.overdue > 0 ? "Follow-ups past due" : "Nothing past due"}
        href={withOwner("/follow-ups")}
        tone={kpis.overdue > 0 ? "red" : "slate"}
        alert={kpis.overdue > 0}
      />
      <Tile
        id="stale"
        icon={ClockIcon}
        label="Stale deals"
        value={kpis.stale.toLocaleString("en-US")}
        hint="No recent activity"
        href={withOwner("/prospects", "stale=1")}
        tone={kpis.stale > 0 ? "amber" : "slate"}
        alert={kpis.stale > 0}
      />
      <Tile
        id="win-rate"
        icon={TrophyIcon}
        label="Win rate · 90 days"
        value={formatWinRate(winRate.rate)}
        hint={decided === 0 ? "No deals closed" : `${winRate.won} won · ${winRate.lost} lost`}
        title={`Prospects closed ${formatDateString(winRate.from)} – ${formatDateString(winRate.to)} (org timezone)`}
        href="/reports"
        tone="emerald"
      />
    </section>
  );
}

const HINT_CLASSES: Partial<Record<IconTone, string>> = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-700 dark:text-amber-400",
};

function Tile({
  id,
  icon: Icon,
  label,
  value,
  hint,
  href,
  title,
  tone = "neutral",
  alert = false,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint: string;
  href: string;
  title?: string;
  tone?: IconTone;
  /** Colour the hint (overdue / stale > 0). */
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      data-kpi={id}
      title={title}
      className="glass group relative flex min-w-0 flex-col gap-3 rounded-2xl p-4 text-card-foreground transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_0_var(--glass-highlight),var(--glass-shadow-lg)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex items-center justify-between gap-2">
        <IconChip tone={tone}>
          <Icon />
        </IconChip>
        <ArrowUpRightIcon
          aria-hidden
          className="size-4 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground"
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span data-kpi-value className="text-[1.65rem] leading-tight font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        <span className={cn("truncate text-xs", alert ? HINT_CLASSES[tone] : "text-muted-foreground")}>{hint}</span>
      </span>
    </Link>
  );
}
