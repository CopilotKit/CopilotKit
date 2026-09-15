import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from "../core";
import { waitForCondition } from "./test-utils";

/**
 * A runtime can change its mode under a page that is already open: a redeploy
 * or an env-var change drops `CPK_INTELLIGENCE_API_KEY`, and `/info` starts
 * reporting `sse` where it reported `intelligence`. The proxy for each agent
 * survives that re-sync on purpose — it is backing an open conversation — so
 * the re-sync has to carry the new mode onto the instance it keeps.
 *
 * It did not. The reuse guard compares the runtime URL and the transport, and
 * the agent's own `/info` refresh returns early while it is in Intelligence
 * mode, so `intelligence` was a terminal state for a live proxy: every later
 * run took the delegate path and called `response.json()` on a
 * `text/event-stream` body. See #7130.
 */

const RUNTIME_URL = "https://runtime.example/api";
const INFO_URL = `${RUNTIME_URL}/info`;

const encoder = new TextEncoder();

type Handler = () => Promise<Response>;

/** Every route refuses, the way a runtime mid-redeploy does. */
const refuse: Handler = async () => {
  throw new TypeError("Failed to fetch");
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A well-formed SSE run — what a runtime in `sse` mode answers with. */
function sseResponse(): Response {
  const events = [
    { type: "RUN_STARTED", threadId: "test-thread", runId: "test-run" },
    {
      type: "RUN_FINISHED",
      threadId: "test-thread",
      runId: "test-run",
      result: { newMessages: [] },
    },
  ];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const INTELLIGENCE_INFO = {
  version: "1.0.0",
  agents: { default: { description: "assistant", capabilities: {} } },
  mode: "intelligence",
  intelligence: { wsUrl: "wss://realtime.example" },
};

const SSE_INFO = {
  version: "2.0.0",
  agents: { default: { description: "assistant", capabilities: {} } },
  mode: "sse",
};

/** `runtimeMode` is private; the behaviour it drives is what the test asserts. */
function peekRuntimeMode(agent: AbstractAgent): string {
  return (agent as unknown as { runtimeMode: string }).runtimeMode;
}

function peekIntelligence(
  agent: AbstractAgent,
): { wsUrl?: string } | undefined {
  return (agent as unknown as { intelligence?: { wsUrl?: string } })
    .intelligence;
}

/** The delegate is built for one mode, and only that mode. */
function peekDelegate(agent: AbstractAgent): unknown {
  return (agent as unknown as { delegate?: unknown }).delegate;
}

describe("runtime mode changes under an open page (#7130)", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  let infoHandler: Handler;
  let runHandler: Handler;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
    infoHandler = async () => jsonResponse(INTELLIGENCE_INFO);
    runHandler = async () => sseResponse();
    fetchMock = vi.fn(async (url: unknown) => {
      const target = String(url);
      if (target === INFO_URL) return infoHandler();
      if (target.startsWith(`${RUNTIME_URL}/agent/`)) return runHandler();
      throw new Error(`Unexpected fetch: ${target}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  /** The runtime goes away, then comes back reporting a different mode. */
  function redeployAs(info: unknown): void {
    infoHandler = async () => jsonResponse(info);
    runHandler = async () => sseResponse();
  }

  function takeRuntimeDown(): void {
    infoHandler = refuse;
    runHandler = refuse;
  }

  it("carries a new mode onto the proxy it preserves across a redeploy", async () => {
    const core = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
    });
    await waitForCondition(
      () =>
        core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    const agent = core.getAgent("default")!;
    expect(peekRuntimeMode(agent)).toBe("intelligence");

    // The redeploy: the runtime goes away, and the next run notices. That run
    // also builds the Intelligence delegate, which is what the re-sync then
    // has to clear — asserted below, so the teardown is not vacuous.
    takeRuntimeDown();
    await core.runAgent({ agent }).catch(() => {});
    await waitForCondition(
      () =>
        core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    expect(peekDelegate(agent)).toBeDefined();

    // It comes back with Intelligence disabled. Same URL, same transport.
    redeployAs(SSE_INFO);
    await core.runAgent({ agent }).catch(() => {});
    await waitForCondition(
      () =>
        core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // The conversation survives the re-sync — that is the whole point of
    // preserving the instance — and the core reads the new mode.
    expect(core.getAgent("default")).toBe(agent);
    expect(core.runtimeVersion).toBe("2.0.0");

    // The instance the user is still talking to must speak the new mode, and
    // the delegate built for the old one must be gone rather than left holding
    // a socket to a runtime that no longer answers on it.
    expect(peekRuntimeMode(agent)).toBe("sse");
    expect(peekIntelligence(agent)).toBeUndefined();
    expect(peekDelegate(agent)).toBeUndefined();

    // The consequence: a run now streams SSE instead of dying inside the
    // delegate's `response.json()`.
    await expect(core.runAgent({ agent })).resolves.toBeDefined();
  });
});
