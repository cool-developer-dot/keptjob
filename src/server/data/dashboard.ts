import "server-only";

import {
  CLOSED_STAGES,
  type ActivityType,
  type DealHealth,
  type ObjectionCategory,
  type PipelineStage,
} from "@/lib/constants";
import {
  DASHBOARD_LIMITS,
  attentionReasons,
  summarizePipelineValue,
  winRate,
  winRateWindow,
  type AttentionReason,
  type AttentionRank,
  type PipelineValueSummary,
} from "@/lib/dashboard";
import type { DateString } from "@/lib/time";
import type { TimelineActivity } from "@/lib/timeline";
import {
  closedOutcomeQuerySchema,
  dashboardKpiQuerySchema,
  dashboardListQuerySchema,
  dashboardOwnerQuerySchema,
  type ClosedOutcomeQuery,
  type DashboardKpiQuery,
  type DashboardListQuery,
  type DashboardOwnerQuery,
} from "@/lib/validation/dashboard";
import type { ActionResult } from "@/server/actions/types";

import type { DataContext } from "./context";
import { dbFailure, ok, validationFailure } from "./errors";
import {
  effectiveOwner,
  getFollowUpCountsData,
  SNIPPET_COLUMNS,
  toSnippet,
  type ConversationSnippet,
} from "./follow-up-views";

/**
 * Dashboard reads (Prompt 12). Every query uses the user-scoped client → RLS
 * (reps: own rows); `ownerId` is honoured for managers only. Shared metric
 * definitions live in SQL and are reusable by Reports (Prompt 13):
 * - getPipelineValueData        → RPC open_pipeline_value()   (SPEC §12 pipeline value)
 * - getClosedOutcomeCountsData  → RPC closed_outcome_counts() (won / lost in a period → win rate)
 * - due today / overdue         → getFollowUpCountsData (RPC follow_up_bucket_counts, same as /follow-ups)
 * - stale                       → prospects_with_flags.is_stale
 * - deals needing attention     → view deals_needing_attention (ranked in SQL; TS mirror in src/lib/dashboard.ts)
 */

const CLOSED_STAGE_LIST = `(${CLOSED_STAGES.join(",")})`;

export type WinRateSummary = {
  won: number;
  lost: number;
  /** won ÷ (won + lost), null when nothing was closed. */
  rate: number | null;
  from: DateString;
  to: DateString;
};

export type DashboardKpis = {
  openProspects: number;
  pipelineValue: PipelineValueSummary;
  dueToday: number;
  overdue: number;
  stale: number;
  winRate: WinRateSummary;
};

export type AiNextStep = {
  text: string;
  dealHealth: DealHealth;
  createdAt: string;
};

export type ContactTodayRow = {
  id: string;
  prospectId: string;
  ownerId: string;
  dueDate: DateString;
  note: string;
  bucket: "overdue" | "today";
  prospect: {
    id: string;
    name: string;
    company: string | null;
    stage: PipelineStage;
    objections: ObjectionCategory[];
  };
  lastConversation: ConversationSnippet | null;
  aiNextStep: AiNextStep | null;
};

export type AttentionDealRow = {
  id: string;
  name: string;
  company: string | null;
  stage: PipelineStage;
  ownerId: string;
  followUpDate: DateString | null;
  lastActivityAt: string;
  hasOverdueFollowUp: boolean;
  isStale: boolean;
  lowHealth: boolean;
  noFollowUp: boolean;
  rank: AttentionRank;
  reasons: AttentionReason[];
};

export type AiRecommendationRow = {
  insightId: string;
  createdAt: string;
  nextStep: string;
  dealHealth: DealHealth;
  prospect: { id: string; name: string; company: string | null; stage: PipelineStage; ownerId: string };
};

export type RecentActivityRow = TimelineActivity & {
  prospect: { id: string; name: string; ownerId: string };
};

type InsightEmbed = {
  recommended_next_step: string | null;
  deal_health: DealHealth | null;
  created_at: string | null;
};

function toNextStep(rows: InsightEmbed[] | InsightEmbed | null | undefined): AiNextStep | null {
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.recommended_next_step || !row.deal_health || !row.created_at) return null;
  return { text: row.recommended_next_step, dealHealth: row.deal_health, createdAt: row.created_at };
}

// ---------------------------------------------------------------------------
// Metrics (reusable by Reports)
// ---------------------------------------------------------------------------

/** SPEC §12 pipeline value "now": per-currency totals of open prospects + count without a value. */
export async function getPipelineValueData(
  ctx: DataContext,
  input: DashboardOwnerQuery = {},
): Promise<ActionResult<PipelineValueSummary>> {
  const parsed = dashboardOwnerQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  const { data, error } = await ctx.supabase.rpc("open_pipeline_value", ownerId ? { p_owner_id: ownerId } : {});
  if (error) return dbFailure("openPipelineValue", error, "Could not load the pipeline value.");
  return ok(summarizePipelineValue(data ?? []));
}

/** Won / lost counts of prospects closed (org-tz date of closed_at) in [from, to] + win rate. */
export async function getClosedOutcomeCountsData(
  ctx: DataContext,
  input: ClosedOutcomeQuery,
): Promise<ActionResult<WinRateSummary>> {
  const parsed = closedOutcomeQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { from, to } = parsed.data;
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  const { data, error } = await ctx.supabase
    .rpc("closed_outcome_counts", { p_from: from, p_to: to, ...(ownerId ? { p_owner_id: ownerId } : {}) })
    .maybeSingle();
  if (error) return dbFailure("closedOutcomeCounts", error, "Could not load the win rate.");
  const won = data?.won ?? 0;
  const lost = data?.lost ?? 0;
  return ok({ won, lost, rate: winRate(won, lost), from, to });
}

/** Open deals flagged stale (no human activity for stale_days). */
export async function countStaleDealsData(
  ctx: DataContext,
  input: DashboardOwnerQuery = {},
): Promise<ActionResult<number>> {
  const parsed = dashboardOwnerQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  let query = ctx.supabase
    .from("prospects_with_flags")
    .select("id", { count: "exact", head: true })
    .eq("is_stale", true);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { count, error } = await query;
  if (error) return dbFailure("countStaleDeals", error, "Could not load the stale deals.");
  return ok(count ?? 0);
}

/** All six KPI tiles (four queries in parallel). `today` = org-local today; win rate = last 90 org days. */
export async function getDashboardKpisData(
  ctx: DataContext,
  input: DashboardKpiQuery,
): Promise<ActionResult<DashboardKpis>> {
  const parsed = dashboardKpiQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  const window = winRateWindow(parsed.data.today);

  const [pipeline, followUps, stale, outcomes] = await Promise.all([
    getPipelineValueData(ctx, { ownerId }),
    getFollowUpCountsData(ctx, { ownerId }),
    countStaleDealsData(ctx, { ownerId }),
    getClosedOutcomeCountsData(ctx, { ...window, ownerId }),
  ]);
  if (!pipeline.ok) return pipeline;
  if (!followUps.ok) return followUps;
  if (!stale.ok) return stale;
  if (!outcomes.ok) return outcomes;

  return ok({
    openProspects: pipeline.data.openCount,
    pipelineValue: pipeline.data,
    dueToday: followUps.data.today,
    overdue: followUps.data.overdue,
    stale: stale.data,
    winRate: outcomes.data,
  });
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

const CONTACT_TODAY_COLUMNS = `id, prospect_id, owner_id, due_date, note, bucket, created_at, prospect:prospects(id, name, company, stage, objections, latest_conversation_activities(${SNIPPET_COLUMNS}), latest_ai_insights(recommended_next_step, deal_health, created_at))`;

/**
 * "Contact today" (SPEC §1.1–1.5): pending follow-ups due today or overdue
 * (org tz, view follow_up_buckets), most overdue first, with the prospect's
 * objections, last conversation snippet and latest AI next step — one query.
 * `total` = all overdue + today follow-ups (may exceed the limit).
 */
export async function listContactTodayData(
  ctx: DataContext,
  input: DashboardListQuery = {},
): Promise<ActionResult<{ rows: ContactTodayRow[]; total: number }>> {
  const parsed = dashboardListQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  const limit = parsed.data.limit ?? DASHBOARD_LIMITS.contactToday;

  let query = ctx.supabase
    .from("follow_up_buckets")
    .select(CONTACT_TODAY_COLUMNS, { count: "exact" })
    .in("bucket", ["overdue", "today"]);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error, count } = await query
    .order("due_date", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) return dbFailure("listContactToday", error, "Could not load today's follow-ups.");

  const rows = (data ?? []).flatMap((row): ContactTodayRow[] => {
    const prospect = Array.isArray(row.prospect) ? row.prospect[0] : row.prospect;
    if (!row.id || !prospect || (row.bucket !== "overdue" && row.bucket !== "today")) return [];
    return [
      {
        id: row.id,
        prospectId: prospect.id,
        ownerId: row.owner_id ?? "",
        dueDate: row.due_date ?? "",
        note: row.note ?? "",
        bucket: row.bucket,
        prospect: {
          id: prospect.id,
          name: prospect.name,
          company: prospect.company,
          stage: prospect.stage,
          objections: prospect.objections ?? [],
        },
        lastConversation: toSnippet(prospect.latest_conversation_activities),
        aiNextStep: toNextStep(prospect.latest_ai_insights),
      },
    ];
  });
  return ok({ rows, total: count ?? rows.length });
}

const ATTENTION_COLUMNS =
  "id, name, company, stage, owner_id, follow_up_date, last_activity_at, has_overdue_follow_up, is_stale, low_health, no_follow_up, attention_rank";

/**
 * "Deals needing attention" (SPEC §1.6): open deals ranked overdue follow-up >
 * stale > AI health low > no pending follow-up (view deals_needing_attention),
 * top `limit` (default 10) with their reasons; `total` = every such deal.
 */
export async function listDealsNeedingAttentionData(
  ctx: DataContext,
  input: DashboardListQuery = {},
): Promise<ActionResult<{ rows: AttentionDealRow[]; total: number }>> {
  const parsed = dashboardListQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  const limit = parsed.data.limit ?? DASHBOARD_LIMITS.attention;

  let query = ctx.supabase.from("deals_needing_attention").select(ATTENTION_COLUMNS, { count: "exact" });
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error, count } = await query
    .order("attention_rank", { ascending: true })
    .order("follow_up_date", { ascending: true, nullsFirst: false })
    .order("last_activity_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) return dbFailure("listDealsNeedingAttention", error, "Could not load the deals that need attention.");

  const rows = (data ?? []).flatMap((row): AttentionDealRow[] => {
    if (!row.id || !row.stage || !row.attention_rank) return [];
    const flags = {
      hasOverdueFollowUp: row.has_overdue_follow_up ?? false,
      isStale: row.is_stale ?? false,
      lowHealth: row.low_health ?? false,
      noFollowUp: row.no_follow_up ?? false,
    };
    return [
      {
        id: row.id,
        name: row.name ?? "",
        company: row.company,
        stage: row.stage,
        ownerId: row.owner_id ?? "",
        followUpDate: row.follow_up_date,
        lastActivityAt: row.last_activity_at ?? "",
        ...flags,
        rank: row.attention_rank as AttentionRank,
        reasons: attentionReasons(flags),
      },
    ];
  });
  return ok({ rows, total: count ?? rows.length });
}

/**
 * "Latest AI recommendations" (SPEC §1.5): the latest insight's
 * recommended_next_step per **open** prospect, newest insights first (top 5).
 */
export async function listLatestAiRecommendationsData(
  ctx: DataContext,
  input: DashboardListQuery = {},
): Promise<ActionResult<AiRecommendationRow[]>> {
  const parsed = dashboardListQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  const limit = parsed.data.limit ?? DASHBOARD_LIMITS.aiRecommendations;

  let query = ctx.supabase
    .from("latest_ai_insights")
    .select(
      "id, created_at, recommended_next_step, deal_health, prospect:prospects!inner(id, name, company, stage, owner_id)",
    )
    .not("prospect.stage", "in", CLOSED_STAGE_LIST);
  if (ownerId) query = query.eq("prospect.owner_id", ownerId);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) return dbFailure("listLatestAiRecommendations", error, "Could not load the AI recommendations.");

  return ok(
    (data ?? []).flatMap((row): AiRecommendationRow[] => {
      const prospect = Array.isArray(row.prospect) ? row.prospect[0] : row.prospect;
      if (!row.id || !row.created_at || !row.recommended_next_step || !row.deal_health || !prospect) return [];
      return [
        {
          insightId: row.id,
          createdAt: row.created_at,
          nextStep: row.recommended_next_step,
          dealHealth: row.deal_health,
          prospect: {
            id: prospect.id,
            name: prospect.name,
            company: prospect.company,
            stage: prospect.stage,
            ownerId: prospect.owner_id,
          },
        },
      ];
    }),
  );
}

/** Recent activity feed: the newest `limit` (default 15) activities on visible prospects (owner = prospect owner). */
export async function listRecentActivityData(
  ctx: DataContext,
  input: DashboardListQuery = {},
): Promise<ActionResult<RecentActivityRow[]>> {
  const parsed = dashboardListQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  const limit = parsed.data.limit ?? DASHBOARD_LIMITS.recentActivity;

  let query = ctx.supabase
    .from("activities")
    .select("id, user_id, type, content, metadata, occurred_at, created_at, prospect:prospects!inner(id, name, owner_id)");
  if (ownerId) query = query.eq("prospect.owner_id", ownerId);
  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) return dbFailure("listRecentActivity", error, "Could not load the recent activity.");

  return ok(
    (data ?? []).flatMap((row): RecentActivityRow[] => {
      const prospect = Array.isArray(row.prospect) ? row.prospect[0] : row.prospect;
      if (!prospect) return [];
      return [
        {
          id: row.id,
          user_id: row.user_id,
          type: row.type as ActivityType,
          content: row.content,
          metadata: row.metadata,
          occurred_at: row.occurred_at,
          created_at: row.created_at,
          prospect: { id: prospect.id, name: prospect.name, ownerId: prospect.owner_id },
        },
      ];
    }),
  );
}
