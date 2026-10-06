import type { CSSProperties } from "react";

import { STAGE_LABELS } from "@/lib/constants";
import { barShare, type StageCount } from "@/lib/dashboard-charts";

/**
 * Open deals per stage (SPEC order) as horizontal pills in hatched tracks —
 * one series, so no legend; the count sits at the end of each row.
 */
export function StageBars({ stages }: { stages: StageCount[] }) {
  const max = Math.max(1, ...stages.map((row) => row.count));
  return (
    <figure aria-label="Open deals by stage" className="min-w-0">
      <ul className="space-y-3">
        {stages.map((row, index) => {
          const share = barShare(row.count, max);
          return (
            <li key={row.stage} className="grid grid-cols-[6.5rem_minmax(0,1fr)_1.75rem] items-center gap-3 text-sm">
              <span className="truncate text-muted-foreground">{STAGE_LABELS[row.stage]}</span>
              <span className="hatch relative h-3 overflow-hidden rounded-full bg-[var(--viz-track)]" aria-hidden>
                {row.count > 0 && (
                  <span
                    className="anim-grow-right absolute inset-y-0 left-0 rounded-full"
                    style={
                      {
                        width: `${Math.max(share * 100, 8)}%`,
                        background: `linear-gradient(90deg, var(--viz-won), oklch(0.62 0.12 155))`,
                        "--d": `${index * 60}ms`,
                      } as CSSProperties
                    }
                  />
                )}
              </span>
              <span className="text-right font-semibold tabular-nums">{row.count}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
