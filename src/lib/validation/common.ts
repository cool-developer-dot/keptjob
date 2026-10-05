import { z } from "zod";

import { isDateString, isTimeString } from "@/lib/time";

/** Tolerance for client clock skew when checking "not in the future". */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

export const uuidSchema = z.uuid("Invalid id.");

/**
 * Optional free text: trimmed; "" or null → null (clears the field);
 * undefined stays undefined (field not sent → not updated).
 */
export function optionalText(max: number, label = "This field") {
  return z
    .string()
    .nullish()
    .transform((value) => (value == null ? value : value.trim()))
    .refine((value) => value == null || value.length <= max, `${label} must be at most ${max} characters.`)
    .transform((value) => (value === undefined ? undefined : value ? value : null));
}

/** Required trimmed text, 1..max characters. */
export function requiredText(max: number, emptyMessage: string, label = "This field") {
  return z
    .string(emptyMessage)
    .trim()
    .min(1, emptyMessage)
    .max(max, `${label} must be at most ${max} characters.`);
}

/** A calendar date "YYYY-MM-DD" (org-local; Postgres `date`). */
export const dateStringSchema = z
  .string("Choose a date.")
  .refine(isDateString, "Use a valid date (YYYY-MM-DD).");

/** A 24h time "HH:mm" (org-local wall clock). */
export const timeStringSchema = z
  .string("Choose a time.")
  .refine(isTimeString, "Use a valid time (HH:mm).");
