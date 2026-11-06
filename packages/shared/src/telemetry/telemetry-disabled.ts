import { processEnv } from "../utils/process-env";

/**
 * Checks if telemetry is disabled via environment variables.
 * Users can opt out by setting:
 * - COPILOTKIT_TELEMETRY_DISABLED=true or COPILOTKIT_TELEMETRY_DISABLED=1
 * - DO_NOT_TRACK=true or DO_NOT_TRACK=1
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
