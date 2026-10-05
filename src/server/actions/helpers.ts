import "server-only";

import { revalidatePath } from "next/cache";

import { getCurrentUser, requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DataContext } from "@/server/data/context";

/**
 * Builds the data-layer context for a server action: the user-scoped Supabase
 * client (RLS applies; never the service role) + the signed-in user.
 * Returns null when signed out (the action then returns a session error).
 */
export async function getActionContext(): Promise<DataContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { supabase: await createClient(), user: { id: user.id, role: user.role } };
}

/** Like getActionContext, but manager-only: requireManager() redirects others. */
export async function getManagerActionContext(): Promise<DataContext> {
  const user = await requireManager();
  return { supabase: await createClient(), user: { id: user.id, role: user.role } };
}

/** Pages that show prospect, follow-up or activity data. */
const PROSPECT_PAGES = ["/prospects", "/pipeline", "/follow-ups", "/dashboard", "/reports"] as const;

/** Revalidates every page affected by a prospect / follow-up / activity change. */
export function revalidateProspect(prospectId?: string | null): void {
  for (const path of PROSPECT_PAGES) revalidatePath(path);
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
}
