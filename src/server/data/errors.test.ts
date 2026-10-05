import { describe, expect, it, vi } from "vitest";

import { dbErrorMessage, dbFailure, MESSAGES } from "./errors";

describe("dbErrorMessage", () => {
  const fallback = "fallback";

  it("maps permission errors, keeping the reassignment trigger message", () => {
    expect(dbErrorMessage({ code: "42501", message: "Only managers can reassign prospects" }, fallback)).toBe(
      "Only managers can reassign prospects.",
    );
    expect(dbErrorMessage({ code: "42501", message: 'new row violates row-level security policy for table "x"' }, fallback)).toBe(
      MESSAGES.noPermission,
    );
  });

  it("maps not found, FK, check and invalid-value errors", () => {
    expect(dbErrorMessage({ code: "P0002", message: "Prospect not found" }, fallback)).toMatch(/not found/i);
    expect(dbErrorMessage({ code: "PGRST116", message: "0 rows" }, fallback)).toMatch(/not found/i);
    expect(dbErrorMessage({ code: "23503" }, fallback)).toMatch(/related record/i);
    expect(dbErrorMessage({ code: "23514" }, fallback)).toMatch(/invalid/i);
    expect(dbErrorMessage({ code: "22P02" }, fallback)).toMatch(/invalid/i);
    expect(dbErrorMessage({ code: "P0001", message: "At least one manager must remain" }, fallback)).toMatch(
      /at least one manager/i,
    );
  });

  it("falls back for unknown errors and never leaks raw messages", () => {
    expect(dbErrorMessage({ code: "XX000", message: "internal secret detail" }, fallback)).toBe(fallback);
    expect(dbErrorMessage(null, fallback)).toBe(fallback);
    expect(dbErrorMessage({ code: "P0001", message: "something else" }, fallback)).toBe(fallback);
  });

  it("dbFailure logs and returns a failed result", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(dbFailure("x", { code: "23514" }, fallback)).toEqual({ ok: false, error: expect.stringMatching(/invalid/i) });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
