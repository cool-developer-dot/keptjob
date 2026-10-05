/**
 * /follow-ups URL state: `tab` (overdue | today | upcoming | completed |
 * attention; default overdue) + `owner` (managers only). Pure and client-safe;
 * every key is parsed independently, invalid → default (never throws).
 */
import { z } from "zod";

import { FOLLOW_UP_LIST_TABS, FOLLOW_UP_PAGE_TABS, type FollowUpPageTab } from "@/lib/follow-ups";

export const FOLLOW_UPS_PATH = "/follow-ups";

export type FollowUpsParams = {
  tab: FollowUpPageTab;
  owner: string | null;
};

export const DEFAULT_FOLLOW_UPS_PARAMS: FollowUpsParams = {
  tab: "overdue",
  owner: null,
};

type RawValue = string | string[] | undefined | null;
export type RawFollowUpsSearchParams = Record<string, RawValue> | URLSearchParams;

const tabSchema = z.enum(FOLLOW_UP_PAGE_TABS).catch(DEFAULT_FOLLOW_UPS_PARAMS.tab);
const ownerSchema = z.uuid().nullable().catch(null);

function first(params: RawFollowUpsSearchParams, key: string): string | null {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Parses URL search params; unknown/invalid values → defaults. */
export function parseFollowUpsParams(params: RawFollowUpsSearchParams): FollowUpsParams {
  return {
    tab: tabSchema.parse(first(params, "tab") ?? DEFAULT_FOLLOW_UPS_PARAMS.tab),
    owner: ownerSchema.parse(first(params, "owner")),
  };
}

/** `/follow-ups?…` with `overrides` applied (non-default values only). */
export function followUpsHref(params: FollowUpsParams, overrides: Partial<FollowUpsParams> = {}): string {
  const next = { ...params, ...overrides };
  const out = new URLSearchParams();
  if (next.tab !== DEFAULT_FOLLOW_UPS_PARAMS.tab) out.set("tab", next.tab);
  if (next.owner) out.set("owner", next.owner);
  const query = out.toString();
  return query ? `${FOLLOW_UPS_PATH}?${query}` : FOLLOW_UPS_PATH;
}

/** Data-layer inputs (src/server/data/follow-up-views.ts). */
export const followUpOwnerQuerySchema = z.strictObject({
  ownerId: z.uuid().nullish(),
});
export type FollowUpOwnerQuery = z.input<typeof followUpOwnerQuerySchema>;

export const followUpListQuerySchema = z.strictObject({
  tab: z.enum(FOLLOW_UP_LIST_TABS),
  ownerId: z.uuid().nullish(),
  limit: z.int().min(1).max(500).optional(),
});
export type FollowUpListQuery = z.input<typeof followUpListQuerySchema>;

export const needsAttentionQuerySchema = z.strictObject({
  ownerId: z.uuid().nullish(),
  limit: z.int().min(1).max(500).optional(),
});
export type NeedsAttentionQuery = z.input<typeof needsAttentionQuerySchema>;
