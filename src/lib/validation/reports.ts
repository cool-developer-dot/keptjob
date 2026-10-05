/**
 * /reports URL state + data-function input schema. Pure and client-safe;
 * invalid URL values → defaults (never throws).
 *
 * Params: `range` (this_month | last_30 | last_90 | this_quarter | custom;
 * default last_30), `from` + `to` ("YYYY-MM-DD", custom only; from ≤ to and at
 * most MAX_REPORT_DAYS days, otherwise the default preset), `owner` (uuid,
 * managers only — ignored for reps by the page and the data layer).
 */
import { z } from "zod";

import {
  DEFAULT_REPORT_PRESET,
  MAX_REPORT_DAYS,
  REPORT_PRESETS,
  resolveReportRange,
  type ReportPreset,
  type ReportRange,
} from "@/lib/reports";
import { daysBetweenDateStrings, isDateString, type DateString } from "@/lib/time";

import { dateStringSchema } from "./common";

export const REPORTS_PATH = "/reports";

export type ReportsParams = {
  range: ReportPreset;
  /** Custom range only (null otherwise). */
  from: DateString | null;
  to: DateString | null;
  owner: string | null;
};

export const DEFAULT_REPORTS_PARAMS: ReportsParams = {
  range: DEFAULT_REPORT_PRESET,
  from: null,
  to: null,
  owner: null,
};

type RawValue = string | string[] | undefined | null;
export type RawReportsSearchParams = Record<string, RawValue> | URLSearchParams;

const rangeSchema = z.enum(REPORT_PRESETS).catch(DEFAULT_REPORT_PRESET);
const ownerSchema = z.uuid().nullable().catch(null);

function first(params: RawReportsSearchParams, key: string): string | null {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Validates a custom range: real dates, from ≤ to, at most MAX_REPORT_DAYS days. */
export function isValidCustomRange(from: string | null, to: string | null): boolean {
  if (!from || !to || !isDateString(from) || !isDateString(to)) return false;
  const span = daysBetweenDateStrings(from, to);
  return span >= 0 && span < MAX_REPORT_DAYS;
}

/** Parses URL search params; invalid values → defaults (an invalid custom range → the default preset). */
export function parseReportsParams(params: RawReportsSearchParams): ReportsParams {
  const owner = ownerSchema.parse(first(params, "owner"));
  const range = rangeSchema.parse(first(params, "range") ?? DEFAULT_REPORT_PRESET);
  if (range !== "custom") return { range, from: null, to: null, owner };
  const from = first(params, "from");
  const to = first(params, "to");
  if (!isValidCustomRange(from, to)) return { ...DEFAULT_REPORTS_PARAMS, owner };
  return { range, from, to, owner };
}

/** The org calendar days the params select (presets end on the org-local `today`). */
export function reportRangeFor(params: ReportsParams, today: DateString): ReportRange {
  if (params.range === "custom" && params.from && params.to) {
    return resolveReportRange("custom", today, { from: params.from, to: params.to });
  }
  return resolveReportRange(params.range === "custom" ? DEFAULT_REPORT_PRESET : params.range, today);
}

/** `/reports?…` with `overrides` applied (non-default values only; from/to only for custom). */
export function reportsHref(params: ReportsParams, overrides: Partial<ReportsParams> = {}): string {
  const next = { ...params, ...overrides };
  const out = new URLSearchParams();
  if (next.range !== DEFAULT_REPORTS_PARAMS.range) out.set("range", next.range);
  if (next.range === "custom" && next.from && next.to) {
    out.set("from", next.from);
    out.set("to", next.to);
  }
  if (next.owner) out.set("owner", next.owner);
  const query = out.toString();
  return query ? `${REPORTS_PATH}?${query}` : REPORTS_PATH;
}

/** Data-layer input (src/server/data/reports.ts). `ownerId` is honoured for managers only. */
export const reportQuerySchema = z
  .strictObject({
    from: dateStringSchema,
    to: dateStringSchema,
    ownerId: z.uuid().nullish(),
  })
  .refine((value) => value.from <= value.to, {
    message: "The start date must be on or before the end date.",
    path: ["from"],
  });
export type ReportQuery = z.input<typeof reportQuerySchema>;
