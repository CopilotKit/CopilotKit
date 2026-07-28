/**
 * Integration tests proving the license token (the Intelligence/EIP key that
 * carries telemetry_id) rides all the way to the telemetry sink through every
 * endpoint adapter and BOTH runtime modes — not just SSE-via-Express (covered
 * in sse-license-telemetry.integration.test.ts).
 *
 * Each test constructs a *real* runtime (so the constructor's setLicenseToken
 * runs), drives a real request through the adapter, and asserts the token
 * reaches `lambdaClient.send` on `oss.runtime.copilot_request_created` — which
 * handle-run emits for both SSE and Intelligence modes.
 *
 * Own file so the singleton mutation from the real setLicenseToken stays
 * contained by Vitest's per-file module isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { Observable, of } from "rxjs";
import { lambdaClient } from "@copilotkit/shared";

import { createCopilotHonoHandler } from "../endpoints/hono";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotRuntime, CopilotIntelligenceRuntime } from "../core/runtime";
import type { AgentRunner } from "../runner/agent-runner";
import type { CopilotKitIntelligence } from "../intelligence-platform";
import { IntelligenceAgentRunner } from "../runner/intelligence";

// Real JWT shape with telemetry_id → identified caller → bypasses the sample
// gate, so the send is deterministic without mocking Math.random.
const TOKEN = `header.${Buffer.from('{"telemetry_id":"abc-123"}').toString(
  "base64url",
)}.sig`;

function makeSseAgent(): AbstractAgent {
  const a: unknown = { execute: async () => ({ events: [] }) };
  (a as { clone: () => unknown }).clone = () => makeSseAgent();
  return a as AbstractAgent;
}

function makeSseRunner() {
  return {
    run: () =>
      new Observable((observer) => {
        observer.next({});
        observer.complete();
        return () => undefined;
      }),
    connect: () => of({}),
    stop: async () => true,
    isRunning: async () => false,
  } as unknown as AgentRunner;
}

function runRequest(): Request {
  return new Request("http://localhost/agent/default/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [], state: {}, threadId: "t1" }),
  });
}

describe("license token → telemetry sink across endpoints/modes (integration)", () => {
  let lambdaSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lambdaSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  });

  afterEach(() => {
    lambdaSpy.mockRestore();
  });

  it("SSE via the Hono adapter forwards the token to the sink", async () => {
    const runtime = new CopilotRuntime({
      agents: { default: makeSseAgent() },
      runner: makeSseRunner(),
      licenseToken: TOKEN,
    });
    const endpoint = createCopilotHonoHandler({ runtime, basePath: "/" });

    await endpoint.fetch(runRequest());

    await vi.waitFor(() => {
      expect(lambdaSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "oss.runtime.copilot_request_created",
          licenseToken: TOKEN,
        }),
      );
    });
  });

  it("SSE via the framework-agnostic fetch handler (node/custom adapters) forwards the token", async () => {
    // node + any custom adapter wrap this exact handler, so covering it covers
    // them without standing up an HTTP server.
    const runtime = new CopilotRuntime({
      agents: { default: makeSseAgent() },
      runner: makeSseRunner(),
      licenseToken: TOKEN,
    });
    const handler = createCopilotRuntimeHandler({ runtime, basePath: "/" });

    await handler(runRequest());

    await vi.waitFor(() => {
      expect(lambdaSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "oss.runtime.copilot_request_created",
          licenseToken: TOKEN,
        }),
      );
    });
  });

  it("Intelligence mode forwards the token to the sink end-to-end", async () => {
    // A real CopilotIntelligenceRuntime so the constructor's (now base-class)
    // setLicenseToken runs. Its real IntelligenceAgentRunner would open a
    // WebSocket, so we swap in a stub runner whose observable completes
    // immediately — the request still flows through the real intelligence run
    // handler, which is what we want to exercise.
    const platform = {
      ɵgetRunnerWsUrl: vi.fn().mockReturnValue("ws://runner.example"),
      ɵgetRunnerAuthToken: vi.fn().mockReturnValue("token-123"),
      ɵgetClientWsUrl: vi.fn().mockReturnValue("wss://client.example"),
      getOrCreateThread: vi.fn().mockResolvedValue({
        thread: { id: "thread-1", name: null },
        created: false,
      }),
      getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
      ɵacquireThreadLock: vi.fn().mockResolvedValue({
        threadId: "thread-1",
        runId: "run-1",
        joinToken: "jt-1",
      }),
      ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      ɵrenewThreadLock: vi.fn().mockResolvedValue(undefined),
    } as unknown as CopilotKitIntelligence;

    const makeIntelligenceAgent = (): AbstractAgent =>
      ({
        clone: vi.fn(() => makeIntelligenceAgent()),
        setMessages: vi.fn(),
        setState: vi.fn(),
        threadId: undefined,
        headers: {},
        runAgent: vi.fn().mockResolvedValue(undefined),
      }) as unknown as AbstractAgent;

    const runtime = new CopilotIntelligenceRuntime({
      agents: { "my-agent": makeIntelligenceAgent() },
      intelligence: platform,
      identifyUser: vi
        .fn()
        .mockResolvedValue({ id: "user-1", name: "User One" }),
      licenseToken: TOKEN,
    });

    // Swap the real WS runner for a stub whose stream completes immediately.
    const stubRunner = Object.create(IntelligenceAgentRunner.prototype);
    stubRunner.run = vi.fn(
      () => new Observable<BaseEvent>((subscriber) => subscriber.complete()),
    );
    runtime.runner = stubRunner;

    const handler = createCopilotRuntimeHandler({ runtime, basePath: "/" });

    await handler(
      new Request("http://localhost/agent/my-agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "thread-1",
          runId: "run-1",
          state: {},
          messages: [],
          tools: [],
          context: [],
          forwardedProps: {},
        }),
      }),
    );

    await vi.waitFor(() => {
      expect(lambdaSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "oss.runtime.copilot_request_created",
          licenseToken: TOKEN,
        }),
      );
    });
  });
});
