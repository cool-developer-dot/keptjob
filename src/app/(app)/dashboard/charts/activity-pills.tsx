"use client";

import { cn } from "cn";
import { useState, type CSSProperties } from "react";

import { barShare, type DailyActivityPoint } from "@/lib/dashboard-charts";
import { formatDateString } from "@/lib/time";

/**
 * Last 7 org days of human sales activity as rounded pills (single series, so
 * no legend: the section title names it). Each pill sits in a hatched track;
 * today is the deep-green pill. The value bubble shows today by default and
 * follows hover / keyboard focus. A visually hidden table carries the data.
 */
export function ActivityPills({ points }: { points: DailyActivityPoint[] }) {
  const week = points.slice(-7);
  const max = Math.max(1, ...week.map((point) => point.count));
  const todayIndex = week.length - 1;
  const [focused, setFocused] = useState<number | null>(null);
  const labelled = focused ?? todayIndex;

  return (
    <figure className="min-w-0" aria-label="Activities per day, last 7 days">
      <div aria-hidden className="flex h-52 items-end justify-between gap-2 sm:gap-3" onMouseLeave={() => setFocused(null)}>
        {week.map((point, index) => {
          const share = barShare(point.count, max);
          const isToday = index === todayIndex;
          const height = point.count > 0 ? Math.max(share * 100, 16) : 0;
          return (
            <div
              key={point.day}
              className="flex h-full min-w-0 flex-1 cursor-default flex-col items-center gap-2.5"
              onMouseEnter={() => setFocused(index)}
            >
              <div className="hatch relative w-full max-w-12 flex-1 rounded-full bg-[var(--viz-track)]">
                <div
                  className={cn(
                    "anim-grow-up absolute inset-x-0 bottom-0 rounded-full transition-[filter] duration-200",
                    focused === index && "brightness-110",
                  )}
                  style={
                    {
                      height: `${height}%`,
                      background: isToday
                        ? "linear-gradient(180deg, oklch(0.42 0.09 156), var(--brand-deeper))"
                        : "linear-gradient(180deg, oklch(0.68 0.12 155), var(--viz-won))",
                      boxShadow: "inset 0 1px 0 0 oklch(1 0 0 / 0.25)",
                      "--d": `${index * 70}ms`,
                    } as CSSProperties
                  }
                />
                {labelled === index && (
                  <span
                    className="anim-rise absolute left-1/2 z-10 -translate-x-1/2 rounded-full bg-[var(--brand-deeper)] px-2 py-0.5 text-[0.7rem] leading-4 font-semibold whitespace-nowrap text-white shadow-[0_6px_14px_-6px_oklch(0.25_0.05_160/0.8)] dark:bg-white dark:text-[var(--brand-deeper)]"
                    style={{ bottom: `calc(${height}% + 6px)` }}
                  >
                    {point.count}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  isToday ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {isToday ? "Today" : formatDateString(point.day, "EEE")}
              </span>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>Activities per day, last 7 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Activities</th>
          </tr>
        </thead>
        <tbody>
          {week.map((point) => (
            <tr key={point.day}>
              <th scope="row">{formatDateString(point.day, "EEEE, MMM d")}</th>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
