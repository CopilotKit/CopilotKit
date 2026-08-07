/**
 * Currency metadata, formatting, and a tiny static FX layer.
 *
 * FX rates are intentionally static/approximate — this is a demo, not a
 * trading desk. `convert` routes through USD as the pivot currency.
 */

import type { CurrencyCode } from "../types";

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  name: string;
}

export const CURRENCIES: CurrencyMeta[] = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "PHP", symbol: "₱", name: "Philippine Peso" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
];

/** Approximate units of 1 USD in each currency (i.e. amount * rate -> USD). */
export const FX_TO_USD: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0066,
  PHP: 0.0177,
  INR: 0.012,
  AUD: 0.66,
  CAD: 0.73,
};

const CURRENCY_BY_CODE: Record<CurrencyCode, CurrencyMeta> = CURRENCIES.reduce(
  (acc, c) => {
    acc[c.code] = c;
    return acc;
  },
  {} as Record<CurrencyCode, CurrencyMeta>,
);

/**
 * Format an amount in its currency. Uses Intl.NumberFormat when available
 * (Hermes ships a limited ICU), falling back to a symbol + fixed-decimals
 * representation so the UI never renders `NaN` or a raw number.
 *
 * Pass `maximumFractionDigits` to round (e.g. `0` for whole-dollar amounts in
 * tight, glanceable rows). Defaults to the currency's normal minor units.
 */
export function formatCurrency(
  amount: number,
  code: CurrencyCode,
  opts?: { maximumFractionDigits?: number },
): string {
  const maxDigits = opts?.maximumFractionDigits;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      // minimumFractionDigits must not exceed the max, so pin it to 0 when a
      // max is supplied (otherwise the currency default of 2 throws for max 0).
      ...(maxDigits != null
        ? { minimumFractionDigits: 0, maximumFractionDigits: maxDigits }
        : {}),
    }).format(amount);
  } catch {
    const meta = CURRENCY_BY_CODE[code];
    const symbol = meta ? meta.symbol : "";
    // JPY conventionally has no minor units.
    const fractionDigits =
      maxDigits != null ? maxDigits : code === "JPY" ? 0 : 2;
    return `${symbol}${amount.toFixed(fractionDigits)}`;
  }
}

/** Convert an amount between two currencies via the USD pivot. */
export function convert(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
): number {
  if (from === to) return amount;
  const inUsd = amount * FX_TO_USD[from];
  return inUsd / FX_TO_USD[to];
}
