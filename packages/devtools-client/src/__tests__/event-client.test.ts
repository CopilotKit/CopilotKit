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
});
