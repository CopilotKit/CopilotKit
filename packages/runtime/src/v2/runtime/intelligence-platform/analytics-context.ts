import type { RunAgentInput } from "@ag-ui/client";
import { logger } from "@copilotkit/shared";

/**
 * The `forwardedProps` key an app uses to hand the runtime its analytics
 * context for one run.
 */
export const ANALYTICS_CONTEXT_FORWARDED_PROP = "__copilotkitAnalyticsContext";

/** The largest analytics context the runtime forwards, in UTF-8 bytes of JSON. */
export const MAX_ANALYTICS_CONTEXT_BYTES = 4096;

/**
 * Splits an app's analytics context off a run's input.
 *
 * The returned input no longer carries the context, so it never reaches the
 * agent or the run's stored events. The caller forwards it on the thread lock
 * request alone. The context is returned as the app sent it; check it with
 * {@link normalizeAnalyticsContext} before sending it anywhere.
 */
export function takeAnalyticsContext(input: RunAgentInput): {
  input: RunAgentInput;
  analyticsContext: unknown;
} {
  const forwardedProps: unknown = input.forwardedProps;
  if (
    typeof forwardedProps !== "object" ||
    forwardedProps === null ||
    !Object.prototype.hasOwnProperty.call(
      forwardedProps,
      ANALYTICS_CONTEXT_FORWARDED_PROP,
    )
  ) {
    return { input, analyticsContext: undefined };
  }
  const {
    [ANALYTICS_CONTEXT_FORWARDED_PROP]: analyticsContext,
    ...agentForwardedProps
  } = forwardedProps as Record<string, unknown>;
  return {
    input: { ...input, forwardedProps: agentForwardedProps },
    analyticsContext,
  };
}

/**
 * Returns a JSON copy of an app's analytics context when it has the shape the
 * lock request carries, and `undefined` otherwise.
 *
 * The runtime does not know what the context means. It checks only that the
 * value is a plain object that serializes to JSON without losing anything (no
 * functions, symbols, BigInts, cycles or non-finite numbers) in at most
 * {@link MAX_ANALYTICS_CONTEXT_BYTES}. Intelligence validates the fields.
 *
 * A missing context (`undefined` or `null`) is dropped silently. A malformed
 * one is dropped with a warning that names the problem but never the content.
 * Neither ever fails the run.
 */
export function normalizeAnalyticsContext(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  const result = serializeAnalyticsContext(value);
  if ("problem" in result) {
    logger.warn(
      { problem: result.problem },
      "Dropped the run's analytics context; the run continues without it",
    );
    return undefined;
  }
  return JSON.parse(result.json) as Record<string, unknown>;
}

function serializeAnalyticsContext(
  value: unknown,
): { json: string } | { problem: string } {
  if (!isPlainObject(value)) {
    return { problem: "not a plain object" };
  }
  let lossy: string | undefined;
  let json: string;
  try {
    json = JSON.stringify(value, (_key, entry: unknown) => {
      if (typeof entry === "function") lossy ??= "contains a function";
      else if (typeof entry === "symbol") lossy ??= "contains a symbol";
      else if (typeof entry === "number" && !Number.isFinite(entry))
        lossy ??= "contains a non-finite number";
      return entry;
    });
  } catch {
    // JSON.stringify throws on cycles and BigInts.
    return { problem: "not serializable as JSON" };
  }
  if (lossy) return { problem: lossy };
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > MAX_ANALYTICS_CONTEXT_BYTES) {
    return {
      problem: `larger than ${MAX_ANALYTICS_CONTEXT_BYTES} bytes (${bytes})`,
    };
  }
  return { json };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
