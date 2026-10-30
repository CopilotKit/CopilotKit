export type NumberFormat = "number" | "currency" | "percent" | "compact";

export function formatNumber(value: unknown, format: NumberFormat = "number", unit?: string, currency = "USD"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return value == null ? "" : String(value);
  let out: string;
  switch (format) {
    case "currency":
      out = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 }).format(value);
      break;
    case "percent":
      out = `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
      break;
    case "compact":
      out = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
      break;
    default:
      out = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }
  if (format === "percent" && unit?.trim() === "%") unit = undefined;
  return unit ? `${out}${unit.startsWith("%") || unit.startsWith("°") ? "" : " "}${unit}` : out;
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
