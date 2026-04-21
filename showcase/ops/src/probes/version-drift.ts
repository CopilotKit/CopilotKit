import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";

export interface VersionDriftInput {
  npmDriftDetected: boolean;
  pythonDriftDetected: boolean;
  npmSummary?: string;
  pythonSummary?: string;
}

export interface VersionDriftSignal {
  /**
   * Mustache-safe branch flags. Keys are camelCase (not `npm-drift`) because
   * Mustache splits section tags on hyphens and cannot look up hyphenated
   * keys — `{{#signal.driftType.npm-drift}}` would never render.
   */
  driftType: {
    stable: boolean;
    npmDrift: boolean;
    pythonDrift: boolean;
  };
  npmSummary: string;
  pythonSummary: string;
}

/**
 * Version-drift probe: reports one of three states in signal.driftType —
 * stable, npmDrift, pythonDrift. Always returns green at the state-machine
 * level; the weekly template branches on signal.driftType.*.
 */
export const versionDriftProbe: Probe<VersionDriftInput, VersionDriftSignal> = {
  dimension: "version_drift",
  async run(
    input: VersionDriftInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<VersionDriftSignal>> {
    const driftType = {
      stable: !input.npmDriftDetected && !input.pythonDriftDetected,
      npmDrift: input.npmDriftDetected,
      pythonDrift: input.pythonDriftDetected,
    };
    return {
      key: "version_drift:weekly",
      state: "green",
      signal: {
        driftType,
        npmSummary: input.npmSummary ?? "",
        pythonSummary: input.pythonSummary ?? "",
      },
      observedAt: ctx.now().toISOString(),
    };
  },
};
