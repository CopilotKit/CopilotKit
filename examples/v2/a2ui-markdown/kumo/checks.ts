// Copied from packages/react-core/src/v2/generative-ui/standard/checks.ts
// (firstFailedCheck, useChecks), which the package does not export. The
// Kumo controls must show checks exactly like the standard ones.
import { useState } from "react";
import { z } from "zod";

const severity = z.enum(["error", "warning", "info"]);

const validationResult = z
  .object({
    valid: z.boolean(),
    message: z.string().optional(),
    code: z.string().optional(),
    severity: severity.optional(),
  })
  .passthrough();

/** The first failed check of a control, as the control shows it. */
export interface FailedCheck {
  message: string;
  /** `"error"` when the result named none. Only an error blocks. */
  severity: z.output<typeof severity>;
  /** The `code` of the validation result, when it had one. */
  code?: string;
}

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
 * The failed check to show, or `undefined` when every check passes: the
 * first error, or the first warning or info when no check is an error, so
 * a warning never hides an error that comes after it. A condition that is
 * not known yet (undefined) passes. A `false` condition is an error with
 * the check's message. The check's message also wins over the message of
 * a validator result: the built-in validators always have one, and the
 * check is where the model puts its own wording.
 */
export function firstFailedCheck(
  checks: ResolvedChecks,
): FailedCheck | undefined {
  let first: FailedCheck | undefined;
  for (const check of checks ?? []) {
    const { condition } = check;
    if (condition === undefined || condition === null) continue;
    let failed: FailedCheck;
    if (typeof condition === "boolean") {
      if (condition) continue;
      failed = { message: check.message ?? "Invalid value", severity: "error" };
    } else {
      if (condition.valid) continue;
      failed = {
        message: check.message ?? condition.message ?? "Invalid value",
        severity: condition.severity ?? "error",
        ...(condition.code === undefined ? {} : { code: condition.code }),
      };
    }
    if (failed.severity === "error") return failed;
    first ??= failed;
  }
  return first;
}

/**
 * The check state of a control: the failed check to show, whether the
 * control is invalid, and the blur handler that marks it as touched. The
 * message shows only once the user has been in the control, or when it has
 * a value, so a fresh form does not open full of errors. A warning or an
 * info shows its message but does not make the control invalid.
 */
export function useChecks(checks: ResolvedChecks, value: unknown) {
  const [isTouched, setTouched] = useState(false);
  const failed = firstFailedCheck(checks);
  const hasValue =
    value !== undefined &&
    value !== null &&
    value !== "" &&
    value !== false &&
    !(Array.isArray(value) && value.length === 0);
  const isShown = failed !== undefined && (isTouched || hasValue);
  return {
    error: isShown ? failed : undefined,
    invalid: isShown && failed.severity === "error",
    onBlur: () => setTouched(true),
  };
}
