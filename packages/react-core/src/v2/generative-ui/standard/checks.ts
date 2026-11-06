import { useState } from "react";
import { firstFailedCheck } from "@copilotkit/shared/generative-ui";
import type { ResolvedChecks } from "@copilotkit/shared/generative-ui";

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
