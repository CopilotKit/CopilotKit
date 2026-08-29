import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  endpointFactory: vi.fn(),
  handleRequest: vi.fn(async () => Response.json({ handled: true })),
}));

vi.mock("@copilotkit/runtime", () => ({
  CopilotRuntime: vi.fn(),
  ExperimentalEmptyAdapter: vi.fn(),
  copilotRuntimeNextJSAppRouterEndpoint: mocks.endpointFactory,
}));
vi.mock("@copilotkit/runtime/langgraph", () => ({
  LangGraphHttpAgent: vi.fn(),
}));

describe("CloudPlot metered runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LANGGRAPH_DEPLOYMENT_URL", "https://agent.example.test");
    vi.stubEnv("CLOUDPLOT_ACCESS_CODE", "correct horse");
    vi.stubEnv("CLOUDPLOT_SESSION_SECRET", "session-secret-for-tests");
    mocks.endpointFactory.mockReturnValue({
      handleRequest: mocks.handleRequest,
    });
  });

  it("does not construct the runtime endpoint for an unauthenticated request", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://cloudplot.test/api/copilotkit", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.endpointFactory).not.toHaveBeenCalled();
    expect(mocks.handleRequest).not.toHaveBeenCalled();
  });

  it("passes a signed session to the runtime handler", async () => {
    const { createSessionValue, getRuntimeSecurityConfiguration } =
      await import("../../../lib/runtimeSecurity");
    const configuration = getRuntimeSecurityConfiguration();
    if (configuration.mode !== "protected") throw new Error("bad fixture");
    const session = createSessionValue(configuration);
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://cloudplot.test/api/copilotkit", {
        method: "POST",
        headers: { cookie: `cloudplot_session=${session}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.handleRequest).toHaveBeenCalledOnce();
  });

  it("rate limits authenticated requests before invoking the runtime", async () => {
    const { createSessionValue, getRuntimeSecurityConfiguration } =
      await import("../../../lib/runtimeSecurity");
    const configuration = getRuntimeSecurityConfiguration();
    if (configuration.mode !== "protected") throw new Error("bad fixture");
    const session = createSessionValue(configuration);
    const { POST } = await import("./route");
    const request = () =>
      new NextRequest("https://cloudplot.test/api/copilotkit", {
        method: "POST",
        headers: { cookie: `cloudplot_session=${session}` },
      });

    for (let index = 0; index < 20; index += 1) {
      expect((await POST(request())).status).toBe(200);
    }
    const rejected = await POST(request());

    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("Retry-After")).not.toBeNull();
    expect(mocks.handleRequest).toHaveBeenCalledTimes(20);
  });
});
