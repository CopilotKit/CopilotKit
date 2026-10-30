import { HttpAgent } from "@ag-ui/client";
import type * as MCPAppsMiddlewareModule from "@ag-ui/mcp-apps-middleware";
import { afterEach, expect, test, vi } from "vitest";
import { CopilotRuntime, CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import {
  cloneAgentForRequest,
  configureAgentForRequest,
} from "../handlers/shared/agent-utils";
import { enableNativeHistoryForRequest } from "../handlers/shared/native-history-policy";

const constructed = vi.hoisted(() => vi.fn());
vi.mock("@ag-ui/mcp-apps-middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof MCPAppsMiddlewareModule>();
  class TrackedMiddleware extends actual.MCPAppsMiddleware {
    constructor(
      ...args: ConstructorParameters<typeof actual.MCPAppsMiddleware>
    ) {
      constructed(...args);
      super(...args);
    }
  }
  return { ...actual, MCPAppsMiddleware: TrackedMiddleware };
});
afterEach(() => constructed.mockClear());

test.each([false, true])(
  "MCP policy is late-bound to the admitted request clone (intelligence=%s)",
  async (intelligence) => {
    const registered = new HttpAgent({ url: "https://agent.example/run" });
    const config = {
      agents: { test: registered },
      mcpApps: {
        servers: [{ type: "http" as const, url: "https://mcp.example/mcp" }],
      },
    };
    const runtime = intelligence
      ? new CopilotIntelligenceRuntime({
          ...config,
          intelligence: new CopilotKitIntelligence({ apiKey: "fixture-key" }),
          identifyUser: () => ({ id: "user", name: "User" }),
          generateThreadNames: false,
        })
      : new CopilotRuntime(config);
    const first = await cloneAgentForRequest(runtime, "test");
    const second = await cloneAgentForRequest(runtime, "test");
    if (first instanceof Response || second instanceof Response)
      throw new Error("Missing fixture agent");
    const request = new Request("https://runtime.example/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-input-policy": "native-history-delta-v1",
        "x-continuation-input": "tool-results",
      },
      body: JSON.stringify({
        inputPolicy: "native-history-delta-v1",
        continuationInput: "tool-results",
        forwardedProps: {
          inputPolicy: "native-history-delta-v1",
          continuationInput: "tool-results",
        },
      }),
    });
    for (const agent of [registered, first, second]) {
      configureAgentForRequest({ runtime, request, agentId: "test", agent });
    }
    const [registrationOptions, firstOptions, secondOptions] =
      constructed.mock.calls.map(([options]) => options);
    expect(firstOptions).toMatchObject({
      continuationInput: "full-history",
      ...(intelligence ? { discoveryFailureMode: "throw" } : {}),
    });
    expect(
      Object.getOwnPropertyDescriptor(firstOptions, "continuationInput")?.get,
    ).toBeTypeOf("function");
    // The same options object supplied before admission changes only for this clone.
    enableNativeHistoryForRequest(first);
    expect(firstOptions.continuationInput).toBe("tool-results");
    expect(secondOptions.continuationInput).toBe("full-history");
    expect(registrationOptions.continuationInput).toBe("full-history");
  },
);
