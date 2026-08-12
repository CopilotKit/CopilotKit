import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { waitForCondition } from "./test-utils";

/**
 * Regression: a second `updateRuntimeConnection` (triggered by an `/info`
 * re-settle or a config/transport change while the runtime URL is unchanged)
 * MUST preserve the already-registered runtime agent instance — its identity,
 * its accumulated `messages`, and its `threadId`.
 *
 * Before the fix, `updateRuntimeConnection` unconditionally rebuilt the
 * `remoteAgents` map with a fresh `ProxiedCopilotRuntimeAgent` for every id,
 * discarding the live instance. On the showcase auth demo (lazy `<CopilotKit>`
 * mount + `headers {}→{Authorization}` in one batch), this rebuild landed
 * after run-1 had rendered the assistant message, so the `use-agent` memo
 * re-handed `CopilotChat` a NEW empty instance → the assistant bubble
 * disappeared → `assistantMsgCount=0` → `dom-missing` flap (~21%).
 */
describe("CopilotKitCore runtime re-connection preserves agent instance", () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as unknown as { window?: unknown }).window;

  beforeEach(() => {
    vi.restoreAllMocks();
    (global as unknown as { window?: unknown }).window = {};
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as unknown as { fetch?: typeof fetch }).fetch;
    }
    if (originalWindow === undefined) {
      delete (global as unknown as { window?: unknown }).window;
    } else {
      (global as unknown as { window?: unknown }).window = originalWindow;
    }
  });

  it("reuses the existing remote agent instance and preserves its messages/threadId across re-connection", async () => {
    const runtimeUrl = "https://runtime.example";
    const info = {
      version: "1.0.0",
      agents: { default: { description: "assistant", capabilities: {} } },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(info),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // Initial connect (explicit REST transport → deterministic, no auto-detect).
    const core = new CopilotKitCore({ runtimeUrl, runtimeTransport: "rest" });
    await waitForCondition(() => core.getAgent("default") !== undefined);

    const firstInstance = core.getAgent("default")!;

    // Simulate run-1: the agent accumulates an assistant message + a threadId,
    // exactly as it would after the first conversation turn renders.
    const assistantMessage = {
      id: "assistant-1",
      role: "assistant" as const,
      content: "Hello from run-1",
    };
    firstInstance.setMessages([assistantMessage]);
    firstInstance.threadId = "thread-run-1";

    // Trigger a SECOND updateRuntimeConnection with the runtime URL unchanged —
    // the way an /info re-settle / config change re-runs it. Changing the
    // requested transport mode is the public-API path that re-runs the
    // connection without tearing down the runtime URL.
    core.setRuntimeTransport("single");
    await waitForCondition(() => fetchMock.mock.calls.length >= 2);
    // Let the rebuild settle.
    await new Promise((r) => setTimeout(r, 30));

    const secondInstance = core.getAgent("default")!;

    // Identity preserved — the SAME live instance, not a fresh empty one.
    expect(secondInstance).toBe(firstInstance);

    // Messages + threadId preserved.
    expect(secondInstance.messages).toHaveLength(1);
    expect(secondInstance.messages[0]?.id).toBe("assistant-1");
    expect(secondInstance.threadId).toBe("thread-run-1");
  });
});
