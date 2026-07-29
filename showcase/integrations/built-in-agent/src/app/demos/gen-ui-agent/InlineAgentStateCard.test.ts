import { describe, expect, it } from "vitest";

import { describeProgress } from "./InlineAgentStateCard";
import type { Step } from "./InlineAgentStateCard";

/**
 * The card must describe the STEP DATA, not the run lifecycle. When the agent
 * loop budget cut `gen-ui-agent`'s walk short, the run ended (`status:
 * "complete"`) with the last step still `pending` — and the card announced
 * "All 3 steps complete" above a list that visibly showed step 3 unstarted.
 * That contradiction is what made a truncated agent run look like a UI glitch.
 */

function step(title: string, status: Step["status"]): Step {
  return { id: title, title, status };
}

/** The observed staging shape: steps 1-2 done, step 3 never started. */
const THREE = (last: Step["status"]): Step[] => [
  step("one", "completed"),
  step("two", "completed"),
  step("three", last),
];

describe("describeProgress", () => {
  it("does NOT claim completion when the run ended with a step unfinished", () => {
    const r = describeProgress(THREE("pending"), "complete");
    expect(r.headline).toBe("Stopped at step 3 of 3");
    expect(r.headline).not.toContain("All 3 steps complete");
    expect(r.allDone).toBe(false);
    expect(r.stalled).toBe(true);
  });

  it("claims completion only when every step is completed", () => {
    const r = describeProgress(THREE("completed"), "complete");
    expect(r.headline).toBe("All 3 steps complete");
    expect(r.allDone).toBe(true);
    expect(r.stalled).toBe(false);
  });

  it("reports completion from the data even while the run is still open", () => {
    const r = describeProgress(THREE("completed"), "inProgress");
    expect(r.headline).toBe("All 3 steps complete");
    expect(r.allDone).toBe(true);
    expect(r.stalled).toBe(false);
  });

  it("counts progress while running", () => {
    expect(describeProgress(THREE("in_progress"), "inProgress").headline).toBe(
      "Step 3 of 3",
    );
    expect(
      describeProgress(
        [step("one", "completed"), step("two", "pending")],
        "inProgress",
      ).headline,
    ).toBe("Step 2 of 2");
    expect(
      describeProgress(
        [step("one", "in_progress"), step("two", "pending")],
        "inProgress",
      ).headline,
    ).toBe("Step 1 of 2");
  });

  it("shows the planning state before any step exists, and never calls it complete", () => {
    expect(describeProgress([], "inProgress").headline).toBe("Planning…");
    expect(describeProgress([], "complete").headline).toBe("Planning…");
    expect(describeProgress([], "complete").allDone).toBe(false);
  });

  it("never counts past the last step", () => {
    // `done + 1` must not overflow when the run stalls on the final step.
    const r = describeProgress(
      [step("one", "completed"), step("two", "completed")],
      "inProgress",
    );
    expect(r.headline).toBe("All 2 steps complete");
  });
});
