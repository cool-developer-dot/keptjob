import { CalendarCheckIcon } from "lucide-react";

import type { FollowUpPageTab } from "@/lib/follow-ups";

const EMPTY: Record<FollowUpPageTab, { title: string; body: string }> = {
  overdue: { title: "No overdue follow-ups", body: "You're all caught up." },
  today: { title: "Nothing due today", body: "Follow-ups due today in the org timezone show up here." },
  upcoming: { title: "No follow-ups in the next 7 days", body: "Schedule follow-ups from a prospect's page." },
  completed: { title: "No follow-ups completed in the last 30 days", body: "Completed follow-ups show up here." },
  attention: {
    title: "No deals need attention",
    body: "Every open deal has recent activity and a follow-up scheduled.",
  },
};

export function FollowUpsEmptyState({ tab }: { tab: FollowUpPageTab }) {
  const { title, body } = EMPTY[tab];
  return (
    <div className="glass flex flex-col items-center justify-center gap-2 rounded-3xl px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-white/80 text-muted-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0)] ring-1 ring-[oklch(0.3_0.01_255/0.08)] dark:bg-white/10 dark:ring-white/10">
        <CalendarCheckIcon aria-hidden className="size-5" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
