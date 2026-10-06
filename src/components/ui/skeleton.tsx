import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-lg bg-[oklch(0.3_0.01_255/0.07)] dark:bg-white/10", className)}
      {...props}
    />
  )
}

export { Skeleton }
