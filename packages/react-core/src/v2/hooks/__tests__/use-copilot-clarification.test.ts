import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  CopilotClarificationController,
  useCopilotClarification,
} from "../use-copilot-clarification";

const request = {
  question: "Which record do you mean?",
  agentId: "agent",
  threadId: "thread",
};

describe("CopilotClarificationController", () => {
  it("accepts one human answer and rejects synthetic, empty, and oversized answers", async () => {
    const controller = new CopilotClarificationController();
    const result = controller.request(request);
    expect(controller.respond(new Event("submit"), "record 1")).toBe(false);
    const trusted = Object.create(Event.prototype) as Event;
    Object.defineProperty(trusted, "isTrusted", { value: true });
    expect(controller.respond(trusted, " ")).toBe(false);
    expect(controller.respond(trusted, "x".repeat(501))).toBe(false);
    expect(controller.respond(trusted, " record 1 ")).toBe(true);
    expect(await result).toEqual({ status: "answered", answer: "record 1" });
    expect(controller.respond(trusted, "record 2")).toBe(false);
  });

  it("exposes headless state and cancels a pending request on abort", async () => {
    const controller = new CopilotClarificationController();
    const { result } = renderHook(() => useCopilotClarification(controller));
    const abort = new AbortController();
    let pending!: Promise<unknown>;
    act(() => {
      pending = controller.request(request, abort.signal);
    });
    expect(result.current?.request).toEqual(request);
    expect(() => controller.request(request)).toThrow(
      "Another clarification is pending",
    );
    act(() => abort.abort());
    expect(await pending).toEqual({ status: "cancelled" });
    expect(result.current).toBeUndefined();
  });
});

it("switches clarification stores and unsubscribes on unmount", () => {
  const first = new CopilotClarificationController();
  const second = new CopilotClarificationController();
  const unsubscribers: ReturnType<typeof vi.fn>[] = [];
  for (const controller of [first, second]) {
    const subscribe = controller.subscribe;
    vi.spyOn(controller, "subscribe").mockImplementation((listener) => {
      const unsubscribe = vi.fn(subscribe(listener));
      unsubscribers.push(unsubscribe);
      return unsubscribe;
    });
  }
  const view = renderHook(
    ({ controller }) => useCopilotClarification(controller),
    { initialProps: { controller: first } },
  );
  act(() => {
    void first.request(request);
  });
  expect(view.result.current?.request).toEqual(request);
  view.rerender({ controller: second });
  expect(view.result.current).toBeUndefined();
  expect(unsubscribers[0]).toHaveBeenCalledOnce();
  act(() => {
    void second.request(request);
  });
  expect(view.result.current?.request).toEqual(request);
  view.unmount();
  expect(unsubscribers[1]).toHaveBeenCalledOnce();
  first.cancel();
  second.cancel();
});
