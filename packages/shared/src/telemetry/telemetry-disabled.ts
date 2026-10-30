const DISABLED_VALUES = new Set(["true", "1", "yes"]);

function isDisabledValue(value: string | undefined): boolean {
  return DISABLED_VALUES.has(value?.trim().toLowerCase() ?? "");
}

function readEnv(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * Checks if telemetry is disabled via environment variables.
 * Users can opt out by setting either variable to `true`, `1` or `yes`, in any
 * letter case:
 * - COPILOTKIT_TELEMETRY_DISABLED
 * - DO_NOT_TRACK
 *
 * Lives in its own module so that the browser-facing root entry can
 * re-export it without pulling in `telemetry-client.ts`, whose
 * `@segment/analytics-node` import drags Node built-ins into browser
 * bundler module graphs. See the note in `../index.ts`.
 */
export function isTelemetryDisabled(): boolean {
  // Each read stays a literal `process.env.X` so a bundler `define` can replace
  // it, and is guarded on its own so one replaced value still counts in a
  // browser that has no `process`.
  return (
    isDisabledValue(readEnv(() => process.env.COPILOTKIT_TELEMETRY_DISABLED)) ||
    isDisabledValue(readEnv(() => process.env.DO_NOT_TRACK))
  );
}
