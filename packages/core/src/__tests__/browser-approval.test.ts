import { describe, expect, it, vi } from "vitest";
import { BrowserApprovalGate } from "../autopilot/browser-approval";
import type { AutopilotApprovalBinding } from "../autopilot/browser-approval";

const binding: AutopilotApprovalBinding = {
  target: {
    userId: "admin",
    organizationId: "northstar",
    recordId: "order-1",
    version: 3,
    action: "cancel",
    path: "/orders/order-1",
  },
  tool: "autopilot_cancelOrder",
  handlerVersion: "1",
  normalizedArguments: '{"ref":"c1"}',
  agentId: "logistics",
  threadId: "thread-1",
  requestId: "user-1",
  toolCallId: "call-1",
  controlRef: "c1",
};

describe("BrowserApprovalGate", () => {
  it.each([
    [
      "user",
      (value: AutopilotApprovalBinding) => (value.target.userId = "other"),
    ],
    [
      "tenant",
      (value: AutopilotApprovalBinding) =>
        (value.target.organizationId = "other"),
    ],
    [
      "record",
      (value: AutopilotApprovalBinding) => (value.target.recordId = "order-2"),
    ],
    [
      "version",
      (value: AutopilotApprovalBinding) => (value.target.version = 4),
    ],
    [
      "action",
      (value: AutopilotApprovalBinding) => (value.target.action = "edit"),
    ],
    [
      "path",
      (value: AutopilotApprovalBinding) =>
        (value.target.path = "/orders/order-2"),
    ],
    ["tool", (value: AutopilotApprovalBinding) => (value.tool = "other")],
    [
      "handler",
      (value: AutopilotApprovalBinding) => (value.handlerVersion = "2"),
    ],
    [
      "values",
      (value: AutopilotApprovalBinding) =>
        (value.normalizedArguments = '{"ref":"c2"}'),
    ],
    [
      "agent",
      (value: AutopilotApprovalBinding) => (value.agentId = "operations"),
    ],
    [
      "thread",
      (value: AutopilotApprovalBinding) => (value.threadId = "thread-2"),
    ],
    [
      "request",
      (value: AutopilotApprovalBinding) => (value.requestId = "user-2"),
    ],
    [
      "call",
      (value: AutopilotApprovalBinding) => (value.toolCallId = "call-2"),
    ],
    ["control", (value: AutopilotApprovalBinding) => (value.controlRef = "c2")],
  ])("rejects a changed %s binding before dispatch", async (_name, change) => {
    const gate = new BrowserApprovalGate();
    const current = structuredClone(binding);
    const recheck = vi.fn(async () => true);
    const operation = gate.begin(current, recheck);
    change(current);
    expect(await gate.decideFromApp(binding.target, true)).toEqual({
      mode: "autopilot",
      accepted: false,
    });
    expect(await operation.result).toMatchObject({
      status: "denied",
      reason: "Action binding changed",
    });
    expect(recheck).not.toHaveBeenCalled();
  });

  it("rechecks binding after an asynchronous identity check", async () => {
    const gate = new BrowserApprovalGate();
    const current = structuredClone(binding);
    let finishRecheck!: (value: boolean) => void;
    const operation = gate.begin(
      current,
      () => new Promise<boolean>((resolve) => (finishRecheck = resolve)),
    );
    const decision = gate.decideFromApp(binding.target, true);
    current.agentId = "operations";
    finishRecheck(true);
    expect(await decision).toEqual({ mode: "autopilot", accepted: false });
    expect(await operation.result).toMatchObject({ status: "denied" });
  });

  it("lets a trusted manual click take over a waiting action", async () => {
    const gate = new BrowserApprovalGate();
    const recheck = vi.fn(async () => true);
    const operation = gate.begin(binding, recheck);
    expect(await gate.decideFromApp(binding.target, true, true)).toEqual({
      mode: "manual",
    });
    expect(await operation.result).toMatchObject({
      status: "cancelled",
      reason: "Manual takeover",
    });
    expect(recheck).not.toHaveBeenCalled();
  });

  it("requires matching target and a single app decision before dispatch", async () => {
    const gate = new BrowserApprovalGate();
    const recheck = vi.fn(async () => true);
    const operation = gate.begin(binding, recheck);
    expect(
      await gate.decideFromApp({ ...binding.target, version: 4 }, true),
    ).toEqual({ mode: "autopilot", accepted: false });
    expect(await operation.result).toMatchObject({
      status: "denied",
      reason: "Action target changed",
    });
    expect(recheck).not.toHaveBeenCalled();
    const next = gate.begin(binding, recheck);
    const decision = await gate.decideFromApp(binding.target, true);
    expect(decision).toMatchObject({ mode: "autopilot", accepted: true });
    expect(await gate.decideFromApp(binding.target, true)).toEqual({
      mode: "autopilot",
      accepted: false,
    });
    gate.finish(next.operationId, {
      status: "completed",
      receipt: { recordId: "order-1", version: 4, status: "cancelled" },
    });
    expect(await next.result).toMatchObject({
      status: "completed",
      receipt: { version: 4 },
    });
  });

  it("does not dispatch after decline, stop, or expired approval", async () => {
    vi.useFakeTimers();
    try {
      const gate = new BrowserApprovalGate();
      const recheck = vi.fn(async () => true);
      const declined = gate.begin(binding, recheck);
      expect(await gate.decideFromApp(binding.target, false)).toEqual({
        mode: "autopilot",
        accepted: false,
      });
      expect(await declined.result).toMatchObject({ status: "denied" });
      const controller = new AbortController();
      const stopped = gate.begin(binding, recheck, controller.signal);
      controller.abort();
      expect(await stopped.result).toMatchObject({ status: "cancelled" });
      expect(await gate.decideFromApp(binding.target, true)).toEqual({
        mode: "autopilot",
        accepted: false,
      });
      expect(await gate.decideFromApp(binding.target, true, true)).toEqual({
        mode: "manual",
      });
      expect(() => gate.begin(binding, recheck, controller.signal)).toThrow(
        "stopped",
      );
      const expired = gate.begin(binding, recheck, undefined, 100);
      await vi.advanceTimersByTimeAsync(101);
      expect(await expired.result).toMatchObject({
        status: "cancelled",
        reason: "Approval expired",
      });
      expect(recheck).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a completed effect even if Stop arrives after dispatch", async () => {
    const gate = new BrowserApprovalGate();
    const controller = new AbortController();
    const operation = gate.begin(binding, async () => true, controller.signal);
    expect(await gate.decideFromApp(binding.target, true)).toMatchObject({
      mode: "autopilot",
      accepted: true,
    });
    controller.abort();
    gate.finish(operation.operationId, {
      status: "completed",
      receipt: { recordId: "order-1", version: 4, status: "cancelled" },
    });
    expect(await operation.result).toMatchObject({ status: "completed" });
  });
});
