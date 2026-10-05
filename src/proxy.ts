import { NextResponse, type NextRequest } from "next/server";

import {
  DEFAULT_AUTHENTICATED_PATH,
  isManagerOnlyPath,
  isPublicPath,
  isSignedOutOnlyPath,
} from "@/lib/safe-redirect";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 proxy (formerly middleware): refreshes the Supabase session on
 * every request and applies the route guards. Pages re-check on the server
 * (requireUser / requireManager); this is the first line, not the only one.
 */
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  // Redirect while keeping any refreshed auth cookies from updateSession.
  const redirectTo = (path: string, params?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = params ? `?${new URLSearchParams(params)}` : "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!user) {
    if (isPublicPath(pathname)) return response;
    const next = `${pathname}${search}`;
    return redirectTo("/login", pathname === "/" ? undefined : { next });
  }

  if (isSignedOutOnlyPath(pathname)) {
    return redirectTo(DEFAULT_AUTHENTICATED_PATH);
  }

  // Role from app_metadata (raw_app_meta_data): not user-editable.
  if (isManagerOnlyPath(pathname) && user.app_metadata?.role !== "manager") {
    return redirectTo(DEFAULT_AUTHENTICATED_PATH);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
