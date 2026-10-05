import { z } from "zod";

import {
  DECISION_MAKER_STATUSES,
  LOST_REASONS,
  OBJECTION_CATEGORIES,
  PIPELINE_STAGES,
  WON_REASONS,
} from "@/lib/constants";
import { isSupportedCurrency } from "@/lib/money";

import { optionalText, requiredText, uuidSchema } from "./common";

/** numeric(12, 2) upper bound. */
export const DEAL_VALUE_MAX = 9_999_999_999.99;

const PHONE_RE = /^\+?[0-9().\-\s]{3,30}(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i;

const nameSchema = requiredText(200, "Enter the prospect's name.", "Name");

const emailSchema = z
  .string()
  .nullish()
  .transform((value) => (value == null ? value : value.trim().toLowerCase()))
  .refine((value) => !value || z.email().safeParse(value).success, "Enter a valid email address.")
  .transform((value) => (value === undefined ? undefined : value ? value : null));

const phoneSchema = optionalText(40, "Phone").refine(
  (value) => value == null || PHONE_RE.test(value),
  "Enter a valid phone number.",
);

/** Optional deal value: number or numeric string, ≥ 0, rounded to cents; "" / null → null. */
const dealValueSchema = z
  .union([z.number(), z.string(), z.null()], "Enter a valid amount.")
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const raw = typeof value === "string" ? value.trim().replace(/,/g, "") : value;
    if (raw === "") return null;
    const num = typeof raw === "string" ? Number(raw) : raw;
    if (!Number.isFinite(num)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount." });
      return z.NEVER;
    }
    if (num < 0) {
      ctx.addIssue({ code: "custom", message: "Deal value can't be negative." });
      return z.NEVER;
    }
    const rounded = Math.round(num * 100) / 100;
    if (rounded > DEAL_VALUE_MAX) {
      ctx.addIssue({ code: "custom", message: "Deal value is too large." });
      return z.NEVER;
    }
    return rounded;
  });

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code.")
  .refine(isSupportedCurrency, "Unknown currency code.");

const objectionsSchema = z
  .array(z.enum(OBJECTION_CATEGORIES, "Unknown objection category."))
  .transform((values) => [...new Set(values)]);

const decisionMakerStatusSchema = z.enum(DECISION_MAKER_STATUSES, "Choose a decision-maker status.");

/** Fields a user may edit on a prospect (stage/owner/close/demo have dedicated actions). */
const editableFields = {
  name: nameSchema,
  company: optionalText(200, "Company"),
  email: emailSchema,
  phone: phoneSchema,
  decisionMakerStatus: decisionMakerStatusSchema,
  objections: objectionsSchema,
  objectionNotes: optionalText(10_000, "Objection notes"),
  notes: optionalText(10_000, "Notes"),
  dealValue: dealValueSchema,
  currency: currencySchema,
};

/**
 * The detail page's "Edit details" form (client): every editable field, all
 * present. The page sends only the changed ones (changedProspectFields) to
 * updateProspect, which re-validates with prospectUpdateSchema.
 */
export const prospectDetailsFormSchema = z.object({
  ...editableFields,
  currency: currencySchema,
});
export type ProspectDetailsFormInput = z.input<typeof prospectDetailsFormSchema>;
export type ProspectDetailsFormData = z.output<typeof prospectDetailsFormSchema>;

/** Keys whose parsed value differs between `initial` and `next` (deep compare via JSON). */
export function changedProspectFields(
  initial: ProspectDetailsFormData,
  next: ProspectDetailsFormData,
): Partial<ProspectDetailsFormData> {
  const changed: Partial<Record<keyof ProspectDetailsFormData, unknown>> = {};
  for (const key of Object.keys(next) as (keyof ProspectDetailsFormData)[]) {
    if (JSON.stringify(next[key] ?? null) !== JSON.stringify(initial[key] ?? null)) changed[key] = next[key];
  }
  return changed as Partial<ProspectDetailsFormData>;
}

export const prospectCreateSchema = z.object({
  ...editableFields,
  decisionMakerStatus: decisionMakerStatusSchema.default("unknown"),
  objections: objectionsSchema.default([]),
  // Omitted → the DB fills org_settings.default_currency.
  currency: currencySchema.optional(),
  // Omitted → the current user. Only managers may assign someone else.
  ownerId: uuidSchema.optional(),
});
export type ProspectCreateInput = z.input<typeof prospectCreateSchema>;
export type ProspectCreateData = z.output<typeof prospectCreateSchema>;

/**
 * Strict: unknown keys (stage, ownerId, closeReason, lastActivityAt,
 * followUpDate, demoAt, …) are rejected, not silently dropped.
 */
export const prospectUpdateSchema = z
  .strictObject({
    prospectId: uuidSchema,
    name: nameSchema.optional(),
    company: editableFields.company,
    email: editableFields.email,
    phone: editableFields.phone,
    decisionMakerStatus: decisionMakerStatusSchema.optional(),
    objections: objectionsSchema.optional(),
    objectionNotes: editableFields.objectionNotes,
    notes: editableFields.notes,
    dealValue: editableFields.dealValue,
    currency: currencySchema.optional(),
  }, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `These fields can't be changed here: ${issue.keys.join(", ")}. Use the stage, owner or demo actions.`
        : undefined,
  })
  .refine(
    (value) =>
      Object.entries(value).some(([key, field]) => key !== "prospectId" && field !== undefined),
    "Nothing to update.",
  );
export type ProspectUpdateInput = z.input<typeof prospectUpdateSchema>;
export type ProspectUpdateData = z.output<typeof prospectUpdateSchema>;

export const stageChangeSchema = z
  .object({
    prospectId: uuidSchema,
    toStage: z.enum(PIPELINE_STAGES, "Choose a stage."),
    closeReason: z.string().trim().nullish(),
    closeNotes: optionalText(2000, "Close notes"),
    note: optionalText(2000, "Note"),
  })
  .superRefine((value, ctx) => {
    const reason = value.closeReason || null;
    if (value.toStage === "closed_won" || value.toStage === "closed_lost") {
      const allowed: readonly string[] = value.toStage === "closed_won" ? WON_REASONS : LOST_REASONS;
      if (!reason) {
        ctx.addIssue({ code: "custom", path: ["closeReason"], message: "Choose a close reason." });
      } else if (!allowed.includes(reason)) {
        ctx.addIssue({
          code: "custom",
          path: ["closeReason"],
          message: `Choose a ${value.toStage === "closed_won" ? "won" : "lost"} reason from the list.`,
        });
      }
    } else {
      if (reason) {
        ctx.addIssue({
          code: "custom",
          path: ["closeReason"],
          message: "A close reason only applies to Closed Won / Closed Lost.",
        });
      }
      if (value.closeNotes) {
        ctx.addIssue({
          code: "custom",
          path: ["closeNotes"],
          message: "Close notes only apply to Closed Won / Closed Lost.",
        });
      }
    }
  })
  .transform((value) => ({ ...value, closeReason: value.closeReason || null }));
export type StageChangeInput = z.input<typeof stageChangeSchema>;
export type StageChangeData = z.output<typeof stageChangeSchema>;

export const reassignProspectSchema = z.object({
  prospectId: uuidSchema,
  ownerId: z.uuid("Choose a user."),
});
export type ReassignProspectInput = z.input<typeof reassignProspectSchema>;

export const prospectIdSchema = z.object({ prospectId: uuidSchema });
export type ProspectIdInput = z.input<typeof prospectIdSchema>;
