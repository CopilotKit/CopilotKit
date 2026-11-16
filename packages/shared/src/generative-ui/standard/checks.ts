import { z } from "zod";
import { textColor, textFont } from "./tokens";

/**
 * The `checks` of the A2UI 1.0 `Checkable` components. The model writes
 * each condition as a validator call or a boolean binding:
 * `{ "condition": { "@call": "email", "args": { "value": { "@path": "/form/email" } } }, "message": "..." }`.
 * The engine resolves the condition before the component renders, so a
 * component sees a boolean or a `ValidationResult`.
 */

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

/** The style of a check message, by its severity. */
export function checkMessageStyle(severity: FailedCheck["severity"]) {
  return {
    ...textFont("sm"),
    color: textColor(
      severity === "error"
        ? "danger"
        : severity === "warning"
          ? "warning"
          : "secondary",
    ),
  };
}
