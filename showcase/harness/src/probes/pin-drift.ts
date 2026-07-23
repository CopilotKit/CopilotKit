import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";

export interface PinDriftInput {
  /** Current FAIL count from the pin-drift audit run. */
  actualCount: number;
  /**
   * Stored baseline FAIL count (prior week). Null on first run when no
   * baseline has been persisted yet — the probe emits a distinct
   * `no-baseline` status rather than silently treating it as zero (which
   * would produce a spurious "regressed" signal) or as equal to actual
   * (which would look "stable" and hide the seed event).
   */
  baselineCount: number | null;
}

export interface PinDriftSignal {
  actualCount: number;
  baselineCount: number | null;
  setStatus: "stable" | "regressed" | "improved" | "no_baseline";
  stable: boolean;
  regressed: boolean;
  improved: boolean;
  /** True on first run when no prior baseline exists. Templates may suppress. */
  noBaseline: boolean;
}

/**
 * Pin-drift probe: compares current FAIL count against last week's baseline.
 * `stable` = no change, `regressed` = more fails, `improved` = fewer fails,
 * `no_baseline` = first run (templates should suppress or render a seed
 * notice rather than a delta). Probe always returns green — state is
 * conveyed via signal.setStatus for weekly cron-driven reporting.
 */
export const pinDriftProbe: Probe<PinDriftInput, PinDriftSignal> = {
  dimension: "pin_drift",
  async run(
    input: PinDriftInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<PinDriftSignal>> {
    const { actualCount, baselineCount } = input;
    let setStatus: "stable" | "regressed" | "improved" | "no_baseline";
    if (baselineCount === null) setStatus = "no_baseline";
    else if (actualCount === baselineCount) setStatus = "stable";
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
        noBaseline: setStatus === "no_baseline",
      },
      observedAt: ctx.now().toISOString(),
    };
  },
};
