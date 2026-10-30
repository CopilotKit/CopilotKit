export type ClassValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | ClassValue[]
  | Record<string, unknown>;

/**
 * Joins class names, skipping falsy values. Takes the same inputs as `clsx`.
 * Classes are not merged: every rule CopilotKit ships sits in `:where()`, so a
 * class the app adds wins without removing ours.
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (
      typeof input === "string" ||
      typeof input === "number" ||
      typeof input === "bigint"
    ) {
      out.push(String(input));
    } else if (Array.isArray(input)) {
      const nested = cn(...input);
      if (nested) out.push(nested);
    } else if (typeof input === "object") {
      for (const key in input) if (input[key]) out.push(key);
    }
  }
  return out.join(" ");
}
