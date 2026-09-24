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
