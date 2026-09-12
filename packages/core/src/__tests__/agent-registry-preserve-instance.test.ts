import type {
  RuntimeEntitlementResponse,
  RuntimeInfo,
} from "@copilotkit/shared";
import { expect, test, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { CopilotKitCore } from "../core";
import { waitForCondition } from "./test-utils";

const encoder = new TextEncoder();

const retryableRuntimeEntitlements: RuntimeEntitlementResponse = {
  status: "unavailable",
  error: {
    code: "runtime_entitlements_unavailable",
    message: "Runtime entitlement lookup failed",
    retryable: true,
  },
};

const readyRuntimeEntitlements: RuntimeEntitlementResponse = {
  status: "ready",
  entitlement: {
    active: true,
    source: "managedOrgSubscription",
    features: {},
    limits: {},
  },
};

/** Build a Runtime `/info` response for the default agent. */
function runtimeInfo(
  version: string,
  runtimeEntitlements?: RuntimeEntitlementResponse,
): RuntimeInfo {
  return {
    version,
    agents: {
      default: {
        name: "default",
        className: "HttpAgent",
        description: "assistant",
      },
    },
    audioFileTranscriptionEnabled: false,
    mode: "sse",
    runtimeEntitlements,
  };
}

/** Encode one Runtime `/info` result as a JSON response. */
function runtimeInfoResponse(info: RuntimeInfo): Response {
  return new Response(JSON.stringify(info), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Return a complete AG-UI stream for one agent run. */
function runResponse(): Response {
  const stream = new ReadableStream({
    start(controller) {
      const events = [
        {
          type: "RUN_STARTED",
          threadId: "test-thread",
          runId: "test-run",
        },
        {
          type: "RUN_FINISHED",
          threadId: "test-thread",
          runId: "test-run",
        },
      ];
      controller.enqueue(
        encoder.encode(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
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

/** Create an isolated browser-like Core with ordered fetch responses. */
function setupCore(
  runtimeUrl: string,
  ...responses: [Response, ...Response[]]
) {
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);

  const core = new CopilotKitCore({
    runtimeUrl,
    runtimeTransport: "rest",
  });

  return {
    core,
    fetchMock,
    teardown: () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };
}

test("preserves a remote agent across a same-target same-transport refresh", async () => {
  vi.useFakeTimers();
  const runtimeUrl = "https://runtime.example";
  const { core, fetchMock, teardown } = setupCore(
    runtimeUrl,
    runtimeInfoResponse(runtimeInfo("1.0.0", retryableRuntimeEntitlements)),
    runtimeInfoResponse(runtimeInfo("2.0.0", readyRuntimeEntitlements)),
  );

  try {
    await vi.waitFor(() => {
      expect(core.getAgent("default")).toBeDefined();
    });
    const firstInstance = core.getAgent("default");
    if (!firstInstance) {
      throw new Error("Expected the Runtime to advertise the default agent");
    }
    firstInstance.setMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hello from run-1",
      },
    ]);
    firstInstance.threadId = "thread-run-1";

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(core.runtimeVersion).toBe("2.0.0");
    });
    const secondInstance = core.getAgent("default");

    expect(secondInstance).toBe(firstInstance);
    expect(secondInstance?.messages).toHaveLength(1);
    expect(secondInstance?.messages[0]?.id).toBe("assistant-1");
    expect(secondInstance?.threadId).toBe("thread-run-1");
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("routes a same-id agent to the new Runtime after the target changes", async () => {
  const runtimeUrlA = "https://a.example";
  const runtimeUrlB = "https://b.example";
  const { core, fetchMock, teardown } = setupCore(
    runtimeUrlA,
    runtimeInfoResponse(runtimeInfo("A")),
    runtimeInfoResponse(runtimeInfo("B")),
    runResponse(),
  );

  try {
    await waitForCondition(() => core.getAgent("default") !== undefined);
    const firstInstance = core.getAgent("default");

    core.setRuntimeUrl(runtimeUrlB);
    await waitForCondition(() => core.runtimeVersion === "B");
    const secondInstance = core.getAgent("default");
    if (!(secondInstance instanceof ProxiedCopilotRuntimeAgent)) {
      throw new Error("Expected a proxied Runtime agent");
    }

    await secondInstance.runAgent({});

    expect(secondInstance).not.toBe(firstInstance);
    expect(secondInstance.runtimeUrl).toBe(runtimeUrlB);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      `${runtimeUrlA}/info`,
      `${runtimeUrlB}/info`,
      `${runtimeUrlB}/agent/default/run`,
    ]);
  } finally {
    teardown();
  }
});

test("replaces a same-id agent when the Runtime transport changes", async () => {
  const runtimeUrl = "https://runtime.example";
  const { core, fetchMock, teardown } = setupCore(
    runtimeUrl,
    runtimeInfoResponse(runtimeInfo("rest")),
    runtimeInfoResponse(runtimeInfo("single")),
    runResponse(),
  );

  try {
    await waitForCondition(() => core.getAgent("default") !== undefined);
    const firstInstance = core.getAgent("default");

    core.setRuntimeTransport("single");
    await waitForCondition(() => core.runtimeVersion === "single");
    const secondInstance = core.getAgent("default");
    if (!(secondInstance instanceof ProxiedCopilotRuntimeAgent)) {
      throw new Error("Expected a proxied Runtime agent");
    }

    await secondInstance.runAgent({});
    const infoRequest = fetchMock.mock.calls[1]?.[1];
    const runRequest = fetchMock.mock.calls[2]?.[1];

    expect(secondInstance).not.toBe(firstInstance);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      `${runtimeUrl}/info`,
      runtimeUrl,
      runtimeUrl,
    ]);
    expect(JSON.parse(String(infoRequest?.body))).toEqual({ method: "info" });
    expect(JSON.parse(String(runRequest?.body))).toMatchObject({
      method: "agent/run",
      params: { agentId: "default" },
    });
  } finally {
    teardown();
  }
});
