import { ɵformatLabel } from "@copilotkit/core";

/**
 * Fills a counted label pair: the `...One` template for a count of 1, the
 * `...Other` template for any other count. Both templates take `{count}`.
 *
 * @param count - The number to show.
 * @param templates - The `one` and `other` label templates.
 *
 * ```ts
 * formatCountLabel(3, {
 *   one: labels.toolCallToolCountOne,
 *   other: labels.toolCallToolCountOther,
 * }); // "3 tools"
 * ```
 * @internal
 */
export function formatCountLabel(
  count: number,
  templates: { one: string; other: string },
) {
  return ɵformatLabel(count === 1 ? templates.one : templates.other, {
    count,
  });
}
