import { cn } from "cn";
import Link from "next/link";

import { FOLLOW_UP_PAGE_TABS, FOLLOW_UP_TAB_LABELS, type FollowUpPageTab } from "@/lib/follow-ups";
import { followUpsHref, type FollowUpsParams } from "@/lib/validation/follow-ups-page";

/** URL-driven tab bar with counts (server-rendered links; the active one has aria-current). */
export function FollowUpTabs({ params, counts }: { params: FollowUpsParams; counts: Record<FollowUpPageTab, number> }) {
  return (
    <nav aria-label="Follow-up views" className="mb-4 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1">
        {FOLLOW_UP_PAGE_TABS.map((tab) => {
          const active = params.tab === tab;
          const count = counts[tab];
          const urgent = (tab === "overdue" || tab === "attention") && count > 0;
          return (
            <li key={tab}>
              <Link
                href={followUpsHref(params, { tab })}
                scroll={false}
                aria-current={active ? "page" : undefined}
                data-tab={tab}
                className={cn(
                  "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {FOLLOW_UP_TAB_LABELS[tab]}
                <span
                  data-count={count}
                  className={cn(
                    "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-5 tabular-nums",
                    urgent
                      ? tab === "overdue"
                        ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                        : "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
