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

import { formatWinRate } from "@/lib/dashboard";
import { formatMoney } from "@/lib/money";
import { formatDateString } from "@/lib/time";
import type { DashboardKpis } from "@/server/data/dashboard";

import { CountUp } from "./charts/count-up";

type Tone = "neutral" | "red" | "amber";

/**
 * Six KPI tiles (SPEC §1 / §12); each links to the page that lists the items.
 * The first is the deep-green hero tile. Numbers count up on load; the real
 * value sits in `[data-kpi-value]` (screen readers, tests), the animation beside it.
 */
export function KpiTiles({ kpis, owner }: { kpis: DashboardKpis; owner: string | null }) {
  const ownerQuery = owner ? `owner=${encodeURIComponent(owner)}` : "";
  const withOwner = (path: string, query = "") => {
    const params = [query, ownerQuery].filter(Boolean).join("&");
    return params ? `${path}?${params}` : path;
  };
  const { pipelineValue: pipeline, winRate } = kpis;
  const decided = winRate.won + winRate.lost;
  const totals = [...pipeline.totals].sort((a, b) => Number(b.total) - Number(a.total));

  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        id="open"
        icon={UsersIcon}
        label="Open prospects"
        value={kpis.openProspects}
        hint="Deals still in play"
        href={withOwner("/prospects")}
        hero
      />
      <Tile
        id="pipeline"
        icon={WalletIcon}
        label="Pipeline value"
        value={
          totals.length === 0 ? (
            "—"
          ) : (
            <span className="flex flex-wrap items-baseline gap-x-2">
              {totals.map((total, index) => (
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
      />
      <Tile
        id="due-today"
        icon={CalendarClockIcon}
        label="Due today"
        value={kpis.dueToday}
        hint="Follow-ups"
        href={withOwner("/follow-ups", "tab=today")}
      />
      <Tile
        id="overdue"
        icon={AlertTriangleIcon}
        label="Overdue"
        value={kpis.overdue}
        hint={kpis.overdue > 0 ? "Follow-ups past due" : "Nothing past due"}
        href={withOwner("/follow-ups")}
        tone={kpis.overdue > 0 ? "red" : "neutral"}
      />
      <Tile
        id="stale"
        icon={ClockIcon}
        label="Stale deals"
        value={kpis.stale}
        hint="No recent activity"
        href={withOwner("/prospects", "stale=1")}
        tone={kpis.stale > 0 ? "amber" : "neutral"}
      />
      <Tile
        id="win-rate"
        icon={TrophyIcon}
        label="Win rate · 90 days"
        value={winRate.rate === null ? formatWinRate(null) : Math.round(winRate.rate * 100)}
        valueText={formatWinRate(winRate.rate)}
        suffix={winRate.rate === null ? undefined : "%"}
        hint={decided === 0 ? "No deals closed" : `${winRate.won} won · ${winRate.lost} lost`}
        title={`Prospects closed ${formatDateString(winRate.from)} – ${formatDateString(winRate.to)} (org timezone)`}
        href="/reports"
      />
    </section>
  );
}

const HINT_TONES: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-700 dark:text-amber-400",
};

const DOT_TONES: Record<Tone, string> = {
  neutral: "bg-[oklch(0.3_0.01_255/0.25)] dark:bg-white/30",
  red: "bg-red-500",
  amber: "bg-amber-500",
};

function Tile({
  id,
  icon: Icon,
  label,
  value,
  valueText,
  suffix,
  hint,
  href,
  title,
  tone = "neutral",
  hero = false,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  /** A number counts up; anything else renders as-is. */
  value: number | React.ReactNode;
  /** Text for `[data-kpi-value]` when it differs from the number (e.g. "55%"). */
  valueText?: string;
  suffix?: string;
  hint: string;
  href: string;
  title?: string;
  tone?: Tone;
  hero?: boolean;
}) {
  const numeric = typeof value === "number";
  return (
    <Link
      href={href}
      data-kpi={id}
      title={title}
      className={cn(
        "group relative flex min-h-36 min-w-0 flex-col justify-between gap-4 overflow-hidden rounded-3xl p-5 transition-all duration-300 hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        hero
          ? "brand-surface"
          : "glass text-card-foreground hover:shadow-[inset_0_1px_0_0_var(--glass-highlight),var(--glass-shadow-lg)]",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            hero
              ? "bg-white/12 text-white ring-1 ring-white/20"
              : "bg-white/80 text-[oklch(0.3_0.01_255)] shadow-[inset_0_1px_0_0_oklch(1_0_0)] ring-1 ring-[oklch(0.3_0.01_255/0.08)] dark:bg-white/10 dark:text-white dark:ring-white/10",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span
          aria-hidden
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border transition-all duration-300 group-hover:rotate-45",
            hero
              ? "border-white/30 bg-white/10 text-white group-hover:bg-white group-hover:text-[var(--brand-deep)]"
              : "border-[oklch(0.3_0.01_255/0.14)] bg-white/60 text-foreground/70 group-hover:border-transparent group-hover:bg-primary group-hover:text-primary-foreground dark:border-white/15 dark:bg-white/5",
          )}
        >
          <ArrowUpRightIcon className="size-4" />
        </span>
      </span>

      <span className="flex min-w-0 flex-col gap-1.5">
        <span className={cn("truncate text-sm font-medium", hero ? "text-white/85" : "text-foreground/75")}>{label}</span>
        {numeric ? (
          <span className="relative text-[2.1rem] leading-none font-semibold tracking-tight">
            <span data-kpi-value className="sr-only">
              {valueText ?? value.toLocaleString("en-US")}
            </span>
            <CountUp value={value} />
            {suffix && <span aria-hidden>{suffix}</span>}
          </span>
        ) : (
          <span data-kpi-value className="text-[1.65rem] leading-tight font-semibold tracking-tight">
            {value}
          </span>
        )}
        <span className={cn("flex min-w-0 items-center gap-1.5 text-xs", hero ? "text-white/70" : HINT_TONES[tone])}>
          {!hero && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT_TONES[tone])} />}
          <span className="truncate">{hint}</span>
        </span>
      </span>
    </Link>
  );
}
