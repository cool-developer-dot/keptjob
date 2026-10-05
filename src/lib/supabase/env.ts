/**
 * Lazily reads the public Supabase env vars. Uses static
 * `process.env.NEXT_PUBLIC_*` access so Next.js inlines them in client bundles.
 * Called inside client factories (never at module top level), so `next build`
 * works without a `.env.local`.
 */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and fill in the values from `npx supabase status`.",
    );
  }

  return { url, anonKey };
}
