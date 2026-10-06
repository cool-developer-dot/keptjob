"use client";

import { MenuIcon } from "lucide-react";
import { useState } from "react";

import { BrandLockup } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Role } from "@/lib/constants";

import { NavLinks, type NavBadges } from "./nav-links";

/** Below `md`: the sidebar collapses into a left sheet; `footer` holds the user card. */
export function MobileNav({ role, badges, footer }: { role: Role; badges?: NavBadges; footer?: React.ReactNode }) {
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
      <SheetContent side="left" className="w-72 gap-7 rounded-r-3xl p-4">
        <SheetHeader className="p-0 pt-1">
          <SheetTitle asChild>
            <div>
              <BrandLockup subtitle="Sales workspace" />
            </div>
          </SheetTitle>
        </SheetHeader>
        <NavLinks role={role} badges={badges} onNavigate={() => setOpen(false)} />
        {footer && <div className="mt-auto">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}
