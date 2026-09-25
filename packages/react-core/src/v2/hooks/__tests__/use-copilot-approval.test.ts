import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  CopilotApprovalController,
  useCopilotApproval,
  useCopilotApprovalWork,
} from "../use-copilot-approval";

const request = {
  description: "Change an order",
  agentId: "logistics",
  threadId: "thread-1",
};

describe("CopilotApprovalController", () => {
  it("rejects synthetic approval and consumes one trusted decision", async () => {
    const controller = new CopilotApprovalController();
    const listener = vi.fn();
    controller.subscribe(listener);
    const result = controller.request(request);
    expect(controller.getSnapshot()).toEqual(request);
    expect(controller.respond(new Event("click"), true)).toBe(false);
    expect(controller.getSnapshot()).toEqual(request);
    const trusted = Object.create(Event.prototype) as Event;
    Object.defineProperty(trusted, "isTrusted", { value: true });
    expect(controller.respond(trusted, true)).toBe(true);
    expect(await result).toBe("approved");
    expect(controller.getSnapshot()).toBeUndefined();
    expect(controller.getWorkSnapshot()).toEqual(request);
    expect(controller.respond({ isTrusted: true } as Event, true)).toBe(false);
    controller.cancel();
    expect(controller.getWorkSnapshot()).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("cancels on abort and prevents overlapping requests", async () => {
    const controller = new CopilotApprovalController();
    const abort = new AbortController();
    const result = controller.request(request, abort.signal);
    expect(() => controller.request(request)).toThrow(
      "Another approval is pending",
    );
    abort.abort();
    expect(await result).toBe("cancelled");
    expect(controller.getSnapshot()).toBeUndefined();
  });

  it("exposes pending state to a headless consumer", async () => {
    const controller = new CopilotApprovalController();
    const { result } = renderHook(() => useCopilotApproval(controller));
    const work = renderHook(() => useCopilotApprovalWork(controller));
    expect(result.current).toBeUndefined();
    let decision!: Promise<"approved" | "declined" | "cancelled">;
    act(() => {
      decision = controller.request(request);
    });
    expect(result.current?.request).toEqual(request);
    expect(work.result.current).toEqual(request);
    act(() => controller.cancel());
    expect(result.current).toBeUndefined();
    expect(work.result.current).toBeUndefined();
    expect(await decision).toBe("cancelled");
  });
});

describe.each([useCopilotApproval, useCopilotApprovalWork])(
  "approval hook subscriptions",
  (hook) => {
    it("switches stores on rerender and unsubscribes on unmount", () => {
      const first = new CopilotApprovalController();
      const second = new CopilotApprovalController();
      const unsubscribers: ReturnType<typeof vi.fn>[] = [];
      for (const controller of [first, second]) {
        const subscribe = controller.subscribe;
        vi.spyOn(controller, "subscribe").mockImplementation((listener) => {
          const unsubscribe = vi.fn(subscribe(listener));
          unsubscribers.push(unsubscribe);
          return unsubscribe;
        });
      }
      const view = renderHook(({ controller }) => hook(controller), {
        initialProps: { controller: first },
      });
      act(() => {
        void first.request(request);
      });
      expect(view.result.current).toBeDefined();
      view.rerender({ controller: second });
      expect(view.result.current).toBeUndefined();
      expect(unsubscribers[0]).toHaveBeenCalledOnce();
      act(() => {
        void second.request(request);
      });
      expect(view.result.current).toBeDefined();
      view.unmount();
      expect(unsubscribers[1]).toHaveBeenCalledOnce();
      first.cancel();
      second.cancel();
    });
  },
);
