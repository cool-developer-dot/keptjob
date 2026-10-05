"use server";

import { revalidatePath } from "next/cache";

import { requireManager } from "@/lib/auth";
import type { Role } from "@/lib/constants";
import { toOrgSettings, type OrgSettings } from "@/lib/org-settings";
import { getSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  changeRoleSchema,
  inviteUserSchema,
  orgSettingsSchema,
  type ChangeRoleInput,
  type InviteUserInput,
  type OrgSettingsInput,
} from "@/lib/validation/settings";

import type { ActionResult } from "./types";

const INVALID_INPUT = "Please check the form and try again.";
const EMAIL_EXISTS = "A user with this email already exists.";
const LAST_MANAGER = "At least one manager must remain. Promote another user to manager first.";

/**
 * Updates the org settings row (managers only). Uses the user-scoped client so
 * RLS (org_settings_update_manager) applies; the payload holds only the granted
 * columns (updated_by/updated_at are set by triggers).
 */
export async function updateOrgSettings(input: OrgSettingsInput): Promise<ActionResult<OrgSettings>> {
  await requireManager();
  const parsed = orgSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_INPUT };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_settings")
    .update({
      default_currency: parsed.data.defaultCurrency,
      timezone: parsed.data.timezone,
      stale_days: parsed.data.staleDays,
    })
    .eq("id", true)
    .select("default_currency, timezone, stale_days");

  if (error) {
    console.error("updateOrgSettings failed", error);
    return { ok: false, error: "Could not save the settings. Please try again." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "You don't have permission to change the settings." };
  }

  // The (app) layout passes the settings to OrgSettingsProvider: refresh everything.
  revalidatePath("/", "layout");
  return { ok: true, data: toOrgSettings(data[0]) };
}

/**
 * Invites a user by email (managers only). requireManager() runs before the
 * service-role client is created. The invite email (Supabase auth email) links
 * to /auth/confirm?type=invite → /set-password.
 */
export async function inviteUser(
  input: InviteUserInput,
): Promise<ActionResult<{ id: string; email: string; role: Role }>> {
  await requireManager();
  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_INPUT };
  const { fullName, email, role } = parsed.data;

  // Friendly early answer for existing users (GoTrue also rejects them).
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email) // GoTrue stores emails lowercased; the schema lowercases input.
    .limit(1);
  if (existing && existing.length > 0) return { ok: false, error: EMAIL_EXISTS };

  const admin = createAdminClient();
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${await getSiteUrl()}/auth/confirm`,
  });

  if (inviteError || !invited?.user) {
    if (
      inviteError?.code === "email_exists" ||
      inviteError?.code === "user_already_exists" ||
      /already (been )?registered/i.test(inviteError?.message ?? "")
    ) {
      return { ok: false, error: EMAIL_EXISTS };
    }
    if (inviteError?.status === 429 || inviteError?.code === "over_email_send_rate_limit") {
      return { ok: false, error: "Too many emails sent. Please wait a while and try again." };
    }
    console.error("inviteUser: invite failed", inviteError);
    return { ok: false, error: "Could not send the invitation. Please try again." };
  }

  // The role lives in app_metadata (not user-editable). The on_auth_user_updated
  // trigger mirrors it into public.users.role (created as sales_rep by default).
  const userId = invited.user.id;
  const { error: roleError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { role },
  });
  if (roleError) {
    console.error("inviteUser: setting the role failed", roleError);
    // Don't leave a half-configured account behind.
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, error: "Could not set up the new user. Please try again." };
  }

  revalidatePath("/settings");
  return { ok: true, data: { id: userId, email, role } };
}

/**
 * Changes a user's role (managers only) through the user-scoped client, so RLS,
 * users_before_update_guard, the last-manager rule and the role → auth sync
 * triggers all apply.
 */
export async function changeUserRole(
  input: ChangeRoleInput,
): Promise<ActionResult<{ id: string; role: Role }>> {
  await requireManager();
  const parsed = changeRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_INPUT };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.userId)
    .select("id, role");

  if (error) {
    if (error.code === "P0001" || /at least one manager must remain/i.test(error.message)) {
      return { ok: false, error: LAST_MANAGER };
    }
    if (error.code === "42501") {
      return { ok: false, error: "Only managers can change roles." };
    }
    console.error("changeUserRole failed", error);
    return { ok: false, error: "Could not change the role. Please try again." };
  }
  if (!data || data.length === 0) return { ok: false, error: "User not found." };

  revalidatePath("/", "layout");
  return { ok: true, data: data[0] };
}
