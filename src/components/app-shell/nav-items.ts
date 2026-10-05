import {
  CalendarCheckIcon,
  ChartColumnIcon,
  KanbanIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/constants";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Only rendered for managers (also enforced in proxy + requireManager). */
  managerOnly?: boolean;
};

/** Main navigation (SPEC §11). */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/pipeline", label: "Pipeline", icon: KanbanIcon },
  { href: "/prospects", label: "Prospects", icon: UsersIcon },
  { href: "/follow-ups", label: "Follow-ups", icon: CalendarCheckIcon },
  { href: "/reports", label: "Reports", icon: ChartColumnIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon, managerOnly: true },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.managerOnly || role === "manager");
}

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
