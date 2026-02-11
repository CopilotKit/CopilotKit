import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createCopilotEndpointSingleRouteExpress } from "../express";
import { CopilotRuntime } from "../runtime";
import { InMemoryAgentRunner } from "../runner/in-memory";

const buildRuntime = () => {
  const fakeAgent = {
    clone: () => ({
      setMessages: () => undefined,
      setState: () => undefined,
      threadId: "thread",
      runAgent: async (
        input: { runId: string },
        { onEvent }: { onEvent: (payload: { event: unknown }) => void },
      ) => {
        onEvent({
          event: {
            type: "RUN_STARTED",
            runId: input.runId,
            input: { runId: input.runId },
          },
        });
        onEvent({ event: { type: "TEXT_MESSAGE_START", messageId: "m1" } });
        onEvent({
          event: {
            type: "TEXT_MESSAGE_CONTENT",
            messageId: "m1",
            delta: "hello",
          },
        });
        onEvent({ event: { type: "TEXT_MESSAGE_END", messageId: "m1" } });
        onEvent({ event: { type: "RUN_FINISHED", runId: input.runId } });
      },
    }),
  };

  return new CopilotRuntime({
    agents: { default: fakeAgent },
    runner: new InMemoryAgentRunner(),
  });
};

async function readStreamText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  for (let i = 0; i < 20; i += 1) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      output += decoder.decode(value, { stream: true });
      if (output.includes("RUN_FINISHED")) {
        break;
      }
    }
  }

  await reader.cancel();
  output += decoder.decode();
  return output;
}

describe("Express single-route SSE streaming", () => {
  let server: ReturnType<express.Express["listen"]> | undefined;

  afterEach(() => {
    if (server) {
      server.close();
      server = undefined;
    }
  });

  it("streams SSE events for single-route run requests", async () => {
    const runtime = buildRuntime();
    const app = express();
    app.use(
      createCopilotEndpointSingleRouteExpress({ runtime, basePath: "/" }),
    );

    server = app.listen(0);
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://localhost:${port}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        method: "agent/run",
        params: { agentId: "default" },
        body: {
          threadId: "thread",
          runId: "run-1",
          messages: [],
          state: {},
          tools: [],
          context: [],
          forwardedProps: {},
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).toBeTruthy();

    const payload = await readStreamText(response.body!);
    expect(payload).toContain("data:");
    expect(payload).toContain("RUN_STARTED");
    expect(payload).toContain("TEXT_MESSAGE_CONTENT");
    expect(payload).toContain("RUN_FINISHED");
  });
});
