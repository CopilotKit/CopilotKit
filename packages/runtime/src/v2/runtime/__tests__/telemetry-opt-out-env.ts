/**
 * Helpers for suites that must clear the OSS-565 job-wide telemetry opt-out.
 *
 * CI sets `COPILOTKIT_TELEMETRY_DISABLED` / `DO_NOT_TRACK` for the whole job,
 * and a developer may export `DO_NOT_TRACK` globally. Suites that assert
 * telemetry DOES send have to clear those vars, or they fail on the
 * environment rather than on the code.
 *
 * Clearing them is only safe if it is undone. The opt-out is a safety
 * property, so a suite that clears it must put the original values back
 * instead of handing a weaker environment to whatever runs next in the same
 * process. Vitest's default `isolate: true` forks a fresh process per test
 * file, so a leak does not cross files today — but that is a config detail,
 * not a guarantee, and `isolate: false` would silently make it cross.
 *
 * Not a `*.test.ts` / `*.spec.ts` name, so the runner's `include` glob does
 * not collect it as a suite.
 */

export type TelemetryOptOutSnapshot = {
  COPILOTKIT_TELEMETRY_DISABLED: string | undefined;
  DO_NOT_TRACK: string | undefined;
};

/** Restores one env var, deleting it when it was originally absent. */
export function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

/**
 * Puts a snapshot taken before clearing back into `process.env`. Pair with a
 * capture in `beforeAll` — or, for suites whose module-import-time singleton
 * latches the env, with an inline capture inside `vi.hoisted` (hoisted
 * callbacks run before imports, so they cannot call this module).
 */
export function restoreTelemetryOptOutEnv(
  snapshot: TelemetryOptOutSnapshot,
): void {
  restoreEnv(
    "COPILOTKIT_TELEMETRY_DISABLED",
    snapshot.COPILOTKIT_TELEMETRY_DISABLED,
  );
  restoreEnv("DO_NOT_TRACK", snapshot.DO_NOT_TRACK);
}
