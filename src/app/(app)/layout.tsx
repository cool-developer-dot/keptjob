import Link from "next/link";

import { MobileNav } from "@/components/app-shell/mobile-nav";
import { NavLinks } from "@/components/app-shell/nav-links";
import { UserMenu } from "@/components/app-shell/user-menu";
import { OrgSettingsProvider } from "@/components/org-settings-provider";
import { requireUser } from "@/lib/auth";
import { getOrgSettings } from "@/lib/org";

/**
 * Authenticated app shell: sidebar (sheet on mobile) + header. Provides the org
 * settings (timezone, currency, stale days) to client components.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const orgSettings = await getOrgSettings();

  return (
    <OrgSettingsProvider value={orgSettings}>
      <div className="flex min-h-svh w-full">
        <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-6 border-r bg-muted/30 p-4 md:flex">
          <Link href="/dashboard" className="px-3 text-base font-semibold tracking-tight">
            AI Sales CRM
          </Link>
          <NavLinks role={user.role} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background/95 px-4 backdrop-blur md:px-6">
            <div className="flex items-center gap-2">
              <MobileNav role={user.role} />
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
