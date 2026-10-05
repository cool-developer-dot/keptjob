import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** Auth email links handled here (SPEC §4: invites + forgot password only). */
const ALLOWED_TYPES = ["invite", "recovery"] as const satisfies readonly EmailOtpType[];
type AllowedType = (typeof ALLOWED_TYPES)[number];

function isAllowedType(value: string | null): value is AllowedType {
  return (ALLOWED_TYPES as readonly string[]).includes(value ?? "");
}

/**
 * GET /auth/confirm?token_hash=...&type=invite|recovery
 *
 * Linked from the Supabase auth email templates (supabase/templates/*.html).
 * Verifies the one-time token server-side, which sets the session cookies,
 * then sends the user to /set-password. The destination is fixed (no `next`
 * parameter is honoured), so the link can't be used as an open redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const fail = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?error=invalid_link";
    return NextResponse.redirect(url);
  };

  if (searchParams.has("error") || !tokenHash || !isAllowedType(type)) {
    return fail();
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return fail();

  const url = request.nextUrl.clone();
  url.pathname = "/set-password";
  url.search = "";
  return NextResponse.redirect(url);
}
