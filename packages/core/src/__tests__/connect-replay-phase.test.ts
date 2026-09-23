import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import {
  CONNECTION_REPLAY_ACCEPT,
  CONNECTION_REPLAY_STARTED,
  CONNECTION_REPLAY_FINISHED,
} from "@copilotkit/shared";
import { ProxiedCopilotRuntimeAgent } from "../agent";

const encoder = new TextEncoder();
afterEach(() => vi.unstubAllGlobals());

function streamNotInitialized(): never {
  throw new Error("Stream not initialized");
}

function connection() {
  let send: (event: BaseEvent) => void = streamNotInitialized;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      send = (event) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
    },
    cancel: cancelled,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        }),
    ),
  );
  const agent = new ProxiedCopilotRuntimeAgent({
    runtimeUrl: "http://localhost/runtime",
    runtimeMode: "sse",
    transport: "rest",
    agentId: "chat",
  });
  return { agent, send, cancelled };
}

const control = (name: string) => ({
  type: EventType.CUSTOM,
  name,
  value: null,
});

describe("transport-independent connection replay phase", () => {
  it("keeps historical errors busy, then finalizes a live error without waiting for SSE closure", async () => {
    const { agent, send } = connection();
    const errors = vi.fn();
    const controls = vi.fn();
    agent.subscribe({ onRunErrorEvent: errors, onCustomEvent: controls });
    const connecting = agent.connectAgent();
    try {
      send({ type: EventType.RUN_ERROR, message: "Old failure" });
      await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
      expect(agent.isRunning).toBe(true);
      send({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          { id: "saved", role: "assistant", content: "Later history" },
        ],
      });
      send(control(CONNECTION_REPLAY_FINISHED));
      send({ type: EventType.RUN_ERROR, message: "Live failure" });
      await vi.waitFor(() => expect(agent.isRunning).toBe(false));
      await connecting;
      expect(errors).toHaveBeenCalledTimes(2);
      expect(agent.messages[0]?.content).toBe("Later history");
      expect(controls).not.toHaveBeenCalled();
      const request = vi.mocked(fetch).mock.calls[0]?.[1];
      expect(new Headers(request?.headers).get("accept")).toBe(
        CONNECTION_REPLAY_ACCEPT,
      );
    } finally {
      await agent.detachActiveRun();
      await connecting;
    }
  });

  it("resets to replay mode when the transport reconnects", async () => {
    const { agent, send } = connection();
    const errors = vi.fn();
    agent.subscribe({ onRunErrorEvent: errors });
    const connecting = agent.connectAgent();
    try {
      send(control(CONNECTION_REPLAY_FINISHED));
      send(control(CONNECTION_REPLAY_STARTED));
      send({ type: EventType.RUN_ERROR, message: "Replayed during reconnect" });
      await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
      expect(agent.isRunning).toBe(true);
      send(control(CONNECTION_REPLAY_FINISHED));
      send({ type: EventType.RUN_ERROR, message: "New live error" });
      await vi.waitFor(() => expect(agent.isRunning).toBe(false));
      await connecting;
      expect(errors).toHaveBeenCalledTimes(2);
    } finally {
      await agent.detachActiveRun();
      await connecting;
    }
  });
});
