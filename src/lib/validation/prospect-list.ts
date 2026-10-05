/**
 * Prospects list URL state (search, filters, sort, page). Client-safe and pure:
 * the server page parses `searchParams` with it, client components build links
 * with `prospectListHref()`. Every key is parsed independently, so an invalid
 * value falls back to its default instead of failing the whole page.
 */
import { z } from "zod";

import {
  DECISION_MAKER_STATUSES,
  OBJECTION_CATEGORIES,
  PIPELINE_STAGES,
  type DecisionMakerStatus,
  type ObjectionCategory,
  type PipelineStage,
} from "@/lib/constants";

export const PROSPECTS_PATH = "/prospects";
export const PROSPECTS_PAGE_SIZE = 25;
export const SEARCH_MAX_LENGTH = 100;
const MAX_PAGE = 10_000;

/** Sortable columns (URL value → the data layer maps them to DB columns). */
export const PROSPECT_SORT_KEYS = [
  "name",
  "company",
  "stage",
  "follow_up",
  "last_activity",
  "deal_value",
] as const;
export type ProspectSortKey = (typeof PROSPECT_SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

/** Direction used when a column is first clicked (and when `dir` is absent). */
export const DEFAULT_SORT_DIRECTION: Readonly<Record<ProspectSortKey, SortDirection>> = {
  name: "asc",
  company: "asc",
  stage: "asc",
  follow_up: "asc",
  last_activity: "desc",
  deal_value: "desc",
};
export const DEFAULT_SORT: ProspectSortKey = "last_activity";

export type ProspectListParams = {
  q: string;
  stage: PipelineStage | null;
  owner: string | null;
  dm: DecisionMakerStatus | null;
  objection: ObjectionCategory | null;
  overdue: boolean;
  stale: boolean;
  sort: ProspectSortKey;
  dir: SortDirection;
  page: number;
};

export const DEFAULT_PROSPECT_LIST_PARAMS: ProspectListParams = {
  q: "",
  stage: null,
  owner: null,
  dm: null,
  objection: null,
  overdue: false,
  stale: false,
  sort: DEFAULT_SORT,
  dir: DEFAULT_SORT_DIRECTION[DEFAULT_SORT],
  page: 1,
};

type RawValue = string | string[] | undefined | null;
export type RawSearchParams = Record<string, RawValue> | URLSearchParams;

const searchSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH).trim())
  .catch("");
const stageSchema = z.enum(PIPELINE_STAGES).nullable().catch(null);
const ownerSchema = z.uuid().nullable().catch(null);
const dmSchema = z.enum(DECISION_MAKER_STATUSES).nullable().catch(null);
const objectionSchema = z.enum(OBJECTION_CATEGORIES).nullable().catch(null);
const flagSchema = z
  .string()
  .nullable()
  .transform((value) => value === "1" || value === "true")
  .catch(false);
const sortSchema = z.enum(PROSPECT_SORT_KEYS).nullable().catch(null);
const dirSchema = z.enum(["asc", "desc"]).nullable().catch(null);
const pageSchema = z.coerce.number().int().min(1).max(MAX_PAGE).catch(1);

function first(params: RawSearchParams, key: string): string | null {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Parses URL search params; unknown/invalid values → defaults (never throws). */
export function parseProspectListParams(params: RawSearchParams): ProspectListParams {
  const sort = sortSchema.parse(first(params, "sort")) ?? DEFAULT_SORT;
  const page = first(params, "page");
  return {
    q: searchSchema.parse(first(params, "q") ?? ""),
    stage: stageSchema.parse(first(params, "stage")),
    owner: ownerSchema.parse(first(params, "owner")),
    dm: dmSchema.parse(first(params, "dm")),
    objection: objectionSchema.parse(first(params, "objection")),
    overdue: flagSchema.parse(first(params, "overdue")),
    stale: flagSchema.parse(first(params, "stale")),
    sort,
    dir: dirSchema.parse(first(params, "dir")) ?? DEFAULT_SORT_DIRECTION[sort],
    page: page === null ? 1 : pageSchema.parse(page),
  };
}

/** True when any search/filter (not sort/page) is set. */
export function hasActiveFilters(params: ProspectListParams): boolean {
  return Boolean(
    params.q ||
      params.stage ||
      params.owner ||
      params.dm ||
      params.objection ||
      params.overdue ||
      params.stale,
  );
}

/** Serializes non-default values only (clean URLs). */
export function toSearchParams(params: ProspectListParams): URLSearchParams {
  const out = new URLSearchParams();
  if (params.q) out.set("q", params.q);
  if (params.stage) out.set("stage", params.stage);
  if (params.owner) out.set("owner", params.owner);
  if (params.dm) out.set("dm", params.dm);
  if (params.objection) out.set("objection", params.objection);
  if (params.overdue) out.set("overdue", "1");
  if (params.stale) out.set("stale", "1");
  if (params.sort !== DEFAULT_SORT || params.dir !== DEFAULT_SORT_DIRECTION[DEFAULT_SORT]) {
    out.set("sort", params.sort);
    if (params.dir !== DEFAULT_SORT_DIRECTION[params.sort]) out.set("dir", params.dir);
  }
  if (params.page > 1) out.set("page", String(params.page));
  return out;
}

/**
 * `/prospects?…` for `params` with `overrides` applied. Changing anything but
 * `page` resets to page 1 (a new filter/sort starts at the top).
 */
export function prospectListHref(
  params: ProspectListParams,
  overrides: Partial<ProspectListParams> = {},
): string {
  const resetsPage = Object.keys(overrides).some((key) => key !== "page");
  const next: ProspectListParams = { ...params, ...(resetsPage ? { page: 1 } : {}), ...overrides };
  const query = toSearchParams(next).toString();
  return query ? `${PROSPECTS_PATH}?${query}` : PROSPECTS_PATH;
}

/** Href for clicking a column header: toggles the active column, else its default direction. */
export function sortHref(params: ProspectListParams, column: ProspectSortKey): string {
  const dir: SortDirection =
    params.sort === column
      ? params.dir === "asc"
        ? "desc"
        : "asc"
      : DEFAULT_SORT_DIRECTION[column];
  return prospectListHref(params, { sort: column, dir });
}

/** Clears search + filters, keeps the sort. */
export function clearFiltersHref(params: ProspectListParams): string {
  return prospectListHref(params, {
    q: "",
    stage: null,
    owner: null,
    dm: null,
    objection: null,
    overdue: false,
    stale: false,
  });
}

// ---------------------------------------------------------------------------
// Search → PostgREST `or` filter (injection-safe)
// ---------------------------------------------------------------------------

/** Columns searched by the list's free-text search. */
export const SEARCH_COLUMNS = ["name", "company", "email"] as const;

/**
 * Escapes a user term for an ILIKE pattern: `\`, `%`, `_` become literal.
 * PostgREST turns `*` into `%`, so `*` is mapped to `_` (any one character).
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`).replace(/\*/g, "_");
}

/** Wraps a value in PostgREST double quotes so `,` `(` `)` `.` `:` can't add filter clauses. */
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `name.ilike."%term%",company.ilike."%term%",email.ilike."%term%"` for `.or()`. */
export function searchOrFilter(term: string, columns: readonly string[] = SEARCH_COLUMNS): string {
  const pattern = quotePostgrestValue(`%${escapeLikePattern(term)}%`);
  return columns.map((column) => `${column}.ilike.${pattern}`).join(",");
}
