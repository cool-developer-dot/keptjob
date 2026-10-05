import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@/lib/constants";
import type { Database, Tables } from "@/lib/supabase/database.types";

/**
 * What every data function needs: a **user-scoped** Supabase client (RLS
 * applies; never the service role) and the signed-in user. Server actions build
 * it from cookies; integration tests from a signed-in supabase-js client.
 */
export type DataContext = {
  supabase: SupabaseClient<Database>;
  user: { id: string; role: Role };
};

export type ProspectRow = Tables<"prospects">;
export type ActivityRow = Tables<"activities">;
export type FollowUpRow = Tables<"follow_ups">;
