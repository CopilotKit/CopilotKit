// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  getAutopilotTrace,
  recordAutopilotToolTrace,
  subscribeAutopilotTrace,
} from "../autopilot/trace";

describe("Autopilot trace", () => {
  it("retains only the reference from arguments and not unrelated private input", () => {
    let updates = 0;
    const unsubscribe = subscribeAutopilotTrace(() => updates++);
    recordAutopilotToolTrace({
      id: "trace-private-argument",
      agentId: "agent",
      threadId: "thread",
      toolName: "interact",
      phase: "finished",
      args: { ref: "control-1", secret: "private-canary" },
      result: JSON.stringify({ status: "completed", remainingActionBudget: 7 }),
      elapsedMs: 11,
    });
    unsubscribe();
    const record = getAutopilotTrace().find(
      (item) => item.id === "trace-private-argument",
    );
    expect(record).toMatchObject({
      targetRef: "control-1",
      status: "completed",
      remainingActionBudget: 7,
      elapsedMs: 11,
    });
    expect(JSON.stringify(record)).not.toContain("private-canary");
    expect(updates).toBe(1);
  });
});
