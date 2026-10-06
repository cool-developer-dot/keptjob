import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CurrentUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/constants";
import { initials } from "@/lib/pipeline";
import { cn } from "@/lib/utils";
import { signOut } from "@/server/actions/auth";

/** Signed-in user card (avatar, name, role) with logout; sits at the bottom of the sidebar / mobile menu. */
export function UserMenu({ user }: { user: CurrentUser }) {
  const name = user.full_name || user.email;
  const isManager = user.role === "manager";
  return (
    <div className="glass-tile flex min-w-0 items-center gap-3 rounded-2xl p-2.5">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold bg-[linear-gradient(135deg,oklch(0.95_0.012_80),oklch(0.87_0.012_250))] text-[oklch(0.28_0.01_255)] shadow-[inset_0_1px_0_0_oklch(1_0_0/0.7),0_1px_2px_oklch(0.25_0.01_255/0.1)] dark:bg-[linear-gradient(135deg,oklch(0.4_0.006_255),oklch(0.3_0.006_255))] dark:text-white"
      >
        {initials(name)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium" data-testid="current-user-name">
          {name}
        </span>
        <span
          data-testid="current-user-role"
          className={cn(
            "w-fit rounded-full px-1.5 text-[0.7rem] leading-4 font-medium",
            isManager
              ? "bg-[oklch(0.23_0.008_255)] text-white dark:bg-white dark:text-[oklch(0.2_0.008_255)]"
              : "bg-[oklch(0.3_0.01_255/0.07)] text-muted-foreground dark:bg-white/10",
          )}
        >
          {ROLE_LABELS[user.role]}
        </span>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Log out" title="Log out">
          <LogOutIcon aria-hidden />
        </Button>
      </form>
    </div>
  );
}
