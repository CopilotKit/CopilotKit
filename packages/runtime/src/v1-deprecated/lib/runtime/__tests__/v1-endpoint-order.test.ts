import { describe, it, expect } from "vitest";
import { CopilotRuntime } from "../copilot-runtime";
import { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";
import { LangChainAdapter } from "../../../service-adapters/langchain/langchain-adapter";
import { createCopilotEndpointSingleRoute } from "../../../../v2/runtime/endpoints/hono-single";

/**
 * Every v1 endpoint (App Router, Pages Router, Node HTTP, Express, Nest)
 * captures `oss.runtime.instance_created` BEFORE it calls
 * `handleServiceAdapter`. Reading `runtime.instance` there built the v2
 * runtime with the configured agents, so the per-request factory that
 * `handleServiceAdapter` installs afterwards (#7157) was never used, and no
 * v1 `actions` or `mcpServers` tool reached any agent.
 */
describe("v1 endpoint order: telemetry, then handleServiceAdapter", () => {
  const actions = [
    {
      name: "getImageUrl",
      description: "Get an image url for a topic",
      parameters: [{ name: "topic", type: "string" as const }],
      handler: async () => "https://example.com/image.png",
    },
  ];

  it("telemetry does not build the runtime instance", () => {
    const runtime = new CopilotRuntime({ actions });

    const info = getRuntimeInstanceTelemetryInfo({ runtime } as never);

    expect(info.actionsAmount).toBe(1);
    expect(Reflect.get(runtime, "_instance")).toBeUndefined();
  });

  it("still delivers v1 actions to the agent", async () => {
    const runtime = new CopilotRuntime({ actions });
    let seen: string[] | undefined;

    // The order every v1 endpoint uses.
    getRuntimeInstanceTelemetryInfo({ runtime } as never);
    runtime.handleServiceAdapter(
      new LangChainAdapter({
        chainFn: async ({ tools }) => {
          seen = tools.map((tool) => tool.name);
          return "ok";
        },
      }),
    );
    const app = createCopilotEndpointSingleRoute({
      runtime: runtime.instance,
      basePath: "/api/copilotkit",
    });

    const response = await app.fetch(
      new Request("https://app.example.com/api/copilotkit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "agent/run",
          params: { agentId: "default" },
          body: {
            threadId: "t1",
            runId: "r1",
            messages: [{ id: "u1", role: "user", content: "hi" }],
            tools: [],
            context: [],
            state: {},
            forwardedProps: {},
          },
        }),
      }),
    );
    await response.text();

    expect(seen).toEqual(["getImageUrl"]);
  });
});
