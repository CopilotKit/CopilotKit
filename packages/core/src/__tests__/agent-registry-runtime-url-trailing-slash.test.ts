import type { RuntimeInfo } from "@copilotkit/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { CopilotKitCore } from "../core";

/** A Runtime `/info` answer advertising one agent. */
function runtimeInfoResponse(): Response {
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
  };
  return new Response(JSON.stringify(info), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function setupCore(runtimeUrl: string, runtimeTransport: "rest" | "single") {
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  fetchMock.mockResolvedValueOnce(runtimeInfoResponse());
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
