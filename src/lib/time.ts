/**
 * Org-timezone date/time helpers (SPEC §6).
 *
 * Every date/time computation and display in the app goes through this module:
 * timestamps are stored in UTC (`timestamptz`) and interpreted in the org
 * timezone from org_settings (never hardcoded, never the host/browser zone).
 * "Today" = the current date in the org timezone (SQL counterpart: org_today()).
 *
 * Pure: no I/O; `now` is injectable everywhere for tests.
 *
 * Vocabulary:
 * - DateString: a calendar date "YYYY-MM-DD" (Postgres `date`, e.g.
 *   follow_ups.due_date, org_today()). Compare with < / = / > as strings.
 * - Instant: a `Date` or an ISO timestamp string (Supabase `timestamptz`).
 */
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export type DateString = string;
export type TimeString = string;
export type Instant = Date | string;

export type FollowUpBucket = "overdue" | "today" | "upcoming" | "later";

/** Pending follow-ups due within this many days after today are "upcoming" (SPEC §8, Prompt 10). */
export const UPCOMING_DAYS = 7;

export const DEFAULT_DATE_PATTERN = "MMM d, yyyy";
export const DEFAULT_DATE_TIME_PATTERN = "MMM d, yyyy h:mm a";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const validZones = new Set<string>();

function assertTimeZone(tz: string): void {
  if (validZones.has(tz)) return;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new RangeError(`Invalid time zone: ${tz}`);
  }
  validZones.add(tz);
}

function parseDateString(date: DateString): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`Invalid date (expected YYYY-MM-DD): ${date}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Invalid date: ${date}`);
  }
  return { y, m, d };
}

function parseTimeString(time: TimeString): { h: number; mi: number } {
  const match = TIME_RE.exec(time);
  if (!match) throw new RangeError(`Invalid time (expected HH:mm): ${time}`);
  return { h: Number(match[1]), mi: Number(match[2]) };
}

function toInstant(value: Instant): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid timestamp: ${String(value)}`);
  return date;
}

function inZone(value: Instant, tz: string): TZDate {
  assertTimeZone(tz);
  return new TZDate(toInstant(value).getTime(), tz);
}

/** True for a well-formed, real calendar date "YYYY-MM-DD". */
export function isDateString(value: string): boolean {
  try {
    parseDateString(value);
    return true;
  } catch {
    return false;
  }
}

/** True for a well-formed 24h time "HH:mm". */
export function isTimeString(value: string): boolean {
  return TIME_RE.test(value);
}

/** Today's calendar date in the org timezone (= SQL org_today()). */
export function orgToday(tz: string, now: Instant = new Date()): DateString {
  return format(inZone(now, tz), "yyyy-MM-dd");
}

/** The calendar date of an instant, in the org timezone. */
export function toOrgDate(utc: Instant, tz: string): DateString {
  return format(inZone(utc, tz), "yyyy-MM-dd");
}

/** Formats an instant as org-local wall-clock time (e.g. activity timestamps, demo time). */
export function formatOrgDateTime(
  utc: Instant,
  tz: string,
  pattern: string = DEFAULT_DATE_TIME_PATTERN,
): string {
  return format(inZone(utc, tz), pattern);
}

/** Formats the org-local calendar date of an instant (e.g. "Joined", dashboard dates). */
export function formatOrgDate(utc: Instant, tz: string, pattern: string = DEFAULT_DATE_PATTERN): string {
  return format(inZone(utc, tz), pattern);
}

/** Formats a calendar date (e.g. follow_ups.due_date) without any timezone shift. */
export function formatDateString(date: DateString, pattern: string = DEFAULT_DATE_PATTERN): string {
  const { y, m, d } = parseDateString(date);
  return format(new TZDate(y, m - 1, d, 12, "UTC"), pattern);
}

/**
 * Converts an org-local date + time (demo entry form) to the UTC instant to store.
 *
 * DST: a nonexistent local time (spring-forward gap, e.g. 02:30 on 2026-03-08 in
 * New York) is shifted forward by the gap (→ 03:30 EDT), like browsers do; an
 * ambiguous time (fall-back, e.g. 01:30 on 2026-11-01) resolves to the earlier
 * occurrence (EDT).
 */
export function orgLocalToUtc(dateStr: DateString, timeStr: TimeString, tz: string): Date {
  assertTimeZone(tz);
  const { y, m, d } = parseDateString(dateStr);
  const { h, mi } = parseTimeString(timeStr);
  return new Date(new TZDate(y, m - 1, d, h, mi, tz).getTime());
}

/** Inverse of orgLocalToUtc: org-local date + "HH:mm" for prefilling inputs. */
export function utcToOrgLocal(utc: Instant, tz: string): { date: DateString; time: TimeString } {
  const local = inZone(utc, tz);
  return { date: format(local, "yyyy-MM-dd"), time: format(local, "HH:mm") };
}

/** Calendar arithmetic on a "YYYY-MM-DD" date (no timezone involved). */
export function addDaysToDateString(date: DateString, days: number): DateString {
  const { y, m, d } = parseDateString(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Bucket of a **pending** follow-up by due date, relative to org "today"
 * (completed follow-ups belong to the Completed view; callers filter by status):
 * - overdue:  due before today (SPEC §8)
 * - today:    due today
 * - upcoming: due in the next UPCOMING_DAYS days (today+1 … today+7)
 * - later:    due after that
 */
export function followUpBucket(
  dueDate: DateString,
  tz: string,
  now: Instant = new Date(),
): FollowUpBucket {
  parseDateString(dueDate);
  const today = orgToday(tz, now);
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  if (dueDate <= addDaysToDateString(today, UPCOMING_DAYS)) return "upcoming";
  return "later";
}

/**
 * Short label for the org timezone, e.g. "ET", "CT", "MT", "PT", "AKT", "MST"
 * (Phoenix), "HST" — shown next to demo date/time inputs. Derived with Intl
 * (generic name first, then the specific one, then the IANA id), never hardcoded.
 */
export function timeZoneAbbreviation(tz: string, at: Instant = new Date()): string {
  assertTimeZone(tz);
  const instant = toInstant(at);
  for (const timeZoneName of ["shortGeneric", "short"] as const) {
    try {
      const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName })
        .formatToParts(instant)
        .find((p) => p.type === "timeZoneName")?.value;
      if (part && !/^GMT[+-]/.test(part)) return part;
    } catch {
      // Older engines may not support "shortGeneric"; try the next option.
    }
  }
  return tz;
}
