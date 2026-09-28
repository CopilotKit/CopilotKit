import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { ProxiedCopilotRuntimeAgent } from "../agent";

afterEach(() => vi.unstubAllGlobals());

describe.each(["rest", "single"] as const)(
  "%s HTTP connection completion",
  (transport) => {
    it("applies history after an old error and releases isRunning when the response closes", async () => {
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      const writer = stream.writable.getWriter();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(stream.readable, {
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
      const errors = vi.fn();
      agent.subscribe({ onRunErrorEvent: errors });
      const connecting = agent.connectAgent();
      const send = (event: BaseEvent) =>
        writer.write(
          new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      try {
        await send({
          type: EventType.RUN_ERROR,
          message: "Historical failure",
        });
        await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
        expect(agent.isRunning).toBe(true);
        await send({
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            { id: "later", role: "assistant", content: "Later history" },
          ],
        });
        await send({ type: EventType.RUN_ERROR, message: "Live failure" });
        await writer.close();
        await connecting;
        expect(agent.isRunning).toBe(false);
        expect(errors).toHaveBeenCalledTimes(2);
        expect(agent.messages[0]?.content).toBe("Later history");
        expect(
          new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).get(
            "accept",
          ),
        ).not.toContain("copilotkit-replay");
      } finally {
        await agent.detachActiveRun();
      }
    });
  },
);
