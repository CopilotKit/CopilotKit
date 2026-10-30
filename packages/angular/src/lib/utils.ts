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

/**
 * Asserts that a value is neither `null` nor `undefined` and narrows its type
 * to `NonNullable<T>`.
 *
 * @param value - The value to validate.
 * @param message - The error message to use when the value is nullish.
 * @throws {Error} If the value is `null` or `undefined`.
 */
export function assertDefined<T>(
  value: T,
  message = `Value must be defined ${String(value)}`,
): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
}
