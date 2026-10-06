import { ArrowRightIcon, CalendarCheckIcon, KanbanIcon } from "lucide-react";
import Link from "next/link";

import { CountUp } from "./count-up";

/**
 * Deep-green "Today's focus" card: how many follow-ups need a call today
 * (due today + overdue, org timezone) with the way in. Mirrors SPEC §1.1 —
 * "who to contact".
 */
export function FocusCard({
  dueToday,
  overdue,
  stale,
  followUpsHref,
  pipelineHref,
}: {
  dueToday: number;
  overdue: number;
  stale: number;
  followUpsHref: string;
  pipelineHref: string;
}) {
  const total = dueToday + overdue;
  return (
    <section
      aria-labelledby="focus-title"
      className="brand-surface relative flex h-full min-h-72 flex-col justify-between overflow-hidden rounded-3xl p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="focus-title" className="text-base font-semibold tracking-tight">
            Today&apos;s focus
          </h2>
          <p className="mt-0.5 text-xs text-white/65">Follow-ups to clear before the day ends</p>
        </div>
        <span className="flex size-9 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
          <CalendarCheckIcon aria-hidden className="size-4" />
        </span>
      </div>

      <div>
        <p className="flex items-end gap-3">
          <span className="text-6xl leading-none font-semibold tracking-tight">
            <span className="sr-only">{total}</span>
            <CountUp value={total} />
          </span>
          <span className="pb-1.5 text-sm text-white/70">{total === 1 ? "follow-up" : "follow-ups"}</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Pill tone={overdue > 0 ? "alert" : "calm"}>{overdue} overdue</Pill>
          <Pill tone="calm">{dueToday} due today</Pill>
          {stale > 0 && <Pill tone="calm">{stale} stale deals</Pill>}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href={followUpsHref}
          className="group inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-[var(--brand-deeper)] shadow-[0_8px_20px_-10px_oklch(0_0_0/0.5)] transition-transform hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-white/50 focus-visible:outline-none"
        >
          {total > 0 ? "Start follow-ups" : "Open follow-ups"}
          <ArrowRightIcon aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link
          href={pipelineHref}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium text-white ring-1 ring-white/25 transition-colors hover:bg-white/20 focus-visible:ring-3 focus-visible:ring-white/50 focus-visible:outline-none"
        >
          <KanbanIcon aria-hidden className="size-4" />
          Pipeline
        </Link>
      </div>
    </section>
  );
}

function Pill({ tone, children }: { tone: "alert" | "calm"; children: React.ReactNode }) {
  return (
    <span
      className={
        tone === "alert"
          ? "rounded-full bg-[oklch(0.7_0.17_35)] px-2.5 py-1 font-medium text-white"
          : "rounded-full bg-white/12 px-2.5 py-1 text-white/85 ring-1 ring-white/15"
      }
    >
      {children}
    </span>
  );
}
