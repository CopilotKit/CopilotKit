import { describe, it, expect } from "vitest";
import type { Persona, Run, RunStep, StepStatus } from "./types";
import { approveStep, cancelRun, rejectStep, tick } from "./engine";

const T0 = Date.parse("2026-08-02T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const PRIVACY_OFFICER: Persona = {
  id: "sam-okafor",
  name: "Sam Okafor",
  role: "Privacy Officer",
  unit: "Privacy Office",
};
const NURSE: Persona = {
  id: "ana-reyes",
  name: "Ana Reyes",
  role: "Nurse Manager",
  unit: "4 West",
};

function step(
  id: string,
  status: StepStatus,
  extra: Partial<RunStep> = {},
): RunStep {
  return {
    id,
    title: id.toUpperCase(),
    role: "Team",
    requiresApproval: false,
    durationMs: 1000,
    status,
    ...extra,
  };
}

function run(steps: RunStep[], status: Run["status"]): Run {
  return {
    id: "RUN-9001",
    playbookId: "pb",
    title: "Fixture run",
    subject: "Subject",
    requestedBy: "Requester",
    createdAt: iso(T0),
    status,
    steps,
  };
}

/** A run blocked at an approval gate: a done, b awaiting (Privacy Officer), c pending. */
function blockedGateRuns(): Run[] {
  return [
    run(
      [
        step("a", "done"),
        step("b", "awaiting_approval", {
          requiresApproval: true,
          approverRole: "Privacy Officer",
        }),
        step("c", "pending"),
      ],
      "blocked",
    ),
  ];
}

describe("tick", () => {
  it("leaves a running step alone until its duration elapses", () => {
    const runs = [
      run([step("a", "running", { startedAt: iso(T0) }), step("b", "pending")], "running"),
    ];
    const next = tick(runs, T0 + 500);
    expect(next[0].steps[0].status).toBe("running");
    expect(next[0].steps[1].status).toBe("pending");
    // Nothing moved → same array reference returned (React setState bail-out).
    expect(next).toBe(runs);
  });

  it("completes only the elapsed step and starts the next one", () => {
    const runs = [
      run([step("a", "running", { startedAt: iso(T0) }), step("b", "pending")], "running"),
    ];
    const next = tick(runs, T0 + 1500);
    expect(next[0].steps[0].status).toBe("done");
    expect(next[0].steps[0].completedAt).toBeTruthy();
    expect(next[0].steps[1].status).toBe("running");
    expect(next[0].status).toBe("running");
  });

  it("halts at an approval gate and blocks the run", () => {
    const runs = [
      run(
        [
          step("a", "running", { startedAt: iso(T0) }),
          step("b", "pending", {
            requiresApproval: true,
            approverRole: "Privacy Officer",
          }),
        ],
        "running",
      ),
    ];
    const next = tick(runs, T0 + 1500);
    expect(next[0].steps[1].status).toBe("awaiting_approval");
    expect(next[0].status).toBe("blocked");
  });

  it("does not touch a completed, terminal run", () => {
    const runs = [run([step("a", "done"), step("b", "done")], "completed")];
    expect(tick(runs, T0 + 999_999)).toBe(runs);
  });
});

describe("approveStep", () => {
  it("advances the run when the right role approves", () => {
    const result = approveStep(blockedGateRuns(), "RUN-9001", "b", PRIVACY_OFFICER);
    expect(result.ok).toBe(true);
    const updated = result.runs[0];
    expect(updated.steps[1].status).toBe("done");
    expect(updated.steps[1].approvedBy).toBe("Sam Okafor");
    expect(updated.steps[2].status).toBe("running");
    expect(updated.status).toBe("running");
  });

  it("fails when the step is not awaiting approval (stale-approval race, §12)", () => {
    const runs = [
      run(
        [
          step("a", "running", { startedAt: iso(T0) }),
          step("b", "pending", {
            requiresApproval: true,
            approverRole: "Privacy Officer",
          }),
        ],
        "running",
      ),
    ];
    const result = approveStep(runs, "RUN-9001", "b", PRIVACY_OFFICER);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not awaiting approval");
    expect(result.runs).toBe(runs); // unchanged on a failed mutation
  });

  it("fails on the wrong role and names the required role", () => {
    const result = approveStep(blockedGateRuns(), "RUN-9001", "b", NURSE);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Privacy Officer");
  });

  it("refuses to approve a step on a completed, terminal run", () => {
    const runs = [run([step("a", "done"), step("b", "done")], "completed")];
    const result = approveStep(runs, "RUN-9001", "b", PRIVACY_OFFICER);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("completed");
  });
});

describe("rejectStep", () => {
  it("cancels the run and fails the step", () => {
    const result = rejectStep(
      blockedGateRuns(),
      "RUN-9001",
      "b",
      PRIVACY_OFFICER,
      "insufficient scope",
    );
    expect(result.ok).toBe(true);
    expect(result.runs[0].status).toBe("cancelled");
    expect(result.runs[0].steps[1].status).toBe("failed");
    expect(result.runs[0].steps[1].note).toBe("insufficient scope");
  });
});

describe("cancelRun", () => {
  it("cancels an in-flight run and leaves terminal runs untouched", () => {
    const runs = [run([step("a", "running", { startedAt: iso(T0) })], "running")];
    expect(cancelRun(runs, "RUN-9001")[0].status).toBe("cancelled");

    const done = [run([step("a", "done")], "completed")];
    expect(cancelRun(done, "RUN-9001")[0].status).toBe("completed");
  });
});
