import { cn } from "cn";
import {
  AlertTriangleIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  type LucideIcon,
  PercentIcon,
  TrophyIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";

import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { formatCount, formatPct, type FunnelStep } from "@/lib/reports";
import type { ReportData } from "@/server/data/reports";

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

/** Eight KPI tiles; the hint says whether a number is "now" or for the period. */
export function ReportKpiTiles({ data }: { data: ReportData }) {
  const { outcomes, pipelineValue, followUps } = data;
  const prospectsCreated = data.funnel[0]?.count ?? 0;

  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile id="total-prospects" icon={UsersIcon} label="Total prospects" value={formatCount(data.totalProspects)} hint="All stages, now" />
      <Tile id="new-prospects" icon={UserPlusIcon} label="New prospects" value={formatCount(prospectsCreated)} hint="Created in period" />
      <Tile
        id="pipeline-value"
        icon={WalletIcon}
        label="Pipeline value"
        value={<MoneyLines totals={pipelineValue.totals} />}
        hint={`Open, now · ${formatCount(pipelineValue.withoutValueCount)} without value`}
        small={pipelineValue.totals.length > 1}
      />
      <Tile
        id="win-rate"
        icon={PercentIcon}
        label="Win rate"
        value={formatPct(outcomes.winRatePct)}
        hint={
          outcomes.won + outcomes.lost === 0
            ? "No deals closed in period"
            : `${formatCount(outcomes.won)} won · ${formatCount(outcomes.lost)} lost in period`
        }
      />
      <Tile
        id="won-value"
        icon={TrophyIcon}
        label="Won value"
        value={<MoneyLines totals={outcomes.wonValue} />}
        hint={`Closed in period · ${formatCount(outcomes.wonWithoutValue)} without value`}
        small={outcomes.wonValue.length > 1}
      />
      <Tile
        id="overdue"
        icon={AlertTriangleIcon}
        label="Overdue follow-ups"
        value={formatCount(followUps.overdue)}
        hint="Now"
        tone={followUps.overdue > 0 ? "critical" : "default"}
      />
      <Tile id="due-today" icon={CalendarClockIcon} label="Due today" value={formatCount(followUps.dueToday)} hint="Follow-ups, now" />
      <Tile
        id="follow-ups-completed"
        icon={CalendarCheckIcon}
        label="Follow-ups completed"
        value={formatCount(followUps.completed)}
        hint="In period"
      />
    </section>
  );
}

function MoneyLines({ totals }: { totals: { currency: string; total: number }[] }) {
  if (totals.length === 0) return <>—</>;
  return (
    <span className="flex flex-col">
      {totals.map((total) => (
        <span key={total.currency} data-currency={total.currency}>
          {formatMoney(total.total, total.currency, { compact: true })}
        </span>
      ))}
    </span>
  );
}

type Tone = "default" | "critical";

function Tile({
  id,
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
  small = false,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint: string;
  tone?: Tone;
  small?: boolean;
}) {
  return (
    <div data-kpi={id} className="glass flex min-w-0 flex-col gap-1.5 rounded-2xl p-4 text-card-foreground">
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        {tone === "critical" ? (
          <span className="flex shrink-0 items-center gap-1 text-red-600 dark:text-red-400">
            <Icon aria-hidden className="size-4" />
          </span>
        ) : (
          <Icon aria-hidden className="size-4 shrink-0" />
        )}
      </span>
      <span
        data-kpi-value
        className={cn("font-semibold tracking-tight tabular-nums", small ? "text-lg leading-snug" : "text-2xl")}
      >
        {value}
      </span>
      <span className={cn("text-xs", tone === "critical" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
        {hint}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SPEC §12 counts
// ---------------------------------------------------------------------------

/**
 * SPEC §12 counts. Contacted … Follow-ups: prospects created in the period
 * that reached at least that stage (the funnel definition; Follow-ups = the
 * Follow-up stage). Closed won / lost: prospects closed in the period (the
 * win-rate basis).
 */
export function StageCountStrip({ data }: { data: ReportData }) {
  const { reached, outcomes } = data;
  const items = [
    { id: "contacted", label: "Contacted", value: reached.contacted },
    { id: "conversation", label: "Conversations", value: reached.conversation },
    { id: "qualified", label: "Qualified", value: reached.qualified },
    { id: "demo_booked", label: "Demos booked", value: reached.demo_booked },
    { id: "demo_attended", label: "Demos attended", value: reached.demo_attended },
    { id: "follow_up", label: "Follow-ups", value: reached.follow_up },
    { id: "closed_won", label: "Closed won", value: outcomes.won },
    { id: "closed_lost", label: "Closed lost", value: outcomes.lost },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 xl:grid-cols-8">
      {items.map((item) => (
        <div key={item.id} data-count={item.id} className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{formatCount(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Conversion table
// ---------------------------------------------------------------------------

export function ConversionTable({ funnel, winRatePct }: { funnel: FunnelStep[]; winRatePct: number | null }) {
  const last = funnel[funnel.length - 1];
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table data-testid="conversion-table">
        <TableHeader>
          <TableRow>
            <TableHead>Step</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead className="text-right whitespace-normal">From prev. step</TableHead>
            <TableHead className="text-right whitespace-normal">Of all prospects</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {funnel.map((step) => (
            <TableRow key={step.stage} data-step={step.stage}>
              <TableCell className="font-medium">{step.label}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(step.count)}</TableCell>
              <TableCell className="text-right tabular-nums" data-cell="step">
                {step.step === 1 ? "" : formatPct(step.stepConversionPct)}
              </TableCell>
              <TableCell className="text-right tabular-nums" data-cell="overall">
                {formatPct(step.overallConversionPct)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3} className="whitespace-normal">Overall conversion (Closed Won ÷ Prospects)</TableCell>
            <TableCell className="text-right tabular-nums" data-testid="overall-conversion">
              {formatPct(last?.overallConversionPct ?? null)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell colSpan={3} className="whitespace-normal">Win rate (won ÷ closed in period)</TableCell>
            <TableCell className="text-right tabular-nums" data-testid="win-rate">
              {formatPct(winRatePct)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
