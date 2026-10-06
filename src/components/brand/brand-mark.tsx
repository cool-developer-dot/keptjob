import { cn } from "cn";
import { ChartNoAxesColumnIncreasingIcon } from "lucide-react";

/** App logo: a glossy graphite tile with a rising-bars glyph. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(150deg,oklch(0.42_0.008_255),oklch(0.2_0.008_255))] text-white shadow-[inset_0_1px_0_0_oklch(1_0_0/0.3),0_8px_20px_-10px_oklch(0.2_0.01_255/0.7)] dark:bg-[linear-gradient(150deg,oklch(1_0_0),oklch(0.86_0.004_255))] dark:text-[oklch(0.2_0.008_255)]",
        className,
      )}
    >
      <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" />
      <ChartNoAxesColumnIncreasingIcon className="relative size-[52%]" strokeWidth={2.6} />
    </span>
  );
}

/** Logo + product name, used in the sidebar, the mobile header and the auth pages. */
export function BrandLockup({ subtitle, className }: { subtitle?: string; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandMark />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[0.95rem] font-semibold tracking-tight">AI Sales CRM</span>
        {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
    </span>
  );
}
