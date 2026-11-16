import { computed, ref } from "vue";
import { firstFailedCheck } from "@copilotkit/shared/generative-ui";
import type { ResolvedChecks } from "@copilotkit/shared/generative-ui";

/**
 * The check state of a control: the failed check to show, whether the
 * control is invalid, and the blur handler that marks it as touched. The
 * message shows only once the user has been in the control, or when it has
 * a value, so a fresh form does not open full of errors. A warning or an
 * info shows its message but does not make the control invalid.
 *
 * @param checks - Reads the resolved `checks` prop.
 * @param value - Reads the value of the control.
 *
 * @example
 * ```ts
 * const check = useChecks(() => props.checks, () => value.value);
 * // In the template: :aria-invalid="check.invalid.value || undefined"
 * ```
 */
export function useChecks(checks: () => ResolvedChecks, value: () => unknown) {
  const isTouched = ref(false);
  const error = computed(() => {
    const failed = firstFailedCheck(checks());
    if (failed === undefined) return undefined;
    const current = value();
    const hasValue =
      current !== undefined &&
      current !== null &&
      current !== "" &&
      current !== false &&
      !(Array.isArray(current) && current.length === 0);
    return isTouched.value || hasValue ? failed : undefined;
  });
  return {
    error,
    invalid: computed(() => error.value?.severity === "error"),
    onBlur: () => {
      isTouched.value = true;
    },
  };
}
