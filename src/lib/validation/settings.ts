import { z } from "zod";

import { ALLOWED_TIMEZONES, ROLES } from "@/lib/constants";
import { isSupportedCurrency } from "@/lib/money";

export const STALE_DAYS_MIN = 1;
export const STALE_DAYS_MAX = 365;

export const orgSettingsSchema = z.object({
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code.")
    .refine(isSupportedCurrency, "Unknown currency code."),
  timezone: z.enum(ALLOWED_TIMEZONES, "Choose a timezone from the list."),
  staleDays: z.coerce
    .number<number>("Enter a number of days.")
    .int("Use a whole number of days.")
    .min(STALE_DAYS_MIN, `Use at least ${STALE_DAYS_MIN} day.`)
    .max(STALE_DAYS_MAX, `Use at most ${STALE_DAYS_MAX} days.`),
});
export type OrgSettingsInput = z.infer<typeof orgSettingsSchema>;

export const inviteUserSchema = z.object({
  fullName: z.string().trim().min(1, "Enter the full name.").max(100, "Use at most 100 characters."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(ROLES, "Choose a role."),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const changeRoleSchema = z.object({
  userId: z.uuid("Invalid user."),
  role: z.enum(ROLES, "Choose a role."),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
