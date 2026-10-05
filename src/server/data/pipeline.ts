import "server-only";

import type { DealHealth } from "@/lib/constants";
import type { PipelineCard } from "@/lib/pipeline";
import type { PipelineParams } from "@/lib/validation/pipeline";
import { searchOrFilter } from "@/lib/validation/prospect-list";
import type { ActionResult } from "@/server/actions/types";

import type { DataContext } from "./context";
import { dbFailure, ok } from "./errors";

/** Max cards on the board (limit + 1 must stay ≤ PostgREST max_rows = 1000); more → `truncated`. */
export const PIPELINE_LIMIT = 500;

export type PipelineData = { cards: PipelineCard[]; truncated: boolean };

// latest_ai_insights is embedded per prospect (FK prospect_id → prospects.id;
// the prospect_id filter is pushed into the distinct-on view → index lookup).
const CARD_COLUMNS =
  "id, name, company, stage, owner_id, decision_maker_status, follow_up_date, deal_value, currency, demo_at, is_stale, has_overdue_follow_up, last_activity_at, latest_ai_insights(deal_health)";

/**
 * Kanban cards: prospects_with_flags (security_invoker → RLS: reps get only
 * their own) filtered by search and, for managers, owner; most recently active
 * first, capped at PIPELINE_LIMIT. The newest AI insight per prospect comes
 * from the embedded latest_ai_insights view (also RLS-scoped) for the health badge.
 */
export async function listPipelineData(
  ctx: DataContext,
  params: PipelineParams,
): Promise<ActionResult<PipelineData>> {
  let query = ctx.supabase.from("prospects_with_flags").select(CARD_COLUMNS);
  if (params.q) query = query.or(searchOrFilter(params.q));
  if (params.owner && ctx.user.role === "manager") query = query.eq("owner_id", params.owner);

  const { data, error } = await query
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(PIPELINE_LIMIT + 1);
  if (error) return dbFailure("listPipeline", error, "Could not load the pipeline. Please try again.");

  const rows = data ?? [];
  const truncated = rows.length > PIPELINE_LIMIT;
  const cards = rows.slice(0, PIPELINE_LIMIT).map(
    (row): PipelineCard => ({
      id: row.id ?? "",
      name: row.name ?? "",
      company: row.company,
      stage: row.stage ?? "prospect",
      owner_id: row.owner_id ?? "",
      decision_maker_status: row.decision_maker_status ?? "unknown",
      follow_up_date: row.follow_up_date,
      deal_value: row.deal_value === null ? null : Number(row.deal_value),
      currency: (row.currency ?? "").trim(),
      demo_at: row.demo_at,
      is_stale: row.is_stale ?? false,
      has_overdue_follow_up: row.has_overdue_follow_up ?? false,
      last_activity_at: row.last_activity_at ?? "",
      ai_health: latestHealth(row.latest_ai_insights),
    }),
  );
  return ok({ cards, truncated });
}

/** Embedded view rows: 0 or 1 (distinct on prospect_id); PostgREST returns an array. */
function latestHealth(rows: { deal_health: DealHealth | null }[] | null | undefined): DealHealth | null {
  return rows?.[0]?.deal_health ?? null;
}
