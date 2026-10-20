import { useState } from "react";
import { z } from "zod";
import type { CSSProperties } from "react";
import { textColor, textFont } from "./tokens";

/**
 * The `checks` of the A2UI 1.0 `Checkable` components. The model writes
 * each condition as a validator call or a boolean binding:
 * `{ "condition": { "@call": "email", "args": { "value": { "@path": "/form/email" } } }, "message": "..." }`.
 * The engine resolves the condition before the component renders, so a
 * component sees a boolean or a `ValidationResult`.
 */

const validationResult = z.object({
  valid: z.boolean(),
  message: z.string().optional(),
});

export const checksProp = z
  .array(
    z.object({
      condition: z
        .union([z.boolean(), validationResult])
        .optional()
        .describe(
          'A validator call, for example {"@call":"required","args":{"value":{"@path":"/x"}}}, or a boolean binding',
        ),
      message: z
        .string()
        .optional()
        .describe("Shown when the check fails, instead of the default message"),
    }),
  )
  .optional()
  .describe("Validation rules. The control shows the first failed one");

export type ResolvedChecks = z.output<typeof checksProp>;

/**
 * The message of the first failed check, or `undefined` when every check
 * passes. A condition that is not known yet (undefined) passes.
 */
export function firstFailedCheck(checks: ResolvedChecks) {
  for (const check of checks ?? []) {
    const { condition } = check;
    if (condition === undefined || condition === null) continue;
    const isValid =
      typeof condition === "boolean" ? condition : condition.valid;
    if (isValid) continue;
    const fallback =
      typeof condition === "object" ? condition.message : undefined;
    return check.message ?? fallback ?? "Invalid value";
  }
  return undefined;
}

/**
 * The check state of a control: the message to show, whether the control
 * is invalid, and the blur handler that marks it as touched. The message
 * shows only once the user has been in the control, or when it has a
 * value, so a fresh form does not open full of errors.
 */
export function useChecks(checks: ResolvedChecks, value: unknown) {
  const [isTouched, setTouched] = useState(false);
  const message = firstFailedCheck(checks);
  const hasValue =
    value !== undefined &&
    value !== null &&
    value !== "" &&
    value !== false &&
    !(Array.isArray(value) && value.length === 0);
  const isShown = message !== undefined && (isTouched || hasValue);
  return {
    error: isShown ? message : undefined,
    invalid: isShown,
    onBlur: () => setTouched(true),
  };
}

export const CHECK_ERROR_STYLE: CSSProperties = {
  ...textFont("sm"),
  color: textColor("danger"),
};
