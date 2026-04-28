import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  CancellationTokenSource: class {
    token = { isCancellationRequested: false };
    cancel() {}
    dispose() {}
  },
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  },
  LanguageModelToolCallPart: class {
    constructor(
      public callId: string,
      public name: string,
      public input: unknown,
    ) {}
  },
  LanguageModelChatMessage: {
    User: (text: string) => ({ role: "user", content: text }),
    Assistant: (text: string) => ({ role: "assistant", content: text }),
  },
}));

import { startRuntimeHost } from "../runtime-host";
import type { LanguageModelChat } from "vscode";

afterEach(() => {
  // nothing global to reset
});

describe("e2e: vscode.lm runtime host serves AG-UI SSE events", () => {
  it("streams text from a fake vscode.lm model through the runtime", async () => {
    const { LanguageModelTextPart } = await import("vscode");
    const fakeModel = {
      id: "test-model",
      family: "test",
      name: "Test",
      vendor: "test",
      sendRequest: vi.fn(async () => ({
        stream: (async function* () {
          yield new LanguageModelTextPart("Hello");
          yield new LanguageModelTextPart(", world");
        })(),
        text: (async function* () {})(),
      })),
    } as unknown as LanguageModelChat;

    const handle = await startRuntimeHost({
      model: fakeModel,
      mode: "live",
      log: () => {},
    });

    try {
      // POST a minimal RunAgentInput to the SSE run endpoint.
      // Route: POST /api/copilotkit/agent/:agentId/run  (from fetch-router.ts matchSegments)
      const body = JSON.stringify({
        threadId: "t1",
        runId: "r1",
        state: {},
        messages: [{ id: "m1", role: "user", content: "hi" }],
        tools: [],
        context: [],
        forwardedProps: {},
      });
      const res = await fetch(
        `${handle.url}/api/copilotkit/agent/default/run`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body,
        },
      );
      expect(res.status).toBe(200);
      // Drain the SSE body.
      const text = await res.text();
      // The BuiltIn agent's TanStack converter emits TEXT_MESSAGE_CONTENT events
      // (wrapped in TEXT_MESSAGE_START / TEXT_MESSAGE_END lifecycle events).
      expect(text).toContain("TEXT_MESSAGE_CONTENT");
      expect(text).toContain("Hello");
      expect(text).toContain("world");
      expect(fakeModel.sendRequest).toHaveBeenCalled();
    } finally {
      await handle.stop();
    }
  }, 30_000);
});
