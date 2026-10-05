import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

/**
 * Service-role Supabase client. BYPASSES RLS.
 *
 * Only for manager-verified admin actions (inviting users, setting
 * app_metadata.role). Always call requireManager() before using it, and never
 * use it for regular user-facing reads or writes.
 */
export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (server-only).");
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
