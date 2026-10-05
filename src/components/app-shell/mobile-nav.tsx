"use client";

import { MenuIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Role } from "@/lib/constants";

import { NavLinks, type NavBadges } from "./nav-links";

/** Below `md`: the sidebar collapses into a left sheet. */
export function MobileNav({ role, badges }: { role: Role; badges?: NavBadges }) {
  const [open, setOpen] = useState(false);
  const hasBadge = Object.values(badges ?? {}).some((badge) => (badge?.count ?? 0) > 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative md:hidden" aria-label="Open menu">
          <MenuIcon />
          {hasBadge && (
            <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-600 dark:bg-red-500" />
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-4">
        <SheetHeader className="p-0">
          <SheetTitle>AI Sales CRM</SheetTitle>
        </SheetHeader>
        <NavLinks role={role} badges={badges} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
