import "server-only";

import type { DecisionMakerStatus, ObjectionCategory, PipelineStage } from "@/lib/constants";
import {
  PROSPECTS_PAGE_SIZE,
  searchOrFilter,
  type ProspectListParams,
  type ProspectSortKey,
} from "@/lib/validation/prospect-list";
import type { ActionResult } from "@/server/actions/types";

import type { DataContext } from "./context";
import { dbFailure, ok } from "./errors";

/** One row of the prospects list (prospects_with_flags, non-null where the table is). */
export type ProspectListRow = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  stage: PipelineStage;
  decision_maker_status: DecisionMakerStatus;
  objections: ObjectionCategory[];
  follow_up_date: string | null;
  owner_id: string;
  last_activity_at: string;
  deal_value: number | null;
  currency: string;
  is_stale: boolean;
  has_overdue_follow_up: boolean;
};

export type ProspectListResult = {
  rows: ProspectListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

const LIST_COLUMNS =
  "id, name, company, email, stage, decision_maker_status, objections, follow_up_date, owner_id, last_activity_at, deal_value, currency, is_stale, has_overdue_follow_up";

/** URL sort key → view column (whitelist; nothing from the URL reaches .order() directly). */
const SORT_COLUMNS: Readonly<Record<ProspectSortKey, string>> = {
  name: "name",
  company: "company",
  stage: "stage", // enum order = pipeline order
  follow_up: "follow_up_date",
  last_activity: "last_activity_at",
  deal_value: "deal_value",
};

/**
 * The prospects list: search, filters, sort and pagination over the
 * prospects_with_flags view (security_invoker) with the **user-scoped** client,
 * so RLS limits reps to their own rows. The owner filter only applies to
 * managers. A page past the end falls back to the last page.
 */
export async function listProspectsData(
  ctx: DataContext,
  params: ProspectListParams,
): Promise<ActionResult<ProspectListResult>> {
  const pageSize = PROSPECTS_PAGE_SIZE;

  const run = (page: number) => {
    let query = ctx.supabase
      .from("prospects_with_flags")
      .select(LIST_COLUMNS, { count: "exact" });

    if (params.q) query = query.or(searchOrFilter(params.q));
    if (params.stage) query = query.eq("stage", params.stage);
    if (params.owner && ctx.user.role === "manager") query = query.eq("owner_id", params.owner);
    if (params.dm) query = query.eq("decision_maker_status", params.dm);
    if (params.objection) query = query.contains("objections", [params.objection]);
    if (params.overdue) query = query.eq("has_overdue_follow_up", true);
    if (params.stale) query = query.eq("is_stale", true);

    const ascending = params.dir === "asc";
    const from = (page - 1) * pageSize;
    return query
      .order(SORT_COLUMNS[params.sort], { ascending, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
  };

  let page = params.page;
  let { data, count, error } = await run(page);

  // Offset past the end: PostgREST answers 416 (PGRST103) or an empty page.
  // Fall back to the last page (count comes from a first-page query if needed).
  if (page > 1 && (error?.code === "PGRST103" || (!error && (data?.length ?? 0) === 0))) {
    const total = error || count === null ? ((await run(1)).count ?? 0) : count;
    page = Math.max(1, Math.ceil(total / pageSize));
    ({ data, count, error } = await run(page));
  }
  if (error) return dbFailure("listProspects", error, "Could not load prospects. Please try again.");

  const total = count ?? 0;
  return ok({
    rows: (data ?? []).map(toListRow),
    total,
    page: total === 0 ? 1 : page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
}

type ViewRow = { [K in keyof ProspectListRow]: ProspectListRow[K] | null };

function toListRow(row: ViewRow): ProspectListRow {
  return {
    id: row.id ?? "",
    name: row.name ?? "",
    company: row.company,
    email: row.email,
    stage: row.stage ?? "prospect",
    decision_maker_status: row.decision_maker_status ?? "unknown",
    objections: row.objections ?? [],
    follow_up_date: row.follow_up_date,
    owner_id: row.owner_id ?? "",
    last_activity_at: row.last_activity_at ?? "",
    deal_value: row.deal_value,
    currency: (row.currency ?? "").trim(),
    is_stale: row.is_stale ?? false,
    has_overdue_follow_up: row.has_overdue_follow_up ?? false,
  };
}
