import { ɵformatLabel } from "@copilotkit/core";

/**
 * Fill a count label: the `one` template for a count of 1, the `other`
 * template for any other count. `{count}` in the template becomes the count.
 *
 * @param count - The number to show.
 * @param templates - The label for exactly one, and for any other count.
 *
 * @example
 * ```ts
 * formatCountLabel(3, {
 *   one: labels.toolCallUsedToolsOne,
 *   other: labels.toolCallUsedToolsOther,
 * }); // "Used 3 tools"
 * ```
 * @internal
 */
export function formatCountLabel(
  count: number,
  templates: { one: string; other: string },
) {
  const template = count === 1 ? templates.one : templates.other;
  return ɵformatLabel(template, { count });
}
