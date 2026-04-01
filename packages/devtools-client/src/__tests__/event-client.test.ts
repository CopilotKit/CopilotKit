import { describe, it, expect, vi } from "vitest";
import { devtoolsClient } from "../event-client.js";

describe("CopilotKitEventClient", () => {
  it("emits and receives tool-call events via listenToSelf", () => {
    const handler = vi.fn();
    devtoolsClient.on("tool-call", handler, { withEventTarget: true });

    const payload = {
      agentId: "agent-1",
      toolName: "search",
      args: { query: "hello" },
      result: "found it",
    };

    devtoolsClient.emit("tool-call", payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ payload }),
    );
  });

  it("emits and receives text-message events", () => {
    const handler = vi.fn();
    devtoolsClient.on("text-message", handler, { withEventTarget: true });

    const payload = {
      agentId: "agent-1",
      content: "Hello world",
    };

    devtoolsClient.emit("text-message", payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ payload }),
    );
  });

  it("emits and receives reasoning events", () => {
    const handler = vi.fn();
    devtoolsClient.on("reasoning", handler, { withEventTarget: true });

    const payload = {
      agentId: "agent-1",
      content: "Let me think about this...",
    };

    devtoolsClient.emit("reasoning", payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ payload }),
    );
  });

  it("emits and receives state-snapshot events", () => {
    const handler = vi.fn();
    devtoolsClient.on("state-snapshot", handler, { withEventTarget: true });

    const payload = {
      agentId: "agent-1",
      state: { count: 42, user: "alice" },
    };

    devtoolsClient.emit("state-snapshot", payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ payload }),
    );
  });

  it("emits and receives custom-event events", () => {
    const handler = vi.fn();
    devtoolsClient.on("custom-event", handler, { withEventTarget: true });

    const payload = {
      agentId: "agent-1",
      name: "my-custom-event",
      value: { foo: "bar" },
    };

    devtoolsClient.emit("custom-event", payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ payload }),
    );
  });
});
