/**
 * Dashboard (Prompt 12) vocabulary + pure helpers. Client-safe, no I/O.
 *
 * - Deals needing attention: SQL view `deals_needing_attention` computes the
 *   flags + `attention_rank` and orders the rows; `rankDealsNeedingAttention()`
 *   is its **TS mirror** (unit-tested; the integration test checks SQL = TS).
 * - Win rate (SPEC §12) = won ÷ (won + lost) of prospects closed in the period
 *   (SQL `closed_outcome_counts()`); no closed deals → null ("—").
 * - Pipeline value (SPEC §12): rows of SQL `open_pipeline_value()` →
 *   per-currency totals + "N without value" (never summed across currencies).
 */
import { addDaysToDateString, formatOrgDateTime, type DateString, type Instant } from "@/lib/time";

/** Section sizes on the dashboard. */
export const DASHBOARD_LIMITS = {
  contactToday: 20,
  attention: 10,
  aiRecommendations: 5,
  recentActivity: 15,
} as const;

/** Win rate tile: prospects closed in the WIN_RATE_DAYS org calendar days ending today. */
export const WIN_RATE_DAYS = 90;

// ---------------------------------------------------------------------------
// Deals needing attention
// ---------------------------------------------------------------------------

/** Reasons in priority order (1 = most urgent). */
export const ATTENTION_REASONS = ["overdue_follow_up", "stale", "low_health", "no_follow_up"] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];
export type AttentionRank = 1 | 2 | 3 | 4;

export type AttentionFlags = {
  /** Earliest pending follow-up is before org today. */
  hasOverdueFollowUp: boolean;
  /** Open + no human activity for stale_days. */
  isStale: boolean;
  /** Latest AI insight's deal health is "low". */
  lowHealth: boolean;
  /** No pending follow-up (follow_up_date null). */
  noFollowUp: boolean;
};

export type RankableDeal = AttentionFlags & {
  id: string;
  followUpDate: DateString | null;
  /** ISO timestamp (Postgres timestamptz, may carry microseconds). */
  lastActivityAt: string;
};

/** Every reason that applies, most urgent first. */
export function attentionReasons(flags: AttentionFlags): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (flags.hasOverdueFollowUp) reasons.push("overdue_follow_up");
  if (flags.isStale) reasons.push("stale");
  if (flags.lowHealth) reasons.push("low_health");
  if (flags.noFollowUp) reasons.push("no_follow_up");
  return reasons;
}

/** The most urgent reason's rank (1 overdue > 2 stale > 3 AI low > 4 no follow-up), or null. */
export function attentionRank(flags: AttentionFlags): AttentionRank | null {
  const first = attentionReasons(flags)[0];
  return first ? ((ATTENTION_REASONS.indexOf(first) + 1) as AttentionRank) : null;
}

/** Microseconds since the epoch for a Postgres/ISO timestamp (keeps sub-ms digits for exact ties). */
export function instantMicros(iso: string): number {
  const match = /^(.*?:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(iso.trim());
  if (!match) return Date.parse(iso) * 1000;
  const [, base, fraction = "", zone = "Z"] = match;
  const seconds = Date.parse(`${base}${zone}`);
  const micros = Number(fraction.padEnd(6, "0").slice(0, 6));
  return seconds * 1000 + micros;
}

/**
 * SQL order of `deals_needing_attention`: attention_rank, follow_up_date asc
 * nulls last (most overdue first), last_activity_at asc (least recently
 * active first), id.
 */
export function compareAttention(a: RankableDeal, b: RankableDeal): number {
  const rankA = attentionRank(a) ?? 99;
  const rankB = attentionRank(b) ?? 99;
  if (rankA !== rankB) return rankA - rankB;
  if (a.followUpDate !== b.followUpDate) {
    if (a.followUpDate === null) return 1;
    if (b.followUpDate === null) return -1;
    return a.followUpDate < b.followUpDate ? -1 : 1;
  }
  const activity = instantMicros(a.lastActivityAt) - instantMicros(b.lastActivityAt);
  if (activity !== 0) return activity;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Ranks open deals for "Deals needing attention": drops rows without a reason,
 * sorts by compareAttention, keeps the first `limit`. Callers pass open-stage
 * rows only (closed deals never need attention).
 */
export function rankDealsNeedingAttention<T extends RankableDeal>(rows: readonly T[], limit?: number): T[] {
  const ranked = rows.filter((row) => attentionRank(row) !== null).sort(compareAttention);
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

export function attentionReasonLabel(reason: AttentionReason, staleDays: number): string {
  switch (reason) {
    case "overdue_follow_up":
      return "Overdue follow-up";
    case "stale":
      return `No activity for ${staleDays}+ days`;
    case "low_health":
      return "AI health: Low";
    case "no_follow_up":
      return "No follow-up scheduled";
  }
}

// ---------------------------------------------------------------------------
// Win rate + pipeline value
// ---------------------------------------------------------------------------

/** won ÷ (won + lost) as a fraction 0…1; null when nothing was closed. */
export function winRate(won: number, lost: number): number | null {
  const total = won + lost;
  return total > 0 ? won / total : null;
}

/** "67%" (rounded) or "—". */
export function formatWinRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/** The WIN_RATE_DAYS org calendar days ending `today` (inclusive). */
export function winRateWindow(today: DateString, days: number = WIN_RATE_DAYS): { from: DateString; to: DateString } {
  return { from: addDaysToDateString(today, -(days - 1)), to: today };
}

export type PipelineValueRpcRow = {
  currency: string | null;
  total_value: number | string | null;
  prospect_count: number;
};

export type PipelineValueSummary = {
  /** One entry per currency with at least one valued open prospect, sorted by currency. */
  totals: { currency: string; total: number; count: number }[];
  /** Open prospects without a deal value (shown next to the totals). */
  withoutValueCount: number;
  /** All open prospects (valued + without value). */
  openCount: number;
};

/** Maps `open_pipeline_value()` rows (currency null = without value). */
export function summarizePipelineValue(rows: readonly PipelineValueRpcRow[]): PipelineValueSummary {
  const totals: PipelineValueSummary["totals"] = [];
  let withoutValueCount = 0;
  let openCount = 0;
  for (const row of rows) {
    openCount += row.prospect_count;
    if (row.currency === null) {
      withoutValueCount += row.prospect_count;
    } else {
      totals.push({ currency: row.currency, total: Number(row.total_value ?? 0), count: row.prospect_count });
    }
  }
  totals.sort((a, b) => a.currency.localeCompare(b.currency));
  return { totals, withoutValueCount, openCount };
}

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

/** "Good morning" (5–11), "Good afternoon" (12–17), "Good evening" otherwise — org-local hour. */
export function greetingFor(tz: string, now: Instant = new Date()): string {
  const hour = Number(formatOrgDateTime(now, tz, "H"));
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

/** First word of a full name ("Riley Rep" → "Riley"); empty → "there". */
export function firstName(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] || "there";
}
