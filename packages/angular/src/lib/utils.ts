import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility function to merge Tailwind CSS classes
 * Combines clsx for conditional classes and tailwind-merge for proper Tailwind class merging
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
