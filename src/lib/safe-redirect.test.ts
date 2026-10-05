import { describe, expect, it } from "vitest";

import {
  isManagerOnlyPath,
  isPublicPath,
  isSignedOutOnlyPath,
  safeNextPath,
} from "./safe-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/prospects", "/prospects"],
    ["/prospects/abc?tab=timeline", "/prospects/abc?tab=timeline"],
    ["/follow-ups#today", "/follow-ups#today"],
  ])("keeps safe relative path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "dashboard",
    "https://evil.com",
    "//evil.com",
    "//evil.com/path",
    "/\\evil.com",
    "/\t/evil.com",
    "/%0a/evil.com".replace("%0a", "\n"),
    "javascript:alert(1)",
    "/login",
    "/login?next=/x",
    "/auth/confirm?token_hash=x",
    "/set-password",
    "/forgot-password",
  ])("falls back for unsafe value %j", (input) => {
    expect(safeNextPath(input)).toBe("/dashboard");
  });

  it("uses a custom fallback", () => {
    expect(safeNextPath("//evil.com", "/reports")).toBe("/reports");
  });
});

describe("path classification", () => {
  it("public paths", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
    expect(isPublicPath("/set-password")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
  });

  it("signed-out-only paths", () => {
    expect(isSignedOutOnlyPath("/login")).toBe(true);
    expect(isSignedOutOnlyPath("/auth/confirm")).toBe(false);
  });

  it("manager-only paths", () => {
    expect(isManagerOnlyPath("/settings")).toBe(true);
    expect(isManagerOnlyPath("/settings/team")).toBe(true);
    expect(isManagerOnlyPath("/settingsx")).toBe(false);
  });
});
