"use server";

import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/safe-redirect";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  loginSchema,
  setPasswordSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type SetPasswordInput,
} from "@/lib/validation/auth";

import type { ActionResult } from "./types";

const INVALID_INPUT = "Please check the form and try again.";

/** Email + password sign-in. On success redirects to a safe `next` path. */
export async function signIn(input: LoginInput, next?: string | null): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_INPUT };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "invalid_credentials" || error.status === 400) {
      return { ok: false, error: "Invalid email or password." };
    }
    if (error.status === 429) {
      return { ok: false, error: "Too many attempts. Please wait a moment and try again." };
    }
    return { ok: false, error: "Could not sign in. Please try again." };
  }

  redirect(safeNextPath(next));
}

/**
 * Sends a password-reset email (local: Mailpit). Always reports success for a
 * well-formed email so the form never reveals which accounts exist.
 */
export async function requestPasswordReset(input: ForgotPasswordInput): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_INPUT };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await getSiteUrl()}/auth/confirm`,
  });
  if (error?.status === 429) {
    return { ok: false, error: "Too many requests. Please wait a moment and try again." };
  }
  // Other errors (e.g. unknown email) are deliberately not surfaced.
  return { ok: true, data: undefined };
}

/** Sets a new password for the signed-in user (invite / recovery), then → /dashboard. */
export async function setPassword(input: SetPasswordInput): Promise<ActionResult> {
  const parsed = setPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_INPUT };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Your session has expired. Request a new link and try again." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") {
      return { ok: false, error: "Choose a password different from your current one." };
    }
    if (error.code === "weak_password") {
      return { ok: false, error: "That password is too weak. Choose a longer one." };
    }
    return { ok: false, error: "Could not update your password. Please try again." };
  }

  redirect("/dashboard");
}

/** Signs out (this session) and returns to /login. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
