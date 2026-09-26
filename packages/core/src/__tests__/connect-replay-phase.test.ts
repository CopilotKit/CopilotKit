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

function connection(transport: "rest" | "single" = "rest") {
  let send: (event: BaseEvent | string) => void = streamNotInitialized;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      send = (event) =>
        controller.enqueue(
          encoder.encode(
            typeof event === "string"
              ? event
              : `data: ${JSON.stringify(event)}\n\n`,
          ),
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
    transport,
    agentId: "chat",
  });
  return { agent, send, cancelled };
}

const control = (name: string) => `event: ${name}\ndata: {}\n\n`;

describe.each(["rest", "single"] as const)(
  "%s connection replay phase",
  (transport) => {
    it("keeps historical errors busy, then finalizes a live error without waiting for SSE closure", async () => {
      const { agent, send } = connection(transport);
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
      const { agent, send } = connection(transport);
      const errors = vi.fn();
      agent.subscribe({ onRunErrorEvent: errors });
      const connecting = agent.connectAgent();
      try {
        send(control(CONNECTION_REPLAY_FINISHED));
        send(control(CONNECTION_REPLAY_STARTED));
        send({
          type: EventType.RUN_ERROR,
          message: "Replayed during reconnect",
        });
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
    it("keeps callbacks ordered when history, boundary and live error share one chunk", async () => {
      const { agent, send, cancelled } = connection(transport);
      const errors = vi.fn();
      agent.subscribe({ onRunErrorEvent: errors });
      const connecting = agent.connectAgent();
      send(
        `data: ${JSON.stringify({ type: EventType.RUN_ERROR, message: "Historical" })}\n\n` +
          control(CONNECTION_REPLAY_FINISHED) +
          `data: ${JSON.stringify({ type: EventType.RUN_ERROR, message: "Live" })}\n\n`,
      );
      await vi.waitFor(() => expect(agent.isRunning).toBe(false));
      await connecting;
      expect(errors).toHaveBeenCalledTimes(2);
      expect(cancelled).toHaveBeenCalledOnce();
    });

    it("preserves legacy behavior without hooks and releases on detach", async () => {
      const { agent, send, cancelled } = connection(transport);
      const errors = vi.fn();
      agent.subscribe({ onRunErrorEvent: errors });
      const connecting = agent.connectAgent();
      send({ type: EventType.RUN_ERROR, message: "Unknown phase" });
      await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
      expect(agent.isRunning).toBe(true);
      await agent.detachActiveRun();
      await connecting;
      expect(agent.isRunning).toBe(false);
      expect(cancelled).toHaveBeenCalledOnce();
    });
  },
);
