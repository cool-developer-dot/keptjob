import { describe, expect, it } from "vitest";

import { forgotPasswordSchema, loginSchema, setPasswordSchema } from "./auth";

describe("auth schemas", () => {
  it("login: normalizes email and requires a password", () => {
    expect(loginSchema.parse({ email: " Riley@Example.com ", password: "x" }).email).toBe(
      "riley@example.com",
    );
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });

  it("forgot password: requires a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "" }).success).toBe(false);
  });

  it("set password: min 8 chars and matching confirmation", () => {
    expect(setPasswordSchema.safeParse({ password: "short", confirmPassword: "short" }).success).toBe(false);
    const mismatch = setPasswordSchema.safeParse({ password: "longenough", confirmPassword: "different1" });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]?.path).toEqual(["confirmPassword"]);
    expect(setPasswordSchema.safeParse({ password: "longenough", confirmPassword: "longenough" }).success).toBe(true);
  });
});
