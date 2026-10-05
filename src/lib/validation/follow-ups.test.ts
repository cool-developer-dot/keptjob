import { describe, expect, it } from "vitest";

import {
  followUpCompleteSchema,
  followUpCreateSchema,
  followUpIdSchema,
  followUpRescheduleSchema,
} from "./follow-ups";

const ID = "11111111-1111-4111-8111-000000000002";

describe("followUpCreateSchema", () => {
  it("accepts an org-local date string and trims the note", () => {
    expect(followUpCreateSchema.parse({ prospectId: ID, dueDate: "2026-10-07", note: " Call back " })).toEqual({
      prospectId: ID,
      dueDate: "2026-10-07",
      note: "Call back",
    });
  });

  it("rejects bad dates, empty notes and bad ids", () => {
    for (const dueDate of ["2026-02-30", "10/07/2026", "2026-10-07T00:00:00Z", ""]) {
      expect(followUpCreateSchema.safeParse({ prospectId: ID, dueDate, note: "x" }).success, dueDate).toBe(false);
    }
    expect(followUpCreateSchema.safeParse({ prospectId: ID, dueDate: "2026-10-07", note: " " }).success).toBe(false);
    expect(followUpCreateSchema.safeParse({ prospectId: ID, dueDate: "2026-10-07", note: "x".repeat(2001) }).success).toBe(
      false,
    );
    expect(followUpCreateSchema.safeParse({ prospectId: "x", dueDate: "2026-10-07", note: "x" }).success).toBe(false);
  });
});

describe("followUpRescheduleSchema / followUpCompleteSchema / followUpIdSchema", () => {
  it("validates reschedule dates", () => {
    expect(followUpRescheduleSchema.safeParse({ followUpId: ID, dueDate: "2027-01-01" }).success).toBe(true);
    expect(followUpRescheduleSchema.safeParse({ followUpId: ID, dueDate: "2027-13-01" }).success).toBe(false);
    expect(followUpRescheduleSchema.safeParse({ followUpId: ID }).success).toBe(false);
  });

  it("completion note is optional; empty → null", () => {
    expect(followUpCompleteSchema.parse({ followUpId: ID })).toEqual({ followUpId: ID });
    expect(followUpCompleteSchema.parse({ followUpId: ID, note: "" })).toEqual({ followUpId: ID, note: null });
    expect(followUpCompleteSchema.parse({ followUpId: ID, note: " Done " }).note).toBe("Done");
    expect(followUpCompleteSchema.safeParse({ followUpId: "1" }).success).toBe(false);
  });

  it("requires a uuid", () => {
    expect(followUpIdSchema.safeParse({ followUpId: ID }).success).toBe(true);
    expect(followUpIdSchema.safeParse({}).success).toBe(false);
  });
});
