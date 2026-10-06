import { CalendarClockIcon, SparklesIcon, TrendingUpIcon } from "lucide-react";

import { BrandLockup } from "@/components/brand/brand-mark";

/** Auth pages: product showcase on the left (large screens), glass form card on the right. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10 md:px-8">
      <div className="grid w-full max-w-6xl items-center gap-14 lg:grid-cols-[1.15fr_1fr]">
        <AuthShowcase />
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <BrandLockup subtitle="Sales workspace" />
          </div>
          {children}
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Internal tool · accounts are created by invitation only
          </p>
        </div>
      </div>
    </main>
  );
}

/** Decorative preview of the app (hidden from assistive tech; the form is the page's content). */
function AuthShowcase() {
  return (
    <section aria-hidden className="relative hidden select-none lg:block">
      <BrandLockup subtitle="Sales workspace" />
      <p className="mt-10 max-w-lg text-[2.6rem] leading-[1.08] font-semibold tracking-tight text-balance">
        Know who to call,{" "}
        <span className="text-muted-foreground">
          and what to say next.
        </span>
      </p>
      <p className="mt-4 max-w-md text-base text-pretty text-muted-foreground">
        Follow-ups, objections, the last conversation and an AI-recommended next step for every deal, in one calm place.
      </p>

      <div className="relative mt-12 h-[20rem] max-w-lg">
        <div className="glass absolute top-0 left-0 w-[19rem] rotate-[-2deg] rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarClockIcon className="size-3.5" /> Contact today
            </span>
            <span className="rounded-full bg-red-500/12 px-2 py-0.5 text-[0.7rem] text-red-700">2 days overdue</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,oklch(0.95_0.012_80),oklch(0.87_0.012_250))] text-xs font-semibold text-[oklch(0.28_0.01_255)] shadow-[inset_0_1px_0_0_oklch(1_0_0/0.7)]">
              JL
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold">Jordan Lee</span>
              <span className="text-xs text-muted-foreground">Northwind Traders · Qualified</span>
            </span>
          </div>
          <p className="mt-3 text-sm">Send revised pricing for 25 seats</p>
        </div>

        <div className="glass absolute top-40 left-36 w-[20rem] rotate-[1.5deg] rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="flex items-center gap-1.5 text-foreground">
              <SparklesIcon className="size-3.5" /> AI next step
            </span>
            <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[0.7rem] text-emerald-700">High health</span>
          </div>
          <p className="mt-2.5 text-sm leading-relaxed">
            Confirm the decision maker joins Thursday&apos;s call and share the security one-pager before it.
          </p>
        </div>

        <div className="glass absolute top-2 left-[21rem] w-44 rotate-[3deg] rounded-2xl p-4">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <TrendingUpIcon className="size-3.5" /> Win rate
          </span>
          <span className="mt-1 block text-3xl font-semibold tracking-tight tabular-nums">55%</span>
          <span className="mt-3 flex h-10 items-end gap-1">
            {[38, 52, 44, 63, 58, 72, 80].map((height, index) => (
              <span
                key={index}
                className="flex-1 rounded-t-sm bg-[linear-gradient(180deg,oklch(0.4_0.008_255),oklch(0.62_0.008_255))] dark:bg-[linear-gradient(180deg,oklch(0.95_0_0),oklch(0.7_0.004_255))]"
                style={{ height: `${height}%`, opacity: 0.45 + index * 0.08 }}
              />
            ))}
          </span>
        </div>
      </div>
    </section>
  );
}
