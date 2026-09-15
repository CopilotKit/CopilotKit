import type { RuntimeInfo } from "@copilotkit/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { CopilotKitCore } from "../core";

/** A Runtime `/info` answer advertising one agent. */
function runtimeInfoResponse(
  singleRoute?: RuntimeInfo["singleRoute"],
): Response {
  const info: RuntimeInfo = {
    version: "1.0.0",
    agents: {
      default: {
        name: "default",
        className: "HttpAgent",
        description: "assistant",
      },
    },
    audioFileTranscriptionEnabled: false,
    mode: "sse",
    ...(singleRoute ? { singleRoute } : {}),
  };
  return new Response(JSON.stringify(info), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A runtime that accepts Intelligence resource calls through the one route. */
const RESOURCE_SINGLE_ROUTE: RuntimeInfo["singleRoute"] = {
  resourceOperations: true,
  threadEndpoints: {
    list: true,
    inspect: true,
    mutations: true,
    realtimeMetadata: false,
  },
};

function setupCore(
  runtimeUrl: string,
  runtimeTransport: "rest" | "single",
  singleRoute?: RuntimeInfo["singleRoute"],
) {
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  fetchMock.mockResolvedValueOnce(runtimeInfoResponse(singleRoute));
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);
  const core = new CopilotKitCore({ runtimeUrl, runtimeTransport });
  return { core, fetchMock };
}

describe("runtimeUrl with a trailing slash", () => {
  const runtimeUrl = "https://runtime.example/service/copilotkit/";

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the caller's URL verbatim as the single-route endpoint", async () => {
    const { core, fetchMock } = setupCore(runtimeUrl, "single");

    await vi.waitFor(() => {
      expect(core.getAgent("default")).toBeDefined();
    });

    // The single-route identification request targets that same endpoint.
    expect(fetchMock.mock.calls[0]?.[0]).toBe(runtimeUrl);
    const agent = core.getAgent("default");
    expect(agent).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    expect((agent as ProxiedCopilotRuntimeAgent).url).toBe(runtimeUrl);
  });

  it("rebuilds the proxy when only the trailing slash changes", async () => {
    const { core, fetchMock } = setupCore(runtimeUrl, "single");
    await vi.waitFor(() => {
      expect(core.getAgent("default")).toBeDefined();
    });
    const before = core.getAgent("default") as ProxiedCopilotRuntimeAgent;

    fetchMock.mockResolvedValueOnce(runtimeInfoResponse());
    core.setRuntimeUrl("https://runtime.example/service/copilotkit");
    await vi.waitFor(() => {
      const agent = core.getAgent("default") as
        | ProxiedCopilotRuntimeAgent
        | undefined;
      expect(agent).toBeDefined();
      expect(agent).not.toBe(before);
    });

    const after = core.getAgent("default") as ProxiedCopilotRuntimeAgent;
    expect(after.url).toBe("https://runtime.example/service/copilotkit");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://runtime.example/service/copilotkit",
    );
  });

  // The resource envelope POSTs to the endpoint itself, so it is the second
  // request family that must not lose the slash - `createSingleRouteResourceRequest`
  // uses its `runtimeUrl` argument verbatim as the target.
  it("keeps the slash for Intelligence resource requests", async () => {
    const { core, fetchMock } = setupCore(
      runtimeUrl,
      "single",
      RESOURCE_SINGLE_ROUTE,
    );

    await vi.waitFor(() => {
      expect(core.getAgent("default")).toBeDefined();
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ threads: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await core.ɵruntimeFetch(`${runtimeUrl}threads`, { method: "GET" });

    const [target, init] = fetchMock.mock.calls[1] ?? [];
    // Asserted first: without it the case still passes when the envelope path
    // was never taken and the GET went out untouched.
    expect(init?.method).toBe("POST");
    expect(target).toBe(runtimeUrl);
  });

  it("joins REST paths without a double slash", async () => {
    const { core, fetchMock } = setupCore(runtimeUrl, "rest");

    await vi.waitFor(() => {
      expect(core.getAgent("default")).toBeDefined();
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://runtime.example/service/copilotkit/info",
    );
    const agent = core.getAgent("default") as ProxiedCopilotRuntimeAgent;
    expect(agent.url).toBe(
      "https://runtime.example/service/copilotkit/agent/default/run",
    );
  });
});
