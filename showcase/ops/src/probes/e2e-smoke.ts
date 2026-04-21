import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";
import { truncateUtf8 } from "../render/filters.js";

export interface E2eSmokeInput {
  /** Identifier for this run: e.g. "L1", "L2", "L3", "L4". */
  suite: string;
  /** Callback that actually runs the suite; returns pass + optional failure log text. */
  runSuite: () => Promise<{ pass: boolean; log: string }>;
}

export interface E2eSmokeSignal {
  suite: string;
  failureSummary: string;
}

/**
 * E2E smoke probe: runs a single named suite, captures first 15 lines of log
 * on failure and surfaces them in signal.failureSummary for template rendering.
 * Spec budget is 1200 bytes UTF-8 (not code units) — we use `truncateUtf8`
 * so multi-byte characters (emoji, non-ASCII) don't break the byte budget.
 */
export const e2eSmokeProbe: Probe<E2eSmokeInput, E2eSmokeSignal> = {
  dimension: "e2e_smoke",
  async run(
    input: E2eSmokeInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<E2eSmokeSignal>> {
    const result = await input.runSuite();
    const failureSummary = result.pass
      ? ""
      : truncateUtf8(result.log.split("\n").slice(0, 15).join("\n"), 1200);
    return {
      key: `e2e_smoke:${input.suite}`,
      state: result.pass ? "green" : "red",
      signal: { suite: input.suite, failureSummary },
      observedAt: ctx.now().toISOString(),
    };
  },
};
