import type { RuntimeEntitlementResponse } from "@copilotkit/shared";
import { expect, test, vi } from "vitest";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "../../packages/core/src/core";
import type { CopilotIntelligenceRuntimeLike } from "../../packages/runtime/src/v2/runtime/core/runtime";
import { InMemoryAgentRunner } from "../../packages/runtime/src/v2/runtime/runner/in-memory";
import { resolveForwardHeadersPolicy } from "../../packages/runtime/src/v2/runtime/handlers/header-utils";
import { handleGetRuntimeInfo } from "../../packages/runtime/src/v2/runtime/handlers/get-runtime-info";
import { CopilotKitIntelligence } from "../../packages/runtime/src/v2/runtime/intelligence-platform/client";

const INACTIVE_ENTITLEMENTS_TRANSPORT = {
  organizationId: "org-private",
  active: false,
  source: "managedOrgSubscription",
  features: {},
  limits: {},
} as const;

const ACTIVE_ENTITLEMENTS_TRANSPORT = {
  organizationId: "org-private",
  active: true,
  source: "managedOrgSubscription",
  features: { threads: true },
  limits: {},
} as const;

/** Build the smallest real Intelligence Runtime accepted by the `/info` handler. */
function createRuntime(
  intelligence: CopilotKitIntelligence,
): CopilotIntelligenceRuntimeLike {
  return {
    agents: {},
    transcriptionService: undefined,
    beforeRequestMiddleware: undefined,
    afterRequestMiddleware: undefined,
    runner: new InMemoryAgentRunner(),
    a2ui: undefined,
    mcpApps: undefined,
    openGenerativeUI: undefined,
    mode: "intelligence",
    debug: { enabled: false, events: false, lifecycle: false, verbose: false },
    forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
    intelligence,
    identifyUser: vi.fn().mockResolvedValue({ id: "user-1", name: "User One" }),
    generateThreadNames: true,
    lockTtlSeconds: 20,
    lockHeartbeatIntervalSeconds: 15,
    channels: [],
  };
}

/** Read the URL from every valid Fetch API input shape. */
function readFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

test("recovers an expired inactive entitlement after a retryable refresh failure", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
  const intelligence = new CopilotKitIntelligence({
    apiKey: "test-api-key",
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://intelligence.example",
  });
  const runtime = createRuntime(intelligence);
  let infoCalls = 0;
  let upstreamCalls = 0;
  const fetchMock = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = readFetchUrl(input);
    if (url === "https://runtime.example/info") {
      infoCalls += 1;
      return handleGetRuntimeInfo({
        runtime,
        request: new Request(url, { headers: init?.headers }),
      });
    }
    if (url === "https://intelligence.example/api/entitlements/runtime") {
      upstreamCalls += 1;
      if (upstreamCalls === 1) {
        return Response.json(INACTIVE_ENTITLEMENTS_TRANSPORT);
      }
      if (upstreamCalls === 2) {
        throw new Error("temporary dependency failure");
      }
      return Response.json(ACTIVE_ENTITLEMENTS_TRANSPORT);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);

  try {
    await intelligence.getRuntimeEntitlements();
    await vi.advanceTimersByTimeAsync(5_000);

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      runtimeTransport: "rest",
    });
    await vi.waitFor(() => {
      expect(core.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
      expect(core.runtimeEntitlements).toEqual({
        status: "unavailable",
        error: {
          code: "runtime_entitlements_unavailable",
          message: "Runtime entitlement lookup failed",
          retryable: true,
        },
      } satisfies RuntimeEntitlementResponse);
    });

    expect(core.runtimeEntitlementRetryPending).toBe(true);
    expect(infoCalls).toBe(1);
    expect(upstreamCalls).toBe(2);

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(infoCalls).toBe(2);
      expect(core.runtimeEntitlements).toMatchObject({
        status: "ready",
        entitlement: { active: true },
      });
    });

    expect(core.runtimeEntitlementRetryPending).toBe(false);
    expect(upstreamCalls).toBe(3);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
