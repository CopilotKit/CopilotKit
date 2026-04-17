/**
 * Granular debug configuration for CopilotKit runtime and client.
 * Pass `true` to enable events + lifecycle logging (but NOT verbose payloads),
 * or an object for granular control including `verbose: true` for full payloads.
 */
export type DebugConfig =
  | boolean
  | {
      /** Log every event emitted/received. Default: true */
      events?: boolean;
      /** Log request/run lifecycle. Default: true */
      lifecycle?: boolean;
      /** Log full event payloads instead of summaries. Default: false — must be explicitly opted in */
      verbose?: boolean;
    };

/** Normalized debug configuration — all fields resolved to booleans. */
export interface ResolvedDebugConfig {
  enabled: boolean;
  events: boolean;
  lifecycle: boolean;
  verbose: boolean;
}

/** The all-off config used when debug is falsy. */
const DEBUG_OFF: ResolvedDebugConfig = {
  enabled: false,
  events: false,
  lifecycle: false,
  verbose: false,
};

/**
 * Normalizes a DebugConfig value into a ResolvedDebugConfig.
 *
 * - `false` / `undefined` → all off
 * - `true` → events + lifecycle on, verbose off (no PII in logs)
 * - object → merges with defaults (events: true, lifecycle: true, verbose: false)
 */
export function resolveDebugConfig(
  debug: DebugConfig | undefined,
): ResolvedDebugConfig {
  if (!debug) return DEBUG_OFF;

  if (debug === true) {
    return { enabled: true, events: true, lifecycle: true, verbose: false };
  }

  const events = debug.events ?? true;
  const lifecycle = debug.lifecycle ?? true;
  const enabled = events || lifecycle;
  const verbose = enabled && (debug.verbose ?? false);

  return { enabled, events, lifecycle, verbose };
}
