/**
 * Route classification + open-redirect protection, shared by the proxy
 * (src/proxy.ts), the login action and pages. Pure; unit-tested.
 */

/** Routes reachable without a session. */
export const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth/confirm"] as const;

/** Public routes that a signed-in user is bounced away from (→ /dashboard). */
export const SIGNED_OUT_ONLY_PATHS = ["/login", "/forgot-password"] as const;

export const DEFAULT_AUTHENTICATED_PATH = "/dashboard";

function matches(pathname: string, paths: readonly string[]) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isPublicPath(pathname: string) {
  return matches(pathname, PUBLIC_PATHS);
}

export function isSignedOutOnlyPath(pathname: string) {
  return matches(pathname, SIGNED_OUT_ONLY_PATHS);
}

export function isManagerOnlyPath(pathname: string) {
  return matches(pathname, ["/settings"]);
}

/**
 * Returns `next` only if it is a safe same-origin relative path (e.g. from
 * `/login?next=...`), otherwise `fallback`. Rejects absolute and
 * protocol-relative URLs (`https://x`, `//x`, `/\x`), control characters and
 * auth routes (to avoid loops).
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback: string = DEFAULT_AUTHENTICATED_PATH,
): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Control characters / whitespace (browsers strip tabs/newlines, enabling `/\t/evil.com`).
  if (/[\u0000-\u001F\u007F\s\\]/.test(next)) return fallback;

  let url: URL;
  try {
    url = new URL(next, "http://internal.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://internal.invalid") return fallback;
  if (isPublicPath(url.pathname) || url.pathname === "/set-password") return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}
