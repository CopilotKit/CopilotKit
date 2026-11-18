import { describe, it, expect } from "vitest";
import type { Persona, Run, RunStep, StepStatus } from "./types";
import type { Playbook } from "./types";
import { approveStep, cancelRun, rejectStep, startRun, tick } from "./engine";

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

// A fixture builder. `PlaybookStep` is a discriminated union, so a spread that
// can flip `requiresApproval` cannot be proven to preserve the discriminant; the
// `as RunStep` is the deliberate escape hatch that lets a test fabricate shapes —
// including a malformed gate (requiresApproval without an approverRole) that the
// production types forbid — to pin the engine's runtime guard against them.
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
  } as RunStep;
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
      run(
        [step("a", "running", { startedAt: iso(T0) }), step("b", "pending")],
        "running",
      ),
    ];
    const next = tick(runs, T0 + 500);
    expect(next[0].steps[0].status).toBe("running");
    expect(next[0].steps[1].status).toBe("pending");
    // Nothing moved → same array reference returned (React setState bail-out).
    expect(next).toBe(runs);
  });

  it("completes only the elapsed step and starts the next one", () => {
    const runs = [
      run(
        [step("a", "running", { startedAt: iso(T0) }), step("b", "pending")],
        "running",
      ),
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
    const result = approveStep(
      blockedGateRuns(),
      "RUN-9001",
      "b",
      PRIVACY_OFFICER,
    );
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

  it("refuses a gate that names no approverRole (engine ↔ UI agreement)", () => {
    // The discriminated PlaybookStep union makes this gate unrepresentable in
    // production; the fixture fabricates one (via the `as RunStep` builder) to
    // pin the engine's runtime guard. Without the guard the engine would treat a
    // missing approverRole as "no role required" and approve it for ANYONE —
    // while the UI (step.approverRole === persona.role) finds it actionable for
    // NO one, stranding the run. Refusing keeps the two layers in agreement.
    const runs = [
      run(
        [
          step("a", "done"),
          step("b", "awaiting_approval", { requiresApproval: true }),
          step("c", "pending"),
        ],
        "blocked",
      ),
    ];
    const result = approveStep(runs, "RUN-9001", "b", PRIVACY_OFFICER);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no approver role/i);
    expect(result.runs).toBe(runs); // unchanged on a failed mutation
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

  it("does not report the rejector as the step's approver", () => {
    const result = rejectStep(
      blockedGateRuns(),
      "RUN-9001",
      "b",
      PRIVACY_OFFICER,
      "insufficient scope",
    );
    const rejected = result.runs[0].steps[1];
    // A failed step was NOT approved — "Approved by X" must never render for it.
    expect(rejected.approvedBy).toBeUndefined();
    // The rejector is recorded under a correctly-named field instead.
    expect(rejected.rejectedBy).toBe("Sam Okafor");
  });
});

describe("startedAt invariant on runtime-created gates", () => {
  it("stamps startedAt when a gate begins awaiting approval and keeps it once approved", () => {
    // A running step whose duration has elapsed, followed by a gate. tick()
    // completes the running step and opens the gate at runtime (startNextStep).
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

    const ticked = tick(runs, T0 + 1500);
    const gate = ticked[0].steps[1];
    expect(gate.status).toBe("awaiting_approval");
    // The gate became active on this tick, so it must carry a startedAt.
    expect(gate.startedAt).toBeTruthy();

    const approved = approveStep(ticked, "RUN-9001", "b", PRIVACY_OFFICER);
    expect(approved.ok).toBe(true);
    const doneGate = approved.runs[0].steps[1];
    expect(doneGate.status).toBe("done");
    // startedAt survives the awaiting_approval -> done transition, so a
    // completedAt - startedAt duration is finite (not NaN).
    expect(doneGate.startedAt).toBe(gate.startedAt);
    expect(doneGate.completedAt).toBeTruthy();
    const duration =
      Date.parse(doneGate.completedAt!) - Date.parse(doneGate.startedAt!);
    expect(Number.isNaN(duration)).toBe(false);
  });
});

describe("startRun", () => {
  const playbook: Playbook = {
    id: "pb",
    title: "Onboard contractor",
    summary: "",
    space: "privacy",
    inputs: [
      { key: "startDate", label: "Start date" },
      { key: "department", label: "Department" },
    ],
    steps: [step("a", "pending"), step("b", "pending")],
  };

  it("persists the supplied input values on the created run", () => {
    const result = startRun(
      [],
      playbook,
      {
        subject: "Priya Raman",
        values: { startDate: "2026-09-01", department: "Radiology" },
      },
      "Requester",
    );
    expect(result.ok).toBe(true);
    expect(result.run?.inputs).toEqual({
      startDate: "2026-09-01",
      department: "Radiology",
    });
  });
});

describe("cancelRun", () => {
  it("cancels a live run and reports ok", () => {
    const runs = [
      run([step("a", "running", { startedAt: iso(T0) })], "running"),
    ];
    const result = cancelRun(runs, "RUN-9001");
    expect(result.ok).toBe(true);
    expect(result.runs[0].status).toBe("cancelled");
  });

  it("reports ok:false with a reason for an unknown run id", () => {
    const runs = [
      run([step("a", "running", { startedAt: iso(T0) })], "running"),
    ];
    const result = cancelRun(runs, "RUN-9999");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("was not found");
    expect(result.runs).toBe(runs); // unchanged on a no-op
  });

  it("reports ok:false with a reason for an already-terminal run", () => {
    const done = [run([step("a", "done")], "completed")];
    const result = cancelRun(done, "RUN-9001");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("completed");
    expect(result.runs[0].status).toBe("completed"); // left untouched
  });
});
