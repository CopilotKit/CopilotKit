import { describe, expect, it } from "vitest";

import { describeProgress } from "./InlineAgentStateCard";
import type { Step } from "./InlineAgentStateCard";

// The card describes the STEP DATA, not the run lifecycle. A run can end
// (`status: "complete"`) before the agent finishes its plan, and then the
// card must not claim that every step is complete.

function step(title: string, status: Step["status"]): Step {
  return { id: title, title, status };
}

/** Steps 1 and 2 are done. Step 3 has the given status. */
function threeSteps(last: Step["status"]) {
  return [
    step("one", "completed"),
    step("two", "completed"),
    step("three", last),
  ];
}

describe("describeProgress", () => {
  it("does not claim completion when the run ended with a step unfinished", () => {
    expect(describeProgress(threeSteps("pending"), "complete")).toEqual({
      headline: "Stopped at step 3 of 3",
      allDone: false,
      stalled: true,
    });
  });

  it("claims completion when every step is completed", () => {
    expect(describeProgress(threeSteps("completed"), "complete")).toEqual({
      headline: "All 3 steps complete",
      allDone: true,
      stalled: false,
    });
  });

  it("reports completion from the data even while the run is still open", () => {
    expect(describeProgress(threeSteps("completed"), "inProgress")).toEqual({
      headline: "All 3 steps complete",
      allDone: true,
      stalled: false,
    });
  });

  it("counts progress while running", () => {
    expect(
      describeProgress(threeSteps("in_progress"), "inProgress").headline,
    ).toBe("Step 3 of 3");
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
    const finished = describeProgress([], "complete");
    expect(finished.headline).toBe("Planning…");
    expect(finished.allDone).toBe(false);
  });
});
