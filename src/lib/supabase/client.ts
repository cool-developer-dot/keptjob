import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

/** User-scoped Supabase client for Client Components. RLS applies. */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
