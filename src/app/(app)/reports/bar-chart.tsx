"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  /** Extra tooltip / table line, e.g. "85.7% of previous step". */
  detail?: string;
};

const ROW_HEIGHT = 34;
const AXIS_HEIGHT = 28;

/**
 * Single-series horizontal bar chart (Recharts). One hue (`--viz-series-1`,
 * light/dark steps in globals.css), no legend (the figure caption names the
 * series), value at each bar tip, ≤ 24 px bars with a 4 px rounded data-end,
 * hairline vertical grid, axis text in text tokens, hover tooltip. The SVG is
 * hidden from assistive tech; a visually hidden table carries the same data.
 */
export function HorizontalBarChart({
  data,
  caption,
  valueHeader,
  labelWidth = 124,
}: {
  data: BarDatum[];
  /** Accessible name of the figure + table caption. */
  caption: string;
  /** Column header of the values in the hidden table. */
  valueHeader: string;
  labelWidth?: number;
}) {
  const height = data.length * ROW_HEIGHT + AXIS_HEIGHT;
  const max = Math.max(1, ...data.map((datum) => datum.value));

  return (
    <figure aria-label={caption} className="min-w-0">
      <div aria-hidden="true" style={{ height }} className="w-full min-w-0 text-xs">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} accessibilityLayer={false}>
            <CartesianGrid horizontal={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              type="number"
              domain={[0, max]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              height={AXIS_HEIGHT}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={labelWidth}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--foreground)", fontSize: 12 }}
              interval={0}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              isAnimationActive={false}
              content={<ChartTooltip />}
            />
            <Bar dataKey="value" fill="var(--viz-series-1)" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
              <LabelList dataKey="value" position="right" offset={6} fill="var(--foreground)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key}>
              <th scope="row">{datum.label}</th>
              <td>
                {datum.value.toLocaleString("en-US")}
                {datum.detail ? ` (${datum.detail})` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

type TooltipPayload = { payload?: BarDatum };

function ChartTooltip({ active, payload }: { active?: boolean; payload?: readonly TooltipPayload[] }) {
  const datum = active ? payload?.[0]?.payload : undefined;
  if (!datum) return null;
  return (
    <div className="glass-strong rounded-xl px-3 py-2 text-xs text-popover-foreground">
      <p className="font-medium">{datum.label}</p>
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <span aria-hidden className="inline-block size-2 rounded-full bg-[var(--viz-series-1)]" />
        <span className="tabular-nums text-foreground">{datum.value.toLocaleString("en-US")}</span>
        {datum.detail && <span>· {datum.detail}</span>}
      </p>
    </div>
  );
}
