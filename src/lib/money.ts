/**
 * Money formatting (SPEC §3, §5, §12). Each prospect stores its own currency;
 * new prospects take org_settings.default_currency. No conversion between
 * currencies (out of scope): totals are always grouped by currency.
 */

/** Currencies offered in the Settings select (any valid ISO 4217 code is accepted). */
export const COMMON_CURRENCIES = [
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
  { code: "NZD", name: "New Zealand dollar" },
  { code: "CHF", name: "Swiss franc" },
  { code: "JPY", name: "Japanese yen" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "INR", name: "Indian rupee" },
  { code: "MXN", name: "Mexican peso" },
  { code: "BRL", name: "Brazilian real" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "HKD", name: "Hong Kong dollar" },
  { code: "SEK", name: "Swedish krona" },
  { code: "NOK", name: "Norwegian krone" },
  { code: "DKK", name: "Danish krone" },
  { code: "ZAR", name: "South African rand" },
] as const;

const EMPTY = "—";
const formatters = new Map<string, Intl.NumberFormat>();

let supported: Set<string> | null = null;

/** True for an uppercase ISO 4217 code known to the runtime's Intl data. */
export function isSupportedCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  if (!supported) {
    try {
      supported = new Set(Intl.supportedValuesOf("currency"));
    } catch {
      supported = new Set(COMMON_CURRENCIES.map((c) => c.code));
    }
  }
  return supported.has(code);
}

function getFormatter(currency: string, maximumFractionDigits?: number) {
  const key = `${currency}:${maximumFractionDigits ?? ""}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      ...(maximumFractionDigits !== undefined
        ? { maximumFractionDigits, minimumFractionDigits: 0 }
        : {}),
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Formats an amount in the given currency, e.g. formatMoney(1234.5, "USD") →
 * "$1,234.50". Accepts Postgres numeric strings. null/invalid → "—".
 * `compact: true` drops decimals (for KPI tiles / Kanban totals).
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency: string,
  opts: { compact?: boolean } = {},
): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return EMPTY;

  const code = currency.trim().toUpperCase();
  try {
    return getFormatter(code, opts.compact ? 0 : undefined).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US")} ${code}`;
  }
}
