/**
 * Granular debug configuration for CopilotKit runtime and client.
 * Pass `true` for full debug output, or an object for granular control.
 */
export type DebugConfig =
  | boolean
  | {
      /** Log every event emitted/received. Default: true */
      events?: boolean;
      /** Log request/run lifecycle. Default: true */
      lifecycle?: boolean;
      /** Log full event payloads instead of summaries. Default: true when debug is boolean, false when debug is object */
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
 * - `true` → all on (events, lifecycle, verbose)
 * - object → merges with defaults (events: true, lifecycle: true, verbose: false)
 */
export function resolveDebugConfig(
  debug: DebugConfig | undefined,
): ResolvedDebugConfig {
  if (!debug) return DEBUG_OFF;

  if (debug === true) {
    return { enabled: true, events: true, lifecycle: true, verbose: true };
  }

  const events = debug.events ?? true;
  const lifecycle = debug.lifecycle ?? true;
  const verbose = debug.verbose ?? false;
  const enabled = events || lifecycle;

  return { enabled, events, lifecycle, verbose };
}
