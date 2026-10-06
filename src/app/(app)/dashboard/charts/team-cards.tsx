import { cn } from "cn";
import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";

import { wholeWinRate, workloadShare, type TeamMemberSummary } from "@/lib/dashboard-charts";
import { initials } from "@/lib/pipeline";

const AVATAR_TONES = [
  "bg-[oklch(0.9_0.05_25)] text-[oklch(0.4_0.1_25)]",
  "bg-[oklch(0.9_0.05_200)] text-[oklch(0.38_0.08_220)]",
  "bg-[oklch(0.91_0.06_150)] text-[oklch(0.36_0.08_155)]",
  "bg-[oklch(0.92_0.06_85)] text-[oklch(0.42_0.08_70)]",
];

/**
 * Manager view: one card per sales rep with open deals, wins (90 days), win
 * rate, a workload meter (open deals relative to the busiest rep) and what
 * needs chasing. "Focus" re-scopes the dashboard to that rep.
 */
export function TeamCards({ team }: { team: TeamMemberSummary[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Sales reps">
      {team.map((member, index) => {
        const share = workloadShare(member.open, team);
        const rate = wholeWinRate(member.won, member.lost);
        return (
          <li
            key={member.userId}
            data-rep={member.userId}
            className="glass-tile anim-rise flex flex-col gap-4 rounded-3xl p-5"
            style={{ "--d": `${index * 80}ms` } as CSSProperties}
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-[inset_0_1px_0_0_oklch(1_0_0/0.6)]",
                  AVATAR_TONES[index % AVATAR_TONES.length],
                )}
              >
                {initials(member.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold tracking-tight">{member.name}</p>
                <p className="text-xs text-muted-foreground">Sales rep</p>
              </div>
            </div>

            <dl className="grid grid-cols-3 divide-x divide-[oklch(0.3_0.01_255/0.08)] rounded-2xl bg-white/50 py-2.5 text-center dark:divide-white/10 dark:bg-white/5">
              <Stat label="Open" value={member.open} />
              <Stat label="Won · 90d" value={member.won} />
              <Stat label="Win rate" value={rate === null ? "—" : `${rate}%`} />
            </dl>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Workload</span>
                <span className="font-medium tabular-nums">{Math.round(share * 100)}%</span>
              </div>
              <div className="hatch h-2 overflow-hidden rounded-full bg-[var(--viz-track)]" aria-hidden>
                <div
                  className="anim-grow-right h-full rounded-full bg-[linear-gradient(90deg,var(--viz-won),oklch(0.62_0.12_155))]"
                  style={{ width: `${share * 100}%`, "--d": `${200 + index * 80}ms` } as CSSProperties}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {member.overdue > 0 ? (
                <span className="rounded-full bg-red-500/12 px-2 py-0.5 font-medium text-red-700 dark:text-red-300">
                  {member.overdue} overdue
                </span>
              ) : (
                <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                  Follow-ups on time
                </span>
              )}
              {member.stale > 0 && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-300">
                  {member.stale} stale
                </span>
              )}
            </div>

            <div className="mt-auto grid grid-cols-2 gap-2">
              <Link
                href={`/prospects?owner=${member.userId}`}
                className="inline-flex h-9 items-center justify-center rounded-full border border-[oklch(0.3_0.01_255/0.18)] text-sm font-medium transition-colors hover:bg-white/70 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none dark:border-white/15 dark:hover:bg-white/10"
              >
                Deals
              </Link>
              <Link
                href={`/dashboard?owner=${member.userId}`}
                className="group inline-flex h-9 items-center justify-center gap-1 rounded-full bg-primary text-sm font-medium text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Focus
                <ArrowUpRightIcon aria-hidden className="size-3.5 transition-transform group-hover:rotate-45" />
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="px-2">
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}
