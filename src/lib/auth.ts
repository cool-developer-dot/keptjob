import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import type { Role } from "@/lib/constants";
import { DEFAULT_AUTHENTICATED_PATH } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
};

/**
 * The signed-in user's profile from public.users (role from public.users.role,
 * never from user-editable metadata), or null when signed out.
 *
 * Cached per request (React cache), so layouts, pages and server actions can
 * all call it freely. Uses getClaims() (verified JWT), never getSession().
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("id, full_name, email, role")
    .eq("id", userId)
    .maybeSingle();

  return profile ?? null;
});

/** Returns the current user or redirects to /login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Returns the current user if they are a manager; otherwise redirects
 * (signed out → /login, sales rep → /dashboard). Call it at the top of every
 * manager-only page and server action (before using the admin client).
 */
export async function requireManager(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "manager") redirect(DEFAULT_AUTHENTICATED_PATH);
  return user;
}
