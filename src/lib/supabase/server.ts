import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

/**
 * User-scoped Supabase client for Server Components, Server Actions and Route
 * Handlers. Acts as the signed-in user, so RLS is the security boundary.
 * Create a new client per request; never share one across requests.
 */
export async function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: the middleware/proxy refreshes the session.
        }
      },
    },
  });
}
