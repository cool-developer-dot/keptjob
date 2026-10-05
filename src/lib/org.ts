import "server-only";

import { cache } from "react";

import { DEFAULT_ORG_SETTINGS, toOrgSettings, type OrgSettings } from "@/lib/org-settings";
import { createClient } from "@/lib/supabase/server";

/**
 * The org settings row (currency, timezone, stale days), read through RLS
 * (any signed-in user may select it). Cached per request with React cache(),
 * so layouts, pages and actions can call it freely. Falls back to the
 * migration defaults if the row can't be read (e.g. signed out).
 */
export const getOrgSettings = cache(async (): Promise<OrgSettings> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_settings")
    .select("default_currency, timezone, stale_days")
    .eq("id", true)
    .maybeSingle();

  if (error || !data) return DEFAULT_ORG_SETTINGS;
  return toOrgSettings(data);
});
