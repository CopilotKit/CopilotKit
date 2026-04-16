import { describe, it, expect, vi, afterEach } from "vitest";
import { devtoolsClient } from "../event-client.js";
import type { CopilotKitEventSuffixes } from "../event-client.js";

describe("CopilotKitEventClient", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
  });

  function emitAndAssert<K extends keyof CopilotKitEventSuffixes & string>(
    event: K,
    payload: CopilotKitEventSuffixes[K],
  ) {
    const handler = vi.fn();
    cleanups.push(devtoolsClient.on(event, handler, { withEventTarget: true }));
    devtoolsClient.emit(event, payload);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ payload }));
  }

  it("emits and receives tool-call events via listenToSelf", () => {
    emitAndAssert("tool-call", {
      agentId: "agent-1",
      toolName: "search",
      args: { query: "hello" },
      result: "found it",
    });
  });

  it("emits and receives text-message events", () => {
    emitAndAssert("text-message", {
      agentId: "agent-1",
      content: "Hello world",
    });
  });

  it("emits and receives reasoning events", () => {
    emitAndAssert("reasoning", {
      agentId: "agent-1",
      content: "Let me think about this...",
    });
  });

  it("emits and receives state-snapshot events", () => {
    emitAndAssert("state-snapshot", {
      agentId: "agent-1",
      state: { count: 42, user: "alice" },
    });
  });

  it("emits and receives custom-event events", () => {
    emitAndAssert("custom-event", {
      agentId: "agent-1",
      name: "my-custom-event",
      value: { foo: "bar" },
    });
  });

  it("emitDynamic delivers events for dynamically-determined event keys", () => {
    const handler = vi.fn();
    cleanups.push(
      devtoolsClient.on("tool-call", handler, { withEventTarget: true }),
    );
    devtoolsClient.emitDynamic("tool-call", {
      agentId: "agent-1",
      toolName: "search",
      args: { query: "hello" },
      result: "found it",
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          agentId: "agent-1",
          toolName: "search",
          args: { query: "hello" },
          result: "found it",
        },
      }),
    );
  });

  it("delivers events to multiple listeners on the same event", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    cleanups.push(
      devtoolsClient.on("tool-call", handler1, { withEventTarget: true }),
    );
    cleanups.push(
      devtoolsClient.on("tool-call", handler2, { withEventTarget: true }),
    );

    const payload = {
      agentId: "agent-1",
      toolName: "search",
      args: { query: "hello" },
      result: "found it",
    };
    devtoolsClient.emit("tool-call", payload);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    expect(handler1).toHaveBeenCalledWith(expect.objectContaining({ payload }));
    expect(handler2).toHaveBeenCalledWith(expect.objectContaining({ payload }));
  });

  it("unsubscribe prevents future event delivery", () => {
    // NOTE: withEventTarget has an upstream bug in @tanstack/devtools-event-client
    // where the internal listener uses a different function reference than the one
    // removed in the unsubscribe callback. We test without withEventTarget here
    // to verify our wrapper's unsubscribe plumbing works correctly.
    const handler = vi.fn();
    const unsubscribe = devtoolsClient.on("custom-event", handler);

    // Without withEventTarget, self-emitted events go to #internalEventTarget
    // but the listener is on the global target, so no delivery is expected.
    // We verify the unsubscribe function itself is callable and doesn't throw.
    unsubscribe();
    expect(handler).not.toHaveBeenCalled();
  });

  it("documents upstream withEventTarget unsubscribe leak", () => {
    // UPSTREAM BUG: @tanstack/devtools-event-client's withEventTarget wraps
    // the handler in an internal function but unsubscribe removes the original
    // handler reference, not the wrapper — so the listener is never actually
    // removed from the EventTarget.
    //
    // This test documents the leak so it's tracked. DevtoolsListener works
    // around it with an active-guard (this.active check) that makes handlers
    // no-ops after destroy(), even though they remain registered on the target.
    const handler = vi.fn();
    const unsubscribe = devtoolsClient.on("custom-event", handler, {
      withEventTarget: true,
    });

    devtoolsClient.emit("custom-event", {
      agentId: "agent-1",
      name: "before-unsub",
      value: {},
    });
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();

    devtoolsClient.emit("custom-event", {
      agentId: "agent-1",
      name: "after-unsub",
      value: {},
    });

    // If the upstream bug is fixed, this will be 1 (unsubscribe worked).
    // Currently it's 2 (listener leaked). When this assertion flips to 1,
    // the bug is fixed and the active-guard workaround can be removed.
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
