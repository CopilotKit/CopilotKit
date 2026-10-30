import { processEnv } from "../utils/process-env";

/**
 * Checks if telemetry is disabled via environment variables.
 * Users can opt out by setting:
 * - COPILOTKIT_TELEMETRY_DISABLED=true or COPILOTKIT_TELEMETRY_DISABLED=1
 * - DO_NOT_TRACK=true or DO_NOT_TRACK=1
 *
 * Lives in its own module so that the browser-facing root entry can
 * re-export it without pulling in `telemetry-client.ts`, whose
 * `@segment/analytics-node` import drags Node built-ins into browser
 * bundler module graphs. See the note in `../index.ts`.
 */
export function isTelemetryDisabled(): boolean {
  const env = processEnv();
  return (
    env.COPILOTKIT_TELEMETRY_DISABLED === "true" ||
    env.COPILOTKIT_TELEMETRY_DISABLED === "1" ||
    env.DO_NOT_TRACK === "true" ||
    env.DO_NOT_TRACK === "1"
  );
}
