"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Role } from "@/lib/constants";
import { cn } from "@/lib/utils";

import { isActivePath, navItemsForRole } from "./nav-items";

/** Count pills next to nav items, keyed by href (e.g. "/follow-ups": own overdue + today). */
export type NavBadges = Partial<Record<string, NavBadge>>;
export type NavBadge = { count: number; label: string };

export function NavLinks({ role, badges, onNavigate }: { role: Role; badges?: NavBadges; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      <p className="px-3 pb-1 text-[0.7rem] font-medium tracking-wider text-muted-foreground/80 uppercase">Menu</p>
      {navItemsForRole(role).map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        const badge = badges?.[href];
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-10 items-center gap-3 rounded-xl border border-transparent px-3 text-sm font-medium text-muted-foreground transition-all duration-200 outline-none hover:bg-white/55 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-white/10",
              active &&
                "glass-tile border-white/90 bg-white/80 text-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0),0_4px_14px_-6px_oklch(0.25_0.01_255/0.25)] dark:border-white/10 dark:bg-white/15",
            )}
          >
            <Icon
              className={cn("size-[1.1rem] transition-colors", active ? "text-foreground" : "group-hover:text-foreground")}
              aria-hidden
            />
            {label}
            {badge && badge.count > 0 && (
              <span
                data-nav-badge={href}
                title={badge.label}
                className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[linear-gradient(180deg,oklch(0.66_0.21_25),oklch(0.56_0.22_25))] px-1.5 text-[0.7rem] leading-5 font-semibold text-white tabular-nums shadow-[inset_0_1px_0_0_oklch(1_0_0/0.3),0_2px_6px_-2px_oklch(0.55_0.22_25/0.6)]"
              >
                {badge.count > 99 ? "99+" : badge.count}
                <span className="sr-only"> ({badge.label})</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
