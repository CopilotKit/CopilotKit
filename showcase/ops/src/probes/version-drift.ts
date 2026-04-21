import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";

export interface VersionDriftInput {
  npmDriftDetected: boolean;
  pythonDriftDetected: boolean;
  npmSummary?: string;
  pythonSummary?: string;
  /**
   * Optional: set to true when the upstream registry probe (npm / PyPI)
   * itself errored — NOT when drift was detected. Lets the probe
   * distinguish "registry 5xx" from "drift found" so the weekly template
   * can render a lookup-failed branch instead of a false-positive drift
   * report. Callers using fetchers with their own retry envelope should
   * only set this when retries are exhausted.
   */
  npmProbeErrored?: boolean;
  pythonProbeErrored?: boolean;
  /** Optional human-readable reason for probeErrored, surfaced in templates. */
  npmProbeErrorDesc?: string;
  pythonProbeErrorDesc?: string;
}

export interface VersionDriftSignal {
  /**
   * Mustache-safe branch flags. Keys are camelCase (not `npm-drift`) because
   * Mustache splits section tags on hyphens and cannot look up hyphenated
   * keys — `{{#signal.driftType.npm-drift}}` would never render.
   *
   * `probeErrored` fires when EITHER registry fetcher errored (npm or
   * PyPI). Kept disjoint from drift flags so templates can route errors
   * through a distinct branch instead of interpreting them as drift.
   */
  driftType: {
    stable: boolean;
    npmDrift: boolean;
    pythonDrift: boolean;
    probeErrored: boolean;
  };
  probeErrored: boolean;
  npmSummary: string;
  pythonSummary: string;
  npmProbeErrored: boolean;
  pythonProbeErrored: boolean;
  npmProbeErrorDesc: string;
  pythonProbeErrorDesc: string;
}

/**
 * Version-drift probe: reports one of four states in signal.driftType —
 * stable, npmDrift, pythonDrift, probeErrored. Always returns green at the
 * state-machine level; the weekly template branches on signal.driftType.*.
 *
 * Error handling: if the caller passes probeErrored flags, those are surfaced
 * as their own branch AND drift flags are forced off for the erroring side —
 * a registry 5xx must not masquerade as "drift found".
 */
export const versionDriftProbe: Probe<VersionDriftInput, VersionDriftSignal> = {
  dimension: "version_drift",
  async run(
    input: VersionDriftInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<VersionDriftSignal>> {
    const npmErr = input.npmProbeErrored === true;
    const pyErr = input.pythonProbeErrored === true;
    // When the probe fetcher itself errored, drop that side's drift flag —
    // we have no upstream answer so "drift detected" is not assertable.
    const npmDrift = !npmErr && input.npmDriftDetected;
    const pythonDrift = !pyErr && input.pythonDriftDetected;
    const probeErrored = npmErr || pyErr;
    const driftType = {
      stable: !npmDrift && !pythonDrift && !probeErrored,
      npmDrift,
      pythonDrift,
      probeErrored,
    };
    return {
      key: "version_drift:weekly",
      state: "green",
      signal: {
        driftType,
        probeErrored,
        npmSummary: input.npmSummary ?? "",
        pythonSummary: input.pythonSummary ?? "",
        npmProbeErrored: npmErr,
        pythonProbeErrored: pyErr,
        npmProbeErrorDesc: input.npmProbeErrorDesc ?? "",
        pythonProbeErrorDesc: input.pythonProbeErrorDesc ?? "",
      },
      observedAt: ctx.now().toISOString(),
    };
  },
};
