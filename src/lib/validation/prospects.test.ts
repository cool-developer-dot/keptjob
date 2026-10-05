import { describe, expect, it } from "vitest";

import { LOST_REASONS, WON_REASONS } from "@/lib/constants";

import {
  prospectCreateSchema,
  prospectIdSchema,
  prospectUpdateSchema,
  reassignProspectSchema,
  stageChangeSchema,
} from "./prospects";

const ID = "11111111-1111-4111-8111-000000000002";
const ID2 = "11111111-1111-4111-8111-000000000003";

describe("prospectCreateSchema", () => {
  it("accepts a minimal prospect and applies defaults (no currency/owner → DB defaults)", () => {
    const data = prospectCreateSchema.parse({ name: "  Acme Buyer " });
    expect(data).toEqual({ name: "Acme Buyer", decisionMakerStatus: "unknown", objections: [] });
    expect("currency" in data).toBe(false);
    expect("ownerId" in data).toBe(false);
  });

  it("normalises a full prospect", () => {
    const data = prospectCreateSchema.parse({
      name: "Dana",
      company: " Acme ",
      email: " Dana@Example.COM ",
      phone: "+1 (555) 123-4567 ext 12",
      decisionMakerStatus: "yes",
      objections: ["price", "timing", "price"],
      objectionNotes: "",
      notes: "Met at a conference",
      dealValue: "12,500.555",
      currency: "eur",
      ownerId: ID,
    });
    expect(data).toMatchObject({
      company: "Acme",
      email: "dana@example.com",
      phone: "+1 (555) 123-4567 ext 12",
      objections: ["price", "timing"],
      objectionNotes: null,
      dealValue: 12500.56,
      currency: "EUR",
      ownerId: ID,
    });
  });

  it("treats empty optional strings as null", () => {
    const data = prospectCreateSchema.parse({ name: "Dana", email: "", phone: "", company: "  ", dealValue: "" });
    expect(data).toMatchObject({ email: null, phone: null, company: null, dealValue: null });
  });

  it("rejects invalid input", () => {
    const bad = [
      {},
      { name: "   " },
      { name: "x".repeat(201) },
      { name: "Dana", email: "not-an-email" },
      { name: "Dana", phone: "call me maybe" },
      { name: "Dana", dealValue: -1 },
      { name: "Dana", dealValue: "abc" },
      { name: "Dana", dealValue: 10_000_000_000 },
      { name: "Dana", currency: "XYZ" },
      { name: "Dana", currency: "US" },
      { name: "Dana", objections: ["cost"] },
      { name: "Dana", decisionMakerStatus: "maybe" },
      { name: "Dana", ownerId: "me" },
      { name: "Dana", notes: "x".repeat(10_001) },
    ];
    for (const input of bad) {
      expect(prospectCreateSchema.safeParse(input).success, JSON.stringify(input).slice(0, 80)).toBe(false);
    }
  });

  it("accepts a zero deal value", () => {
    expect(prospectCreateSchema.parse({ name: "Dana", dealValue: 0 }).dealValue).toBe(0);
  });
});

describe("prospectUpdateSchema", () => {
  it("keeps omitted fields undefined and null clears", () => {
    const data = prospectUpdateSchema.parse({ prospectId: ID, email: null, notes: "" });
    expect(data).toEqual({ prospectId: ID, email: null, notes: null });
  });

  it("accepts single-field edits", () => {
    expect(prospectUpdateSchema.safeParse({ prospectId: ID, decisionMakerStatus: "no" }).success).toBe(true);
    expect(prospectUpdateSchema.safeParse({ prospectId: ID, objections: [] }).success).toBe(true);
    expect(prospectUpdateSchema.safeParse({ prospectId: ID, dealValue: null }).success).toBe(true);
  });

  it("rejects stage, owner, close and derived fields (dedicated actions / not writable)", () => {
    for (const key of [
      "stage",
      "ownerId",
      "owner_id",
      "closeReason",
      "closeNotes",
      "closedAt",
      "lastActivityAt",
      "last_activity_at",
      "followUpDate",
      "follow_up_date",
      "demoAt",
      "createdBy",
    ]) {
      const result = prospectUpdateSchema.safeParse({ prospectId: ID, name: "Dana", [key]: "x" });
      expect(result.success, key).toBe(false);
    }
  });

  it("explains which fields can't be changed", () => {
    const result = prospectUpdateSchema.safeParse({ prospectId: ID, stage: "closed_won", ownerId: ID });
    expect(result.success ? "" : result.error.issues[0].message).toMatch(/can't be changed here: stage, ownerId/);
  });

  it("rejects an empty update, a missing id and an empty name", () => {
    expect(prospectUpdateSchema.safeParse({ prospectId: ID }).success).toBe(false);
    expect(prospectUpdateSchema.safeParse({ name: "Dana" }).success).toBe(false);
    expect(prospectUpdateSchema.safeParse({ prospectId: ID, name: " " }).success).toBe(false);
    expect(prospectUpdateSchema.safeParse({ prospectId: ID, name: null }).success).toBe(false);
  });
});

describe("stageChangeSchema", () => {
  it("moves to any open stage without close fields (forward, backward, skip, reopen)", () => {
    for (const toStage of ["prospect", "contacted", "qualified", "demo_booked", "follow_up"]) {
      const data = stageChangeSchema.parse({ prospectId: ID, toStage, note: " moved " });
      expect(data).toMatchObject({ toStage, closeReason: null, note: "moved" });
    }
  });

  it("requires a won reason from the won list for closed_won", () => {
    for (const reason of WON_REASONS) {
      expect(stageChangeSchema.safeParse({ prospectId: ID, toStage: "closed_won", closeReason: reason }).success).toBe(
        true,
      );
    }
    expect(stageChangeSchema.safeParse({ prospectId: ID, toStage: "closed_won" }).success).toBe(false);
    expect(stageChangeSchema.safeParse({ prospectId: ID, toStage: "closed_won", closeReason: "" }).success).toBe(false);
    // Lost-only reasons are not valid for closed_won.
    for (const reason of ["price", "timing", "no_budget", "no_response", "not_a_fit", "bogus"]) {
      const result = stageChangeSchema.safeParse({ prospectId: ID, toStage: "closed_won", closeReason: reason });
      expect(result.success, reason).toBe(false);
    }
  });

  it("requires a lost reason from the lost list for closed_lost", () => {
    for (const reason of LOST_REASONS) {
      expect(stageChangeSchema.safeParse({ prospectId: ID, toStage: "closed_lost", closeReason: reason }).success).toBe(
        true,
      );
    }
    expect(stageChangeSchema.safeParse({ prospectId: ID, toStage: "closed_lost" }).success).toBe(false);
    for (const reason of ["product_fit", "price_value", "relationship", "urgent_need"]) {
      const result = stageChangeSchema.safeParse({ prospectId: ID, toStage: "closed_lost", closeReason: reason });
      expect(result.success, reason).toBe(false);
    }
  });

  it("keeps optional close notes and the note for closed targets", () => {
    const data = stageChangeSchema.parse({
      prospectId: ID,
      toStage: "closed_lost",
      closeReason: "no_budget",
      closeNotes: " Budget frozen ",
      note: "",
    });
    expect(data).toMatchObject({ closeReason: "no_budget", closeNotes: "Budget frozen", note: null });
  });

  it("rejects close fields for open targets, unknown stages and bad ids", () => {
    expect(
      stageChangeSchema.safeParse({ prospectId: ID, toStage: "contacted", closeReason: "price" }).success,
    ).toBe(false);
    expect(
      stageChangeSchema.safeParse({ prospectId: ID, toStage: "qualified", closeNotes: "notes" }).success,
    ).toBe(false);
    expect(stageChangeSchema.safeParse({ prospectId: ID, toStage: "won" }).success).toBe(false);
    expect(stageChangeSchema.safeParse({ prospectId: "x", toStage: "contacted" }).success).toBe(false);
    expect(
      stageChangeSchema.safeParse({ prospectId: ID, toStage: "contacted", note: "x".repeat(2001) }).success,
    ).toBe(false);
  });
});

describe("reassignProspectSchema / prospectIdSchema", () => {
  it("requires uuids", () => {
    expect(reassignProspectSchema.safeParse({ prospectId: ID, ownerId: ID2 }).success).toBe(true);
    expect(reassignProspectSchema.safeParse({ prospectId: ID }).success).toBe(false);
    expect(reassignProspectSchema.safeParse({ prospectId: ID, ownerId: "rep" }).success).toBe(false);
    expect(prospectIdSchema.safeParse({ prospectId: ID }).success).toBe(true);
    expect(prospectIdSchema.safeParse({ prospectId: "1" }).success).toBe(false);
  });
});
