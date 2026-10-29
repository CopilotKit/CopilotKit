import { computed, signal } from "@angular/core";
import type { Signal } from "@angular/core";
import { firstFailedCheck } from "@copilotkit/shared/generative-ui";
import type {
  FailedCheck,
  ResolvedChecks,
} from "@copilotkit/shared/generative-ui";

/** An error that the host gives a control, in the Signal Forms shape. */
export interface GenerativeUIValidationError {
  kind: string;
  message?: string;
}

/** What a control shows for its checks and the host's errors. */
export interface GenerativeUIChecksState {
  /** The failed check or host error to show, if any. */
  error: Signal<FailedCheck | undefined>;
  /** True when the shown problem is an error, not a warning or an info. */
  invalid: Signal<boolean>;
  /** Marks the control as touched: the message shows from now on. */
  touch(): void;
}

/**
 * The check state of a control: the failed check to show, whether the
 * control is invalid, and `touch()` for the blur handler. The message shows
 * only once the user has been in the control, or when it has a value, so a
 * fresh form does not open full of errors. A warning or an info shows its
 * message but does not make the control invalid. The host's `errors` (the
 * Signal Forms shape) come after the agent's `checks`. The counterpart of
 * React's `useChecks`.
 */
export function createChecksState(options: {
  checks: () => ResolvedChecks;
  value: () => unknown;
  errors?: () => readonly GenerativeUIValidationError[] | undefined;
  touched?: () => boolean | undefined;
}): GenerativeUIChecksState {
  const touched = signal(false);
  const failed = computed<FailedCheck | undefined>(() => {
    const own = firstFailedCheck(options.checks());
    if (own) return own;
    const host = options.errors?.()?.[0];
    return host
      ? {
          message: host.message ?? host.kind,
          severity: "error",
          code: host.kind,
        }
      : undefined;
  });
  const shown = computed(() => {
    const problem = failed();
    if (!problem) return undefined;
    const value = options.value();
    const hasValue =
      value !== undefined &&
      value !== null &&
      value !== "" &&
      value !== false &&
      !(Array.isArray(value) && value.length === 0);
    const isTouched = touched() || options.touched?.() === true;
    return isTouched || hasValue ? problem : undefined;
  });
  return {
    error: shown,
    invalid: computed(() => shown()?.severity === "error"),
    touch: () => touched.set(true),
  };
}
