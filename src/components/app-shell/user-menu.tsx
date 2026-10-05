import { LogOutIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CurrentUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/constants";
import { signOut } from "@/server/actions/auth";

/** Header right side: name, role badge, logout. */
export function UserMenu({ user }: { user: CurrentUser }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="max-w-40 truncate text-sm font-medium" data-testid="current-user-name">
          {user.full_name || user.email}
        </span>
        <Badge variant={user.role === "manager" ? "default" : "secondary"} data-testid="current-user-role">
          {ROLE_LABELS[user.role]}
        </Badge>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="outline" size="sm">
          <LogOutIcon aria-hidden />
          <span className="sr-only sm:not-sr-only">Log out</span>
        </Button>
      </form>
    </div>
  );
}
