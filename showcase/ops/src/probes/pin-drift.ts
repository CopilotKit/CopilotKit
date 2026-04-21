import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";

export interface PinDriftInput {
  /** Current FAIL count from the pin-drift audit run. */
  actualCount: number;
  /** Stored baseline FAIL count (prior week). */
  baselineCount: number;
}

export interface PinDriftSignal {
  actualCount: number;
  baselineCount: number;
  setStatus: "stable" | "regressed" | "improved";
  stable: boolean;
  regressed: boolean;
  improved: boolean;
}

/**
 * Pin-drift probe: compares current FAIL count against last week's baseline.
 * `stable` = no change, `regressed` = more fails, `improved` = fewer fails.
 * Probe always returns green — state is conveyed via signal.setStatus for
 * weekly cron-driven reporting.
 */
export const pinDriftProbe: Probe<PinDriftInput, PinDriftSignal> = {
  dimension: "pin_drift",
  async run(
    input: PinDriftInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<PinDriftSignal>> {
    const { actualCount, baselineCount } = input;
    let setStatus: "stable" | "regressed" | "improved";
    if (actualCount === baselineCount) setStatus = "stable";
    else if (actualCount > baselineCount) setStatus = "regressed";
    else setStatus = "improved";

    return {
      key: "pin_drift:weekly",
      state: "green",
      signal: {
        actualCount,
        baselineCount,
        setStatus,
        stable: setStatus === "stable",
        regressed: setStatus === "regressed",
        improved: setStatus === "improved",
      },
      observedAt: ctx.now().toISOString(),
    };
  },
};
