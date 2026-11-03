/**
 * Joins CSS class names while omitting empty values.
 *
 * @param values Candidate class names.
 * @returns A space-separated class name string.
 */
export function classNames(
  ...values: ReadonlyArray<string | false | null | undefined>
): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}
