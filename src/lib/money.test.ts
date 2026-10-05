import { describe, expect, it } from "vitest";

import { COMMON_CURRENCIES, formatMoney, isSupportedCurrency } from "./money";

describe("formatMoney", () => {
  it("formats common currencies", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "EUR")).toBe("€1,234.50");
    expect(formatMoney(1234.5, "GBP")).toBe("£1,234.50");
    expect(formatMoney(1234, "JPY")).toBe("¥1,234");
  });

  it("accepts Postgres numeric strings and lowercase/padded codes", () => {
    expect(formatMoney("25000.00", "USD")).toBe("$25,000.00");
    expect(formatMoney(10, " usd ")).toBe("$10.00");
  });

  it("compact drops decimals", () => {
    expect(formatMoney(1234.56, "USD", { compact: true })).toBe("$1,235");
  });

  it("renders a dash for missing or invalid values", () => {
    expect(formatMoney(null, "USD")).toBe("—");
    expect(formatMoney(undefined, "USD")).toBe("—");
    expect(formatMoney("", "USD")).toBe("—");
    expect(formatMoney("abc", "USD")).toBe("—");
  });

  it("does not throw on an unknown currency code", () => {
    expect(formatMoney(5, "US")).toBe("5 US");
  });
});

describe("isSupportedCurrency", () => {
  it("accepts ISO 4217 codes and rejects others", () => {
    for (const { code } of COMMON_CURRENCIES) expect(isSupportedCurrency(code)).toBe(true);
    expect(isSupportedCurrency("usd")).toBe(false);
    expect(isSupportedCurrency("XYZ")).toBe(false);
    expect(isSupportedCurrency("US")).toBe(false);
  });
});
