import type { z } from "zod";

import type { ActionResult } from "@/server/actions/types";

/** Shape shared by PostgrestError and plain Postgres errors. */
export type DbError = { code?: string | null; message?: string | null } | null | undefined;

export const MESSAGES = {
  invalidInput: "Please check the form and try again.",
  sessionExpired: "Your session has expired. Please sign in again.",
  noPermission: "You don't have permission to do that.",
  managersOnly: "Only managers can do that.",
  prospectNotFound: "Prospect not found or you don't have access.",
  followUpNotFound: "Follow-up not found or you don't have access.",
  userNotFound: "User not found.",
} as const;

/**
 * Maps PostgREST / Postgres errors to a user-presentable message. Raw DB
 * messages are only surfaced for our own trigger exceptions (42501/P0001 with a
 * known message); everything else gets a friendly text.
 */
export function dbErrorMessage(error: DbError, fallback: string): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  switch (code) {
    case "42501":
      if (/only managers can reassign prospects/i.test(message)) {
        return "Only managers can reassign prospects.";
      }
      if (/only managers/i.test(message)) return MESSAGES.managersOnly;
      return MESSAGES.noPermission;
    case "P0001":
      if (/at least one manager must remain/i.test(message)) {
        return "At least one manager must remain. Promote another user to manager first.";
      }
      return fallback;
    case "P0002":
    case "PGRST116":
      return "Not found, or you don't have access.";
    case "23503":
      return "A related record was not found.";
    case "23505":
      return "This record already exists.";
    case "23514":
    case "23502":
      return "Some values are invalid. Please check the form.";
    case "22P02":
    case "22007":
    case "22008":
    case "22003":
      return "Some values are invalid. Please check the form.";
    default:
      return fallback;
  }
}

/** Logs an unexpected DB error server-side and returns a failed ActionResult. */
export function dbFailure(where: string, error: DbError, fallback: string): { ok: false; error: string } {
  console.error(`${where} failed`, error);
  return { ok: false, error: dbErrorMessage(error, fallback) };
}

/** Failed ActionResult from a Zod error (first issue message). */
export function validationFailure(error: z.ZodError): { ok: false; error: string } {
  return { ok: false, error: error.issues[0]?.message ?? MESSAGES.invalidInput };
}

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}
