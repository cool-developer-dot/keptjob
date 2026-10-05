import { describe, expect, it } from "vitest";

import { changeRoleSchema, inviteUserSchema, orgSettingsSchema } from "./settings";

describe("orgSettingsSchema", () => {
  const valid = { defaultCurrency: "usd", timezone: "America/Phoenix", staleDays: "30" };

  it("normalises currency and coerces stale days", () => {
    expect(orgSettingsSchema.parse(valid)).toEqual({
      defaultCurrency: "USD",
      timezone: "America/Phoenix",
      staleDays: 30,
    });
  });

  it("rejects unknown currencies, timezones outside the allowed list and stale days out of range", () => {
    expect(orgSettingsSchema.safeParse({ ...valid, defaultCurrency: "XYZ" }).success).toBe(false);
    expect(orgSettingsSchema.safeParse({ ...valid, defaultCurrency: "US" }).success).toBe(false);
    expect(orgSettingsSchema.safeParse({ ...valid, timezone: "Europe/London" }).success).toBe(false);
    for (const staleDays of [0, 366, 1.5, "abc"]) {
      expect(orgSettingsSchema.safeParse({ ...valid, staleDays }).success).toBe(false);
    }
    for (const staleDays of [1, 365]) {
      expect(orgSettingsSchema.safeParse({ ...valid, staleDays }).success).toBe(true);
    }
  });
});

describe("inviteUserSchema", () => {
  it("trims the name and lowercases the email", () => {
    expect(
      inviteUserSchema.parse({ fullName: "  Dana Doe ", email: " Dana@Example.COM ", role: "sales_rep" }),
    ).toEqual({ fullName: "Dana Doe", email: "dana@example.com", role: "sales_rep" });
  });

  it("rejects empty names, bad emails and unknown roles", () => {
    const base = { fullName: "Dana", email: "dana@example.com", role: "manager" };
    expect(inviteUserSchema.safeParse({ ...base, fullName: "  " }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ ...base, role: "admin" }).success).toBe(false);
  });
});

describe("changeRoleSchema", () => {
  it("requires a uuid and a valid role", () => {
    const userId = "11111111-1111-4111-8111-000000000001";
    expect(changeRoleSchema.safeParse({ userId, role: "manager" }).success).toBe(true);
    expect(changeRoleSchema.safeParse({ userId: "1", role: "manager" }).success).toBe(false);
    expect(changeRoleSchema.safeParse({ userId, role: "owner" }).success).toBe(false);
  });
});
