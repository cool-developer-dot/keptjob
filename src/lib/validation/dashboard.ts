/**
 * /dashboard URL state (`owner`, managers only) + data-function input schemas.
 * Pure and client-safe; invalid URL values → defaults (never throws).
 */
import { z } from "zod";

import { dateStringSchema } from "./common";

export const DASHBOARD_PATH = "/dashboard";

export type DashboardParams = { owner: string | null };

type RawValue = string | string[] | undefined | null;
export type RawDashboardSearchParams = Record<string, RawValue> | URLSearchParams;

const ownerSchema = z.uuid().nullable().catch(null);

function first(params: RawDashboardSearchParams, key: string): string | null {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function parseDashboardParams(params: RawDashboardSearchParams): DashboardParams {
  return { owner: ownerSchema.parse(first(params, "owner")) };
}

/** `/dashboard` or `/dashboard?owner=<id>`. */
export function dashboardHref(params: DashboardParams, overrides: Partial<DashboardParams> = {}): string {
  const next = { ...params, ...overrides };
  return next.owner ? `${DASHBOARD_PATH}?owner=${encodeURIComponent(next.owner)}` : DASHBOARD_PATH;
}

/** Data-layer inputs (src/server/data/dashboard.ts). `ownerId` is honoured for managers only. */
export const dashboardOwnerQuerySchema = z.strictObject({
  ownerId: z.uuid().nullish(),
});
export type DashboardOwnerQuery = z.input<typeof dashboardOwnerQuerySchema>;

export const dashboardKpiQuerySchema = z.strictObject({
  ownerId: z.uuid().nullish(),
  /** Org-local "today" (orgToday(settings.timezone)); the win-rate window ends here. */
  today: dateStringSchema,
});
export type DashboardKpiQuery = z.input<typeof dashboardKpiQuerySchema>;

export const dashboardListQuerySchema = z.strictObject({
  ownerId: z.uuid().nullish(),
  limit: z.int().min(1).max(100).optional(),
});
export type DashboardListQuery = z.input<typeof dashboardListQuerySchema>;

export const closedOutcomeQuerySchema = z
  .strictObject({
    from: dateStringSchema,
    to: dateStringSchema,
    ownerId: z.uuid().nullish(),
  })
  .refine((value) => value.from <= value.to, { message: "The start date must be on or before the end date.", path: ["from"] });
export type ClosedOutcomeQuery = z.input<typeof closedOutcomeQuerySchema>;
