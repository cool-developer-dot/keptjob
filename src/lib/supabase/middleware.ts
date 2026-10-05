import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

/**
 * Refreshes the Supabase auth session for an incoming request and returns the
 * response carrying any updated auth cookies, plus the current user (or null).
 *
 * Used by the root `src/proxy.ts` (Next 16's name for middleware), added in
 * Prompt 3, which decides redirects. Always return (or copy cookies from)
 * `response`, otherwise refreshed session cookies are lost.
 */
export async function updateSession(request: NextRequest) {
  const { url, anonKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  // Do not run code between createServerClient and getUser(): getUser()
  // revalidates the token with the Auth server and triggers cookie refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
