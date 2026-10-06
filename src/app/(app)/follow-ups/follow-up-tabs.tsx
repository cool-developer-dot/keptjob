import { cn } from "cn";
import Link from "next/link";

import { FOLLOW_UP_PAGE_TABS, FOLLOW_UP_TAB_LABELS, type FollowUpPageTab } from "@/lib/follow-ups";
import { followUpsHref, type FollowUpsParams } from "@/lib/validation/follow-ups-page";

/** URL-driven tab bar with counts (server-rendered links; the active one has aria-current). */
export function FollowUpTabs({ params, counts }: { params: FollowUpsParams; counts: Record<FollowUpPageTab, number> }) {
  return (
    <nav aria-label="Follow-up views" className="mb-5 overflow-x-auto pb-1">
      <ul className="glass-tile flex w-max min-w-max gap-1 rounded-2xl bg-white/45 p-1 dark:bg-white/5">
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
                  "inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-medium whitespace-nowrap transition-all duration-200 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active
                    ? "bg-white text-foreground shadow-[0_1px_3px_oklch(0.25_0.01_255/0.12),inset_0_1px_0_0_oklch(1_0_0)] dark:bg-white/15 dark:shadow-none"
                    : "text-muted-foreground hover:bg-white/50 hover:text-foreground dark:hover:bg-white/10",
                )}
              >
                {FOLLOW_UP_TAB_LABELS[tab]}
                <span
                  data-count={count}
                  className={cn(
                    "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-5 tabular-nums",
                    urgent
                      ? tab === "overdue"
                        ? "bg-red-500/12 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                        : "bg-amber-500/15 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                      : "bg-[oklch(0.3_0.01_255/0.07)] text-muted-foreground dark:bg-white/10",
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
