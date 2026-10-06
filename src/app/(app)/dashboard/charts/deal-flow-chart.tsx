"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { WeeklyFlowPoint } from "@/lib/dashboard-charts";
import { formatDateString } from "@/lib/time";

const HEIGHT = 230;

const SERIES = [
  { key: "created", label: "New prospects", color: "var(--viz-created)" },
  { key: "won", label: "Deals won", color: "var(--viz-won)" },
] as const;

/**
 * Two lines on one axis (both are deal counts): prospects created vs deals won
 * per rolling week ending today. 2px monotone lines over a ~10% wash, end dots,
 * hairline horizontal grid, crosshair + tooltip, legend with totals above.
 * The SVG is hidden from assistive tech; a hidden table carries the data.
 */
export function DealFlowChart({ data }: { data: WeeklyFlowPoint[] }) {
  const rows = data.map((point) => ({
    ...point,
    label: formatDateString(point.weekEnd, "MMM d"),
    range: `${formatDateString(point.weekStart, "MMM d")} – ${formatDateString(point.weekEnd, "MMM d")}`,
  }));
  const totals = {
    created: data.reduce((sum, point) => sum + point.created, 0),
    won: data.reduce((sum, point) => sum + point.won, 0),
  };
  // Clean ticks: 4 even steps up to the next multiple of 4 (0 / 2 / 4 / 6 / 8 …).
  const peak = Math.max(4, ...data.flatMap((point) => [point.created, point.won]));
  const max = Math.ceil(peak / 4) * 4;
  const ticks = [0, max / 4, max / 2, (max * 3) / 4, max];

  return (
    <figure className="min-w-0" aria-label="New prospects and deals won per week, last 8 weeks">
      <ul className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: series.color }} />
            {series.label}
            <span className="font-semibold text-foreground tabular-nums">{totals[series.key]}</span>
          </li>
        ))}
      </ul>
      <div aria-hidden style={{ height: HEIGHT }} className="w-full min-w-0 text-xs">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: HEIGHT }}>
          <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} accessibilityLayer={false}>
            <defs>
              {SERIES.map((series) => (
                <linearGradient key={series.key} id={`flow-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={series.color} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={series.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              domain={[0, max]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              ticks={ticks}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeOpacity: 0.4 }}
              content={<FlowTooltip />}
            />
            {SERIES.map((series) => (
              <Area
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#flow-${series.key})`}
                dot={false}
                activeDot={{ r: 5, fill: series.color, stroke: "var(--canvas)", strokeWidth: 2 }}
                animationDuration={1300}
                animationEasing="ease-out"
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>New prospects and deals won per week</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">New prospects</th>
            <th scope="col">Deals won</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.weekStart}>
              <th scope="row">{row.range}</th>
              <td>{row.created}</td>
              <td>{row.won}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

type TooltipPayload = { dataKey?: string | number; value?: number | string; color?: string; payload?: { range?: string } };

function FlowTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const range = payload[0]?.payload?.range;
  return (
    <div className="glass-strong min-w-40 rounded-xl px-3 py-2.5 text-xs text-popover-foreground">
      <p className="mb-1.5 font-medium">{range}</p>
      {SERIES.map((series) => {
        const item = payload.find((entry) => entry.dataKey === series.key);
        return (
          <p key={series.key} className="flex items-center justify-between gap-4 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: series.color }} />
              {series.label}
            </span>
            <span className="font-semibold text-foreground tabular-nums">{item?.value ?? 0}</span>
          </p>
        );
      })}
    </div>
  );
}
