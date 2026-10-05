/**
 * Org-timezone date/time helpers (SPEC §6).
 *
 * Every date/time computation and display in the app goes through this module:
 * timestamps are stored in UTC and interpreted in the org timezone from
 * org_settings (never hardcoded). "Today" = the current date in the org
 * timezone (SQL counterpart: org_today()).
 *
 * The helpers (orgToday, toOrgDate, formatOrgDateTime, orgLocalToUtc,
 * followUpBucket), built on @date-fns/tz, are implemented in Prompt 4.
 */
export {};
