import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelChat } from "vscode";

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

const fakeModel = {
  id: "test-model",
  family: "test",
  name: "Test",
  vendor: "test",
  sendRequest: vi.fn(async () => ({
    stream: (async function* () {})(),
    text: (async function* () {})(),
  })),
} as unknown as LanguageModelChat;

afterEach(() => {
  (fakeModel.sendRequest as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe("startRuntimeHost", () => {
  it("listens on a random localhost port and serves the runtime URL", async () => {
    const handle = await startRuntimeHost({
      model: fakeModel,
      mode: "live",
      log: () => {},
    });
    try {
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      // Smoke: the SSE endpoint is reachable (404 vs ECONNREFUSED differentiates).
      const res = await fetch(`${handle.url}/api/copilotkit`, {
        method: "GET",
      });
      // CopilotSseRuntime returns 405 for GET on the SSE endpoint without a body —
      // any HTTP response (not a connection error) confirms the listener is up.
      expect(res.status).toBeGreaterThan(0);
    } finally {
      await handle.stop();
    }
  }, 20_000);

  it("releases the port after stop()", async () => {
    const handle = await startRuntimeHost({
      model: fakeModel,
      mode: "live",
      log: () => {},
    });
    const url = handle.url;
    await handle.stop();
    await expect(fetch(`${url}/api/copilotkit`)).rejects.toThrow();
  }, 20_000);
});
