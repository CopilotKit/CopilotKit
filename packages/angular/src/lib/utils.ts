// The class-name joiner lives in core, shared with React and Vue.
export { ɵcn as cn } from "@copilotkit/core";
export type { ɵClassValue as ClassValue } from "@copilotkit/core";

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
