/**
 * Reports (Prompt 13) vocabulary + pure helpers. Client-safe, no I/O.
 *
 * Metric definitions live in SQL (migration `20261011120000_reports.sql`,
 * security invoker → RLS); these helpers only resolve the period, map RPC
 * rows and format numbers:
 * - period = org calendar days `from … to` (inclusive), resolved from a preset
 *   against the org-local "today" (`orgToday(settings.timezone)`).
 * - funnel (SPEC §12): prospects CREATED in the period by highest stage ever
 *   reached (stage_history, closed_lost unranked); conversion % from SQL.
 * - win rate / won value / lost reasons: prospects CLOSED in the period.
 * - stage counts, pipeline value, overdue / due today: "now".
 */
import { z } from "zod";

import {
  LOST_REASON_LABELS,
  LOST_REASONS,
  PIPELINE_STAGES,
  STAGE_LABELS,
  type LostReason,
  type PipelineStage,
} from "@/lib/constants";
import { addDaysToDateString, formatDateString, type DateString } from "@/lib/time";

// ---------------------------------------------------------------------------
// Period presets
// ---------------------------------------------------------------------------

export const REPORT_PRESETS = ["this_month", "last_30", "last_90", "this_quarter", "custom"] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export const REPORT_PRESET_LABELS: Readonly<Record<ReportPreset, string>> = {
  this_month: "This month",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  this_quarter: "This quarter",
  custom: "Custom range",
};

export const DEFAULT_REPORT_PRESET: ReportPreset = "last_30";

/** Longest custom period (inclusive days); longer requests fall back to the default preset. */
export const MAX_REPORT_DAYS = 731;

export type ReportRange = { from: DateString; to: DateString };

/**
 * The org calendar days of a preset, ending on the org-local `today`:
 * this month = 1st … today · last 30 / 90 = today − 29 / 89 … today ·
 * this quarter = first day of the quarter … today. `custom` needs `custom`.
 */
export function resolveReportRange(
  preset: ReportPreset,
  today: DateString,
  custom?: ReportRange | null,
): ReportRange {
  switch (preset) {
    case "this_month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "last_30":
      return { from: addDaysToDateString(today, -29), to: today };
    case "last_90":
      return { from: addDaysToDateString(today, -89), to: today };
    case "this_quarter": {
      const month = Number(today.slice(5, 7));
      const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
      return { from: `${today.slice(0, 5)}${String(quarterStart).padStart(2, "0")}-01`, to: today };
    }
    case "custom":
      if (!custom) throw new RangeError("A custom range needs from/to dates");
      return { from: custom.from, to: custom.to };
  }
}

/** "Sep 1 – Sep 30, 2025" (same year) or "Dec 1, 2025 – Jan 31, 2026". */
export function formatReportRange({ from, to }: ReportRange): string {
  if (from === to) return formatDateString(from);
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return `${formatDateString(from, "MMM d")} – ${formatDateString(to, "MMM d, yyyy")}`;
  }
  return `${formatDateString(from)} – ${formatDateString(to)}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** A SQL percentage (0–100, 1 decimal) → "37.5%"; null (undefined ratio) → "—". */
export function formatPct(pct: number | string | null | undefined): string {
  if (pct === null || pct === undefined || pct === "") return "—";
  const value = Number(pct);
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Funnel + stage counts
// ---------------------------------------------------------------------------

/** SPEC §12 funnel steps (follow_up is not a step; closed_lost is unranked). */
export const FUNNEL_STAGES = [
  "prospect",
  "contacted",
  "conversation",
  "qualified",
  "demo_booked",
  "demo_attended",
  "closed_won",
] as const satisfies readonly PipelineStage[];
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_STEP_LABELS: Readonly<Record<FunnelStage, string>> = {
  prospect: "Prospects",
  contacted: "Contacted",
  conversation: "Conversation",
  qualified: "Qualified",
  demo_booked: "Demo Booked",
  demo_attended: "Demo Attended",
  closed_won: "Closed Won",
};

/** Ranked stages returned by report_stage_reached (all but closed_lost). */
export type RankedStage = Exclude<PipelineStage, "closed_lost">;

export type FunnelStep = {
  step: number;
  stage: FunnelStage;
  label: string;
  count: number;
  /** 100 × count ÷ previous step (null for step 1 or when the previous step is 0). */
  stepConversionPct: number | null;
  /** 100 × count ÷ Prospects (null when no prospects). */
  overallConversionPct: number | null;
};

export type FunnelRpcRow = {
  step: number;
  stage: PipelineStage;
  prospect_count: number;
  step_conversion_pct: number | string | null;
  overall_conversion_pct: number | string | null;
};

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isFunnelStage(stage: PipelineStage): stage is FunnelStage {
  return (FUNNEL_STAGES as readonly string[]).includes(stage);
}

/** Maps `report_funnel()` rows (SQL order) to typed steps with labels. */
export function toFunnelSteps(rows: readonly FunnelRpcRow[]): FunnelStep[] {
  return [...rows]
    .sort((a, b) => a.step - b.step)
    .flatMap((row): FunnelStep[] =>
      isFunnelStage(row.stage)
        ? [
            {
              step: row.step,
              stage: row.stage,
              label: FUNNEL_STEP_LABELS[row.stage],
              count: row.prospect_count,
              stepConversionPct: toNullableNumber(row.step_conversion_pct),
              overallConversionPct: toNullableNumber(row.overall_conversion_pct),
            },
          ]
        : [],
    );
}

export type StageCount = { stage: PipelineStage; label: string; count: number };

/** `report_stage_counts()` rows → all 9 stages in SPEC order (missing → 0). */
export function toStageCounts(rows: readonly { stage: PipelineStage; prospect_count: number }[]): StageCount[] {
  const byStage = new Map(rows.map((row) => [row.stage, row.prospect_count]));
  return PIPELINE_STAGES.map((stage) => ({ stage, label: STAGE_LABELS[stage], count: byStage.get(stage) ?? 0 }));
}

/** `report_stage_reached()` rows → count per ranked stage (missing → 0). */
export function toReachedCounts(
  rows: readonly { stage: PipelineStage; prospect_count: number }[],
): Record<RankedStage, number> {
  const reached = Object.fromEntries(
    PIPELINE_STAGES.filter((stage) => stage !== "closed_lost").map((stage) => [stage, 0]),
  ) as Record<RankedStage, number>;
  for (const row of rows) {
    if (row.stage !== "closed_lost") reached[row.stage] = row.prospect_count;
  }
  return reached;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

const wonValueSchema = z.array(
  z.object({ currency: z.string(), total: z.coerce.number(), count: z.coerce.number().int() }),
);
const lostReasonsSchema = z.array(z.object({ reason: z.string(), count: z.coerce.number().int() }));

export type LostReasonCount = { reason: LostReason; label: string; count: number };

export type ReportOutcomes = {
  won: number;
  lost: number;
  /** 100 × won ÷ (won + lost), 1 decimal; null when nothing closed. */
  winRatePct: number | null;
  /** Won deals' value per currency (never summed across currencies), sorted by currency. */
  wonValue: { currency: string; total: number; count: number }[];
  /** Won deals without a deal value. */
  wonWithoutValue: number;
  /** Every SPEC lost reason (zero-filled), most frequent first. */
  lostReasons: LostReasonCount[];
};

export type OutcomesRpcRow = {
  won: number;
  lost: number;
  win_rate_pct: number | string | null;
  won_value: unknown;
  won_without_value: number;
  lost_reasons: unknown;
};

function isLostReason(value: string): value is LostReason {
  return (LOST_REASONS as readonly string[]).includes(value);
}

/**
 * All SPEC lost reasons with their counts, most frequent first (ties and
 * zeros in SPEC order). Unknown reasons (should not exist: CHECK constraint)
 * are folded into "other".
 */
export function zeroFillLostReasons(rows: readonly { reason: string; count: number }[]): LostReasonCount[] {
  const counts = new Map<LostReason, number>(LOST_REASONS.map((reason) => [reason, 0]));
  for (const row of rows) {
    const reason: LostReason = isLostReason(row.reason) ? row.reason : "other";
    counts.set(reason, (counts.get(reason) ?? 0) + row.count);
  }
  return LOST_REASONS.map((reason, order) => ({ reason, order, count: counts.get(reason) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map(({ reason, count }) => ({ reason, label: LOST_REASON_LABELS[reason], count }));
}

/** Maps the single `report_outcomes()` row (null → nothing closed). Throws on malformed jsonb. */
export function toOutcomes(row: OutcomesRpcRow | null | undefined): ReportOutcomes {
  if (!row) {
    return { won: 0, lost: 0, winRatePct: null, wonValue: [], wonWithoutValue: 0, lostReasons: zeroFillLostReasons([]) };
  }
  const wonValue = wonValueSchema
    .parse(row.won_value ?? [])
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return {
    won: row.won,
    lost: row.lost,
    winRatePct: toNullableNumber(row.win_rate_pct),
    wonValue,
    wonWithoutValue: row.won_without_value,
    lostReasons: zeroFillLostReasons(lostReasonsSchema.parse(row.lost_reasons ?? [])),
  };
}
