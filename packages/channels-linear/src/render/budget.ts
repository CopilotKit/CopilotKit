/**
 * Limits the renderer clamps against when lowering IR to Linear agent
 * activities. Linear does not document a hard cap on an activity body, so
 * `activityBody` is a conservative bound that keeps one activity readable in
 * the session panel. `optionValue` bounds a `select` option, which the user
 * sees as a button label and which Linear echoes back as the `prompt` body.
 */
export const LINEAR_LIMITS = {
  /** Max chars in an activity `body` (response, elicitation, error, thought). */
  activityBody: 50_000,
  /** Max chars in one `select` option value. */
  optionValue: 200,
};

/** Appended to text cut by {@link truncateText} so the reader sees it was cut. */
export const TRUNCATION_MARKER = "…";

/**
 * Cut `text` to at most `max` chars. When it is longer, the result ends with
 * {@link TRUNCATION_MARKER}. The result is never longer than `max`.
 */
export function truncateText(text: string, max: number) {
  if (text.length <= max) return text;
  if (max <= TRUNCATION_MARKER.length) return text.slice(0, max);
  return text.slice(0, max - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}
