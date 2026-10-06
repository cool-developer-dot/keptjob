import type { CSSProperties } from "react";

import { outcomeSegments, wholeWinRate } from "@/lib/dashboard-charts";

const R = 80;
const STROKE = 22;
const ARC = Math.PI * R;
/** Room for the round caps plus a 2px surface gap between segments. */
const CAP = STROKE + 2;
const PATH = `M ${100 - R} 100 A ${R} ${R} 0 0 1 ${100 + R} 100`;

/**
 * Semicircle gauge of the deals closed in the last 90 days: the green share is
 * the win rate printed in the middle, the terracotta share the losses
 * (validated `--viz-won` / `--viz-lost` pair). Nothing closed → the hatched
 * empty track. Legend with counts below (identity never rests on color alone);
 * open deals are listed there as context, not drawn on the arc.
 */
export function OutcomeGauge({ won, lost, open }: { won: number; lost: number; open: number }) {
  const shares = outcomeSegments(won, lost);
  const rate = wholeWinRate(won, lost);
  const parts = [
    { key: "won", share: shares.won, stroke: "var(--viz-won)" },
    { key: "lost", share: shares.lost, stroke: "var(--viz-lost)" },
  ].filter((part) => part.share > 0);

  let offset = 0;
  const segments = parts.map((part, index) => {
    const span = part.share * ARC;
    const visible = Math.max(0.01, span - (parts.length > 1 ? CAP : STROKE));
    const start = offset + (parts.length > 1 ? CAP / 2 : STROKE / 2);
    offset += span;
    return { ...part, dash: `${visible} ${ARC * 2}`, dashOffset: -start, delay: index * 180 };
  });

  return (
    <figure
      className="flex min-w-0 flex-col items-center"
      aria-label={`Win rate ${rate === null ? "not available" : `${rate}%`}: ${won} won, ${lost} lost in the last 90 days, ${open} open`}
    >
      <div className="relative w-full max-w-[17rem]">
        <svg viewBox="0 0 200 112" className="w-full overflow-visible" aria-hidden>
          <defs>
            <pattern id="gauge-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="var(--viz-track)" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="var(--viz-hatch)" strokeWidth="2.5" />
            </pattern>
          </defs>
          <path d={PATH} fill="none" stroke="url(#gauge-hatch)" strokeWidth={STROKE} strokeLinecap="round" />
          {segments.map((segment) => (
            <path
              key={segment.key}
              d={PATH}
              fill="none"
              stroke={segment.stroke}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={segment.dash}
              strokeDashoffset={segment.dashOffset}
              className="anim-gauge"
              style={{ "--d": `${segment.delay}ms` } as CSSProperties}
            />
          ))}
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className="text-[2.6rem] leading-none font-semibold tracking-tight">{rate === null ? "—" : `${rate}%`}</span>
          <span className="mt-1 text-xs text-muted-foreground">Win rate · 90 days</span>
        </div>
      </div>
      <ul className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <LegendItem swatch={<span className="size-2.5 rounded-full bg-[var(--viz-won)]" />} label="Won" value={won} />
        <LegendItem swatch={<span className="size-2.5 rounded-full bg-[var(--viz-lost)]" />} label="Lost" value={lost} />
        <LegendItem
          swatch={<span className="hatch size-2.5 rounded-full bg-[var(--viz-track)] ring-1 ring-[var(--viz-hatch)]" />}
          label="Still open"
          value={open}
        />
      </ul>
    </figure>
  );
}

function LegendItem({ swatch, label, value }: { swatch: React.ReactNode; label: string; value: number }) {
  return (
    <li className="flex items-center gap-1.5">
      {swatch}
      <span>{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </li>
  );
}
