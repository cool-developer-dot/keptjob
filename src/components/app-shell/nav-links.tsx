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
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-muted text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {badge && badge.count > 0 && (
              <span
                data-nav-badge={href}
                title={badge.label}
                className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs leading-5 font-semibold text-white tabular-nums dark:bg-red-500"
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
