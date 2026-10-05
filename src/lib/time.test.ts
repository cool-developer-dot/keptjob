import { describe, expect, it } from "vitest";

import { ALLOWED_TIMEZONES } from "@/lib/constants";

import {
  COMPLETED_WINDOW_DAYS,
  UPCOMING_DAYS,
  addDaysToDateString,
  daysBetweenDateStrings,
  followUpBucket,
  followUpViewBucket,
  formatDateString,
  formatOrgDate,
  formatOrgDateTime,
  formatRelativeTime,
  isDateString,
  isTimeString,
  orgLocalToUtc,
  orgToday,
  timeZoneAbbreviation,
  toOrgDate,
  utcToOrgLocal,
} from "./time";

const NY = "America/New_York";
const HONOLULU = "Pacific/Honolulu";
const PHOENIX = "America/Phoenix";
const DENVER = "America/Denver";

const iso = (d: Date) => d.toISOString();

describe("orgToday / toOrgDate", () => {
  it("11pm New York is still today in New York although UTC is the next day", () => {
    const now = new Date("2026-10-07T03:00:00Z"); // 23:00 EDT on Oct 6
    expect(now.getUTCDate()).toBe(7);
    expect(orgToday(NY, now)).toBe("2026-10-06");
    expect(toOrgDate(now, NY)).toBe("2026-10-06");
    expect(toOrgDate("2026-10-07T03:00:00+00:00", NY)).toBe("2026-10-06");
  });

  it("handles exactly UTC midnight", () => {
    const midnight = new Date("2026-10-07T00:00:00Z");
    expect(orgToday(NY, midnight)).toBe("2026-10-06"); // 20:00 EDT
    expect(orgToday(HONOLULU, midnight)).toBe("2026-10-06"); // 14:00 HST
    expect(orgToday("UTC", midnight)).toBe("2026-10-07");
  });

  it("rolls over at local midnight, not UTC midnight", () => {
    expect(orgToday(NY, new Date("2026-10-07T03:59:59Z"))).toBe("2026-10-06");
    expect(orgToday(NY, new Date("2026-10-07T04:00:00Z"))).toBe("2026-10-07");
    expect(orgToday(HONOLULU, new Date("2026-10-07T09:59:59Z"))).toBe("2026-10-06");
    expect(orgToday(HONOLULU, new Date("2026-10-07T10:00:00Z"))).toBe("2026-10-07");
  });

  it("uses the right offset on both sides of DST changes", () => {
    // Spring forward 2026-03-08: midnight local is 05:00Z (EST); next day 04:00Z (EDT).
    expect(orgToday(NY, new Date("2026-03-08T04:59:00Z"))).toBe("2026-03-07");
    expect(orgToday(NY, new Date("2026-03-08T05:00:00Z"))).toBe("2026-03-08");
    expect(orgToday(NY, new Date("2026-03-09T03:59:00Z"))).toBe("2026-03-08");
    expect(orgToday(NY, new Date("2026-03-09T04:00:00Z"))).toBe("2026-03-09");
    // Fall back 2026-11-01: midnight is 04:00Z (EDT); next midnight 05:00Z (EST).
    expect(orgToday(NY, new Date("2026-11-01T03:59:00Z"))).toBe("2026-10-31");
    expect(orgToday(NY, new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
    expect(orgToday(NY, new Date("2026-11-02T04:59:00Z"))).toBe("2026-11-01");
    expect(orgToday(NY, new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
  });

  it("defaults now to the current time", () => {
    expect(orgToday(NY)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("orgLocalToUtc", () => {
  it("converts New York wall-clock time to UTC (EDT and EST)", () => {
    expect(iso(orgLocalToUtc("2026-10-06", "23:00", NY))).toBe("2026-10-07T03:00:00.000Z");
    expect(iso(orgLocalToUtc("2026-12-15", "09:30", NY))).toBe("2026-12-15T14:30:00.000Z");
  });

  it("spring forward (2026-03-08 New York): before, after and the nonexistent 02:30", () => {
    expect(iso(orgLocalToUtc("2026-03-08", "01:59", NY))).toBe("2026-03-08T06:59:00.000Z");
    expect(iso(orgLocalToUtc("2026-03-08", "03:00", NY))).toBe("2026-03-08T07:00:00.000Z");
    // 02:30 does not exist: shifted forward by the gap → 03:30 EDT.
    const gap = orgLocalToUtc("2026-03-08", "02:30", NY);
    expect(iso(gap)).toBe("2026-03-08T07:30:00.000Z");
    expect(utcToOrgLocal(gap, NY)).toEqual({ date: "2026-03-08", time: "03:30" });
  });

  it("fall back (2026-11-01 New York): ambiguous 01:30 resolves to the earlier (EDT) instant", () => {
    expect(iso(orgLocalToUtc("2026-11-01", "00:30", NY))).toBe("2026-11-01T04:30:00.000Z");
    expect(iso(orgLocalToUtc("2026-11-01", "01:30", NY))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(orgLocalToUtc("2026-11-01", "02:00", NY))).toBe("2026-11-01T07:00:00.000Z");
  });

  it("Honolulu and Phoenix have no DST; Denver does", () => {
    for (const date of ["2026-01-15", "2026-03-08", "2026-07-15", "2026-11-01"]) {
      expect(iso(orgLocalToUtc(date, "09:00", HONOLULU))).toBe(`${date}T19:00:00.000Z`);
      expect(iso(orgLocalToUtc(date, "09:00", PHOENIX))).toBe(`${date}T16:00:00.000Z`);
    }
    expect(iso(orgLocalToUtc("2026-01-15", "09:00", DENVER))).toBe("2026-01-15T16:00:00.000Z");
    expect(iso(orgLocalToUtc("2026-07-15", "09:00", DENVER))).toBe("2026-07-15T15:00:00.000Z");
  });

  it("round-trips with utcToOrgLocal in every allowed timezone", () => {
    for (const tz of ALLOWED_TIMEZONES) {
      for (const [date, time] of [
        ["2026-01-31", "00:00"],
        ["2026-06-30", "23:59"],
        ["2026-11-01", "12:15"],
      ] as const) {
        expect(utcToOrgLocal(orgLocalToUtc(date, time, tz), tz)).toEqual({ date, time });
      }
    }
  });

  it("rejects invalid input", () => {
    expect(() => orgLocalToUtc("2026-13-01", "09:00", NY)).toThrow(RangeError);
    expect(() => orgLocalToUtc("2026-02-30", "09:00", NY)).toThrow(RangeError);
    expect(() => orgLocalToUtc("2026-10-06", "25:00", NY)).toThrow(RangeError);
    expect(() => orgLocalToUtc("2026-10-06", "9:00", NY)).toThrow(RangeError);
    expect(() => orgLocalToUtc("2026-10-06", "09:00", "Mars/Olympus")).toThrow(RangeError);
    expect(() => toOrgDate("not a date", NY)).toThrow(RangeError);
  });
});

describe("formatting", () => {
  it("formats instants as org wall-clock time", () => {
    expect(formatOrgDateTime("2026-10-07T03:00:00Z", NY)).toBe("Oct 6, 2026 11:00 PM");
    expect(formatOrgDateTime("2026-10-07T03:00:00Z", HONOLULU)).toBe("Oct 6, 2026 5:00 PM");
    expect(formatOrgDateTime("2026-10-07T03:00:00Z", NY, "yyyy-MM-dd HH:mm")).toBe("2026-10-06 23:00");
    expect(formatOrgDate("2026-10-07T03:00:00Z", NY)).toBe("Oct 6, 2026");
  });

  it("shows the right wall clock around DST changes", () => {
    expect(formatOrgDateTime("2026-03-08T06:59:00Z", NY)).toBe("Mar 8, 2026 1:59 AM");
    expect(formatOrgDateTime("2026-03-08T07:00:00Z", NY)).toBe("Mar 8, 2026 3:00 AM");
    expect(formatOrgDateTime("2026-11-01T05:30:00Z", NY)).toBe("Nov 1, 2026 1:30 AM");
    expect(formatOrgDateTime("2026-11-01T06:30:00Z", NY)).toBe("Nov 1, 2026 1:30 AM");
  });

  it("formats calendar dates without a timezone shift", () => {
    expect(formatDateString("2026-10-06")).toBe("Oct 6, 2026");
    expect(formatDateString("2026-01-01", "EEE, MMM d")).toBe("Thu, Jan 1");
  });
});

describe("date-string helpers", () => {
  it("adds days across month/year boundaries and DST dates", () => {
    expect(addDaysToDateString("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToDateString("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDaysToDateString("2026-10-31", 7)).toBe("2026-11-07");
  });

  it("validates dates and times", () => {
    expect(isDateString("2026-10-06")).toBe(true);
    expect(isDateString("2026-02-29")).toBe(false);
    expect(isDateString("2026-10-6")).toBe(false);
    expect(isTimeString("23:59")).toBe(true);
    expect(isTimeString("24:00")).toBe(false);
  });
});

describe("followUpBucket", () => {
  // 23:00 EDT on 2026-10-06 (already 2026-10-07 in UTC).
  const now = new Date("2026-10-07T03:00:00Z");

  it("buckets relative to org today, not UTC today", () => {
    expect(followUpBucket("2026-10-05", NY, now)).toBe("overdue");
    expect(followUpBucket("2026-10-06", NY, now)).toBe("today");
    expect(followUpBucket("2026-10-07", NY, now)).toBe("upcoming");
    // In UTC it would already be the 7th:
    expect(followUpBucket("2026-10-06", "UTC", now)).toBe("overdue");
    expect(followUpBucket("2026-10-07", "UTC", now)).toBe("today");
  });

  it(`upcoming covers the next ${UPCOMING_DAYS} days, later is beyond`, () => {
    expect(UPCOMING_DAYS).toBe(7);
    expect(followUpBucket("2026-10-13", NY, now)).toBe("upcoming"); // today + 7
    expect(followUpBucket("2026-10-14", NY, now)).toBe("later"); // today + 8
    expect(followUpBucket("2025-01-01", NY, now)).toBe("overdue");
  });

  it("handles year rollover and DST weeks", () => {
    const nye = new Date("2027-01-01T04:30:00Z"); // 23:30 EST Dec 31
    expect(followUpBucket("2026-12-31", NY, nye)).toBe("today");
    expect(followUpBucket("2027-01-01", NY, nye)).toBe("upcoming");
    expect(followUpBucket("2027-01-07", NY, nye)).toBe("upcoming");
    expect(followUpBucket("2027-01-08", NY, nye)).toBe("later");

    const beforeFallBack = new Date("2026-11-01T03:30:00Z"); // 23:30 EDT Oct 31
    expect(followUpBucket("2026-10-31", NY, beforeFallBack)).toBe("today");
    expect(followUpBucket("2026-11-07", NY, beforeFallBack)).toBe("upcoming");
    expect(followUpBucket("2026-11-08", NY, beforeFallBack)).toBe("later");
  });

  it("Honolulu late evening is still the previous day", () => {
    const now2 = new Date("2026-10-07T09:30:00Z"); // 23:30 HST Oct 6
    expect(followUpBucket("2026-10-06", HONOLULU, now2)).toBe("today");
    expect(followUpBucket("2026-10-06", NY, now2)).toBe("overdue"); // 05:30 EDT Oct 7
  });

  it("rejects malformed due dates", () => {
    expect(() => followUpBucket("10/06/2026", NY, now)).toThrow(RangeError);
  });
});

describe("followUpViewBucket (mirror of SQL follow_up_bucket)", () => {
  type Case = [
    label: string,
    status: "pending" | "completed",
    dueDate: string,
    completedAt: string | null,
    now: string,
    tz: string,
    expected: ReturnType<typeof followUpViewBucket>,
  ];
  // Same cases as supabase/tests/follow_ups.test.sql.
  const cases: Case[] = [
    ["11 pm NY (next day UTC): due NY today", "pending", "2026-10-05", null, "2026-10-06T03:00:00Z", NY, "today"],
    ["11 pm NY: due UTC today is upcoming", "pending", "2026-10-06", null, "2026-10-06T03:00:00Z", NY, "upcoming"],
    ["11 pm NY: due yesterday is overdue", "pending", "2026-10-04", null, "2026-10-06T03:00:00Z", NY, "overdue"],
    ["same instant in UTC: overdue", "pending", "2026-10-05", null, "2026-10-06T03:00:00Z", "UTC", "overdue"],
    ["Honolulu 11:30 pm: today", "pending", "2026-10-05", null, "2026-10-06T09:30:00Z", HONOLULU, "today"],
    ["same instant in NY: overdue", "pending", "2026-10-05", null, "2026-10-06T09:30:00Z", NY, "overdue"],
    ["DST spring: 11:30 pm EST Mar 7", "pending", "2026-03-08", null, "2026-03-08T04:30:00Z", NY, "upcoming"],
    ["DST spring: 11:30 pm EDT Mar 8", "pending", "2026-03-08", null, "2026-03-09T03:30:00Z", NY, "today"],
    ["DST fall: 11:30 pm EDT Oct 31", "pending", "2026-11-01", null, "2026-11-01T03:30:00Z", NY, "upcoming"],
    ["DST fall: 11:30 pm EST Nov 1", "pending", "2026-11-01", null, "2026-11-02T04:30:00Z", NY, "today"],
    ["today + 7 is upcoming", "pending", "2026-10-12", null, "2026-10-05T16:00:00Z", NY, "upcoming"],
    ["today + 8 is later", "pending", "2026-10-13", null, "2026-10-05T16:00:00Z", NY, "later"],
    ["completed on today − 29 (NY)", "completed", "2026-09-01", "2026-09-06T04:30:00Z", "2026-10-06T03:00:00Z", NY, "completed"],
    ["completed on today − 30 (NY)", "completed", "2026-09-01", "2026-09-06T03:30:00Z", "2026-10-06T03:00:00Z", NY, null],
    ["completed today, old due date", "completed", "2020-01-01", "2026-10-05T12:00:00Z", "2026-10-05T16:00:00Z", NY, "completed"],
  ];

  it.each(cases)("%s", (_label, status, dueDate, completedAt, now, tz, expected) => {
    expect(followUpViewBucket({ status, dueDate, completedAt }, tz, now)).toBe(expected);
  });

  it(`the completed window is ${COMPLETED_WINDOW_DAYS} org days in every allowed timezone`, () => {
    const now = "2026-07-15T12:00:00Z";
    for (const tz of ALLOWED_TIMEZONES) {
      const today = orgToday(tz, now);
      const first = orgLocalToUtc(addDaysToDateString(today, -(COMPLETED_WINDOW_DAYS - 1)), "00:00", tz);
      const before = orgLocalToUtc(addDaysToDateString(today, -COMPLETED_WINDOW_DAYS), "23:59", tz);
      expect(followUpViewBucket({ status: "completed", dueDate: today, completedAt: first }, tz, now)).toBe("completed");
      expect(followUpViewBucket({ status: "completed", dueDate: today, completedAt: before }, tz, now)).toBeNull();
    }
  });

  it("a completed row without completed_at is never shown", () => {
    expect(followUpViewBucket({ status: "completed", dueDate: "2026-10-05", completedAt: null }, NY)).toBeNull();
  });
});

describe("daysBetweenDateStrings", () => {
  it("counts calendar days across DST and year boundaries", () => {
    expect(daysBetweenDateStrings("2026-10-05", "2026-10-05")).toBe(0);
    expect(daysBetweenDateStrings("2026-10-05", "2026-10-08")).toBe(3);
    expect(daysBetweenDateStrings("2026-10-08", "2026-10-05")).toBe(-3);
    expect(daysBetweenDateStrings("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetweenDateStrings("2026-12-31", "2027-01-01")).toBe(1);
    expect(() => daysBetweenDateStrings("2026-02-30", "2026-03-01")).toThrow(RangeError);
  });
});

describe("timeZoneAbbreviation", () => {
  it("derives a short label for every allowed org timezone (winter and summer)", () => {
    const expected: Record<string, string> = {
      "America/New_York": "ET",
      "America/Chicago": "CT",
      "America/Denver": "MT",
      "America/Phoenix": "MST",
      "America/Los_Angeles": "PT",
      "America/Anchorage": "AKT",
      "Pacific/Honolulu": "HST",
    };
    for (const tz of ALLOWED_TIMEZONES) {
      for (const at of ["2026-01-15T12:00:00Z", "2026-07-15T12:00:00Z"]) {
        expect(timeZoneAbbreviation(tz, at)).toBe(expected[tz]);
      }
    }
  });

  it("rejects invalid zones", () => {
    expect(() => timeZoneAbbreviation("Mars/Base")).toThrow(RangeError);
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-06T15:00:00Z");
  it("formats past and future durations", () => {
    expect(formatRelativeTime("2026-10-06T14:59:30Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-10-06T14:55:00Z", now)).toBe("5 minutes ago");
    expect(formatRelativeTime("2026-10-06T12:10:00Z", now)).toBe("2 hours ago");
    expect(formatRelativeTime("2026-10-03T15:00:00Z", now)).toBe("3 days ago");
    expect(formatRelativeTime("2026-08-01T15:00:00Z", now)).toBe("2 months ago");
    expect(formatRelativeTime("2026-10-06T17:00:00Z", now)).toBe("in 2 hours");
  });
  it("rejects invalid timestamps", () => {
    expect(() => formatRelativeTime("nope", now)).toThrow(RangeError);
  });
});
