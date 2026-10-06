import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Tinted icon chips for section headers and KPI tiles. */
export const ICON_TONES = {
  neutral: "bg-white/80 text-[oklch(0.3_0.01_255)] ring-1 ring-[oklch(0.3_0.01_255/0.08)] dark:bg-white/10 dark:text-white dark:ring-white/10",
  sky: "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  amber: "bg-amber-500/14 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
  red: "bg-red-500/12 text-red-600 dark:bg-red-400/15 dark:text-red-300",
  emerald: "bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
  slate: "bg-slate-500/10 text-slate-600 dark:bg-white/10 dark:text-slate-300",
} as const;
export type IconTone = keyof typeof ICON_TONES;

/** Rounded, tinted square holding a section/KPI icon. */
export function IconChip({ tone = "neutral", className, children }: { tone?: IconTone; className?: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_0_oklch(1_0_0/0.5)] [&_svg]:size-[1.05rem]",
        ICON_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Titled page section (dashboard, reports); `id` names the region for assistive tech and tests. */
export function SectionCard({
  id,
  title,
  description,
  action,
  icon,
  tone,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: { href: string; label: string };
  icon?: React.ReactNode;
  tone?: IconTone;
  children: React.ReactNode;
}) {
  return (
    <Card aria-labelledby={`${id}-title`} role="region" data-section={id} className="min-w-0 gap-5">
      <CardHeader className={cn(icon && "grid-cols-[auto_1fr] gap-x-3 has-data-[slot=card-action]:grid-cols-[auto_1fr_auto]")}>
        {icon && (
          <IconChip tone={tone} className="row-span-2 self-center">
            {icon}
          </IconChip>
        )}
        <CardTitle id={`${id}-title`} className="text-base">
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription className="text-xs text-pretty">{description}</CardDescription>}
        {action && (
          <CardAction className={cn(icon && "col-start-3", "self-center")}>
            <Link
              href={action.href}
              className="group/link inline-flex h-8 items-center gap-1 rounded-full border border-white/80 bg-white/55 px-3 text-xs font-medium text-foreground/80 shadow-[inset_0_1px_0_0_oklch(1_0_0/0.9)] transition-colors hover:bg-white/90 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none dark:border-white/10 dark:bg-white/5 dark:shadow-none dark:hover:bg-white/10"
            >
              {action.label}
              <ArrowRightIcon aria-hidden className="size-3.5 transition-transform group-hover/link:translate-x-0.5" />
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

/** Muted empty state inside a section. */
export function SectionEmpty({ icon, title, body }: { icon: React.ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[oklch(0.3_0.01_255/0.15)] bg-white/25 px-4 py-10 text-center dark:border-white/10 dark:bg-white/5">
      <div className="flex size-10 items-center justify-center rounded-full bg-white/70 text-muted-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0)] dark:bg-white/10 [&_svg]:size-4">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="max-w-xs text-xs text-muted-foreground">{body}</p>}
    </div>
  );
}
