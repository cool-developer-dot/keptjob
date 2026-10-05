/**
 * Org settings shape shared by server and client code (SPEC §5). The single
 * row lives in public.org_settings; read it with getOrgSettings() (server,
 * src/lib/org.ts) or useOrgSettings() (client, OrgSettingsProvider).
 */
import { ALLOWED_TIMEZONES, type AllowedTimezone } from "@/lib/constants";

export type OrgSettings = {
  defaultCurrency: string;
  timezone: AllowedTimezone;
  staleDays: number;
};

/** Mirrors the column defaults in the org_settings migration (fallback only). */
export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  defaultCurrency: "USD",
  timezone: "America/New_York",
  staleDays: 14,
};

export type OrgSettingsRow = {
  default_currency: string;
  timezone: string;
  stale_days: number;
};

export function toOrgSettings(row: OrgSettingsRow): OrgSettings {
  const timezone = (ALLOWED_TIMEZONES as readonly string[]).includes(row.timezone)
    ? (row.timezone as AllowedTimezone)
    : DEFAULT_ORG_SETTINGS.timezone;
  return {
    defaultCurrency: row.default_currency.trim().toUpperCase(),
    timezone,
    staleDays: row.stale_days,
  };
}
