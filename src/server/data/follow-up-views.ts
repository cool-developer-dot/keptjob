import "server-only";

import { CLOSED_STAGES, type ActivityType, type FollowUpStatus, type PipelineStage } from "@/lib/constants";
import {
  EMPTY_FOLLOW_UP_COUNTS,
  isFollowUpListTab,
  needsAttentionReasons,
  type FollowUpListTab,
  type FollowUpTabCounts,
  type NeedsAttentionReason,
} from "@/lib/follow-ups";
import {
  followUpListQuerySchema,
  followUpOwnerQuerySchema,
  needsAttentionQuerySchema,
  type FollowUpListQuery,
  type FollowUpOwnerQuery,
  type NeedsAttentionQuery,
} from "@/lib/validation/follow-ups-page";
import type { ActionResult } from "@/server/actions/types";

import type { DataContext } from "./context";
import { dbFailure, ok, validationFailure } from "./errors";

/**
 * Follow-ups page (Prompt 10) reads, reusable by the Dashboard (Prompt 12):
 * - getFollowUpCountsData   tab counts (RPC follow_up_bucket_counts)
 * - getFollowUpBadgeCountData  sidebar badge = own overdue + today
 * - listFollowUpsData       one tab's rows ("contact today" = overdue + today)
 * - listNeedsAttentionData / countNeedsAttentionData  open deals that are stale or have no follow-up
 *
 * Buckets come from SQL (view follow_up_buckets / follow_up_bucket(), org
 * timezone via org_settings) so lists and counts share one definition. All
 * reads use the user-scoped client → RLS (reps: own rows only). The owner
 * filter is honoured for managers only.
 */

/** Rows per follow-up tab (limit + 1 must stay ≤ PostgREST max_rows 1000); more → `truncated`. */
export const FOLLOW_UPS_LIMIT = 200;
export const NEEDS_ATTENTION_LIMIT = 200;

export type ConversationSnippet = {
  type: ActivityType;
  snippet: string;
  contentLength: number;
  occurredAt: string;
};

export type FollowUpListRow = {
  id: string;
  prospectId: string;
  ownerId: string;
  dueDate: string;
  note: string;
  status: FollowUpStatus;
  completedAt: string | null;
  completedBy: string | null;
  bucket: FollowUpListTab;
  prospect: {
    id: string;
    name: string;
    company: string | null;
    stage: PipelineStage;
  };
  lastConversation: ConversationSnippet | null;
};

export type NeedsAttentionRow = {
  id: string;
  name: string;
  company: string | null;
  stage: PipelineStage;
  ownerId: string;
  followUpDate: string | null;
  lastActivityAt: string;
  isStale: boolean;
  reasons: NeedsAttentionReason[];
  lastConversation: ConversationSnippet | null;
};

export type SnippetRow = {
  type: ActivityType | null;
  snippet: string | null;
  content_length: number | null;
  occurred_at: string | null;
};

export const SNIPPET_COLUMNS = "type, snippet, content_length, occurred_at";

const FOLLOW_UP_COLUMNS = `id, prospect_id, owner_id, due_date, note, status, completed_at, completed_by, created_at, bucket, prospect:prospects(id, name, company, stage, latest_conversation_activities(${SNIPPET_COLUMNS}))`;

const NEEDS_ATTENTION_COLUMNS = `id, name, company, stage, owner_id, follow_up_date, last_activity_at, is_stale, latest_conversation_activities(${SNIPPET_COLUMNS})`;

/** Open stage AND (stale OR no pending follow-up). */
const CLOSED_STAGE_LIST = `(${CLOSED_STAGES.join(",")})`;
const NEEDS_ATTENTION_FILTER = "is_stale.is.true,follow_up_date.is.null";

export function toSnippet(rows: SnippetRow[] | SnippetRow | null | undefined): ConversationSnippet | null {
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.type || row.snippet === null || !row.occurred_at) return null;
  return {
    type: row.type,
    snippet: row.snippet,
    contentLength: row.content_length ?? row.snippet.length,
    occurredAt: row.occurred_at,
  };
}

/** Managers may filter by owner; reps are scoped by RLS (their owner param is ignored). */
export function effectiveOwner(ctx: DataContext, ownerId: string | null | undefined): string | null {
  return ctx.user.role === "manager" ? (ownerId ?? null) : null;
}

async function bucketCounts(ctx: DataContext, ownerId: string | null): Promise<ActionResult<FollowUpTabCounts>> {
  const { data, error } = await ctx.supabase
    .rpc("follow_up_bucket_counts", ownerId ? { p_owner_id: ownerId } : {})
    .maybeSingle();
  if (error) return dbFailure("followUpBucketCounts", error, "Could not load the follow-up counts.");
  return ok(
    data
      ? {
          overdue: data.overdue,
          today: data.today,
          upcoming: data.upcoming,
          completed: data.completed,
        }
      : EMPTY_FOLLOW_UP_COUNTS,
  );
}

/** Tab counts (overdue / today / upcoming / completed) of everything visible, or one owner's (managers). */
export async function getFollowUpCountsData(
  ctx: DataContext,
  input: FollowUpOwnerQuery = {},
): Promise<ActionResult<FollowUpTabCounts>> {
  const parsed = followUpOwnerQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  return bucketCounts(ctx, effectiveOwner(ctx, parsed.data.ownerId));
}

/** Sidebar badge: the current user's own overdue + due-today follow-ups (managers: their own too). */
export async function getFollowUpBadgeCountData(ctx: DataContext): Promise<ActionResult<number>> {
  const result = await bucketCounts(ctx, ctx.user.id);
  return result.ok ? ok(result.data.overdue + result.data.today) : result;
}

/**
 * One tab's follow-ups with the prospect (name, company, stage) and its latest
 * call/conversation/note snippet, embedded in the same query (no N+1).
 * Pending tabs: due date ascending (most overdue first); completed: newest first.
 */
export async function listFollowUpsData(
  ctx: DataContext,
  input: FollowUpListQuery,
): Promise<ActionResult<{ rows: FollowUpListRow[]; truncated: boolean }>> {
  const parsed = followUpListQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { tab } = parsed.data;
  const limit = parsed.data.limit ?? FOLLOW_UPS_LIMIT;
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);

  let query = ctx.supabase.from("follow_up_buckets").select(FOLLOW_UP_COLUMNS).eq("bucket", tab);
  if (ownerId) query = query.eq("owner_id", ownerId);
  query =
    tab === "completed"
      ? query.order("completed_at", { ascending: false })
      : query.order("due_date", { ascending: true }).order("created_at", { ascending: true });

  const { data, error } = await query.order("id", { ascending: true }).limit(limit + 1);
  if (error) return dbFailure("listFollowUps", error, "Could not load the follow-ups. Please try again.");

  const rows = (data ?? []).slice(0, limit).flatMap((row): FollowUpListRow[] => {
    const prospect = Array.isArray(row.prospect) ? row.prospect[0] : row.prospect;
    if (!row.id || !prospect || !isFollowUpListTab(row.bucket)) return [];
    return [
      {
        id: row.id,
        prospectId: row.prospect_id ?? prospect.id,
        ownerId: row.owner_id ?? "",
        dueDate: row.due_date ?? "",
        note: row.note ?? "",
        status: row.status ?? "pending",
        completedAt: row.completed_at,
        completedBy: row.completed_by,
        bucket: row.bucket,
        prospect: {
          id: prospect.id,
          name: prospect.name,
          company: prospect.company,
          stage: prospect.stage,
        },
        lastConversation: toSnippet(prospect.latest_conversation_activities),
      },
    ];
  });
  return ok({ rows, truncated: (data ?? []).length > limit });
}

/**
 * Open deals that need attention (SPEC §1.6 / §9.6): stale (no human activity
 * for stale_days) OR no pending follow-up; least recently active first, with
 * the reasons and the latest conversation snippet. `total` = full count.
 */
export async function listNeedsAttentionData(
  ctx: DataContext,
  input: NeedsAttentionQuery = {},
): Promise<ActionResult<{ rows: NeedsAttentionRow[]; total: number }>> {
  const parsed = needsAttentionQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const limit = parsed.data.limit ?? NEEDS_ATTENTION_LIMIT;

  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);

  let query = ctx.supabase
    .from("prospects_with_flags")
    .select(NEEDS_ATTENTION_COLUMNS, { count: "exact" })
    .not("stage", "in", CLOSED_STAGE_LIST)
    .or(NEEDS_ATTENTION_FILTER);
  if (ownerId) query = query.eq("owner_id", ownerId);

  const { data, error, count } = await query
    .order("last_activity_at", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) return dbFailure("listNeedsAttention", error, "Could not load the deals that need attention.");

  const rows = (data ?? []).flatMap((row): NeedsAttentionRow[] => {
    if (!row.id || !row.stage) return [];
    const isStale = row.is_stale ?? false;
    return [
      {
        id: row.id,
        name: row.name ?? "",
        company: row.company,
        stage: row.stage,
        ownerId: row.owner_id ?? "",
        followUpDate: row.follow_up_date,
        lastActivityAt: row.last_activity_at ?? "",
        isStale,
        reasons: needsAttentionReasons({
          is_stale: isStale,
          follow_up_date: row.follow_up_date,
        }),
        lastConversation: toSnippet(row.latest_conversation_activities),
      },
    ];
  });
  return ok({ rows, total: count ?? rows.length });
}

/** Count only (tab label / dashboard tile). */
export async function countNeedsAttentionData(
  ctx: DataContext,
  input: FollowUpOwnerQuery = {},
): Promise<ActionResult<number>> {
  const parsed = followUpOwnerQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  let query = ctx.supabase
    .from("prospects_with_flags")
    .select("id", { count: "exact", head: true })
    .not("stage", "in", CLOSED_STAGE_LIST)
    .or(NEEDS_ATTENTION_FILTER);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { count, error } = await query;
  if (error) return dbFailure("countNeedsAttention", error, "Could not load the deals that need attention.");
  return ok(count ?? 0);
}
