import Link from "next/link";

import { MobileNav } from "@/components/app-shell/mobile-nav";
import { NavLinks, type NavBadges } from "@/components/app-shell/nav-links";
import { UserMenu } from "@/components/app-shell/user-menu";
import { OrgSettingsProvider } from "@/components/org-settings-provider";
import { requireUser } from "@/lib/auth";
import type { Role } from "@/lib/constants";
import { getOrgSettings } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { getFollowUpBadgeCountData } from "@/server/data/follow-up-views";

/**
 * Authenticated app shell: sidebar (sheet on mobile) + header. Provides the org
 * settings (timezone, currency, stale days) to client components. The
 * Follow-ups nav item shows the user's own overdue + due-today count (managers:
 * their own too); server actions that touch follow-ups revalidate it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [orgSettings, followUpsDue] = await Promise.all([getOrgSettings(), followUpBadgeCount(user)]);
  const badges: NavBadges = {
    "/follow-ups": {
      count: followUpsDue,
      label: `${followUpsDue} follow-up${followUpsDue === 1 ? "" : "s"} due today or overdue`,
    },
  };

  return (
    <OrgSettingsProvider value={orgSettings}>
      <div className="flex min-h-svh w-full">
        <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-6 border-r bg-muted/30 p-4 md:flex">
          <Link href="/dashboard" className="px-3 text-base font-semibold tracking-tight">
            AI Sales CRM
          </Link>
          <NavLinks role={user.role} badges={badges} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background/95 px-4 backdrop-blur md:px-6">
            <div className="flex items-center gap-2">
              <MobileNav role={user.role} badges={badges} />
              <span className="hidden font-semibold tracking-tight whitespace-nowrap sm:inline md:hidden">
                AI Sales CRM
              </span>
            </div>
            <UserMenu user={user} />
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </OrgSettingsProvider>
  );
}

/** Own overdue + today follow-ups; a failure only hides the badge (never breaks the shell). */
async function followUpBadgeCount(user: { id: string; role: Role }): Promise<number> {
  const result = await getFollowUpBadgeCountData({
    supabase: await createClient(),
    user: { id: user.id, role: user.role },
  });
  return result.ok ? result.data : 0;
}
