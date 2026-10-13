/**
 * Joins optional CSS class names without introducing falsey values.
 */
export function cx(
  ...classes: readonly (false | null | string | undefined)[]
): string {
  return classes.filter((className) => Boolean(className)).join(" ");
}
