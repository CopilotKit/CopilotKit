import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.LANGGRAPH_DEPLOYMENT_URL;
});

describe("Cloudplot frontend health", () => {
  it("returns 503 when production access control is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.LANGGRAPH_DEPLOYMENT_URL = "https://agent.example.test";
    const fetchAgent = vi.fn(async () => Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchAgent);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      accessControl: "misconfigured",
    });
    expect(fetchAgent).not.toHaveBeenCalled();
  });

  it("returns 503 when no agent URL is configured", async () => {
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      agent: "unreachable",
    });
  });

  it("reports healthy only after the configured agent responds", async () => {
    process.env.LANGGRAPH_DEPLOYMENT_URL = "https://agent.example.test";
    const fetchAgent = vi.fn(async () =>
      Response.json({ status: "ok", service: "cloudplot-agent" }),
    );
    vi.stubGlobal("fetch", fetchAgent);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      service: "cloudplot-frontend",
      agent: "reachable",
    });
    expect(fetchAgent).toHaveBeenCalledWith(
      "https://agent.example.test/health",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    [
      "returns 503 when the agent rejects",
      vi.fn(async () => new Response(null, { status: 500 })),
    ],
    [
      "returns 503 when the probe fails",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    ],
  ])("%s", async (_label, fetchAgent) => {
    process.env.LANGGRAPH_DEPLOYMENT_URL = "https://agent.example.test/";
    vi.stubGlobal("fetch", fetchAgent);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      service: "cloudplot-frontend",
      agent: "unreachable",
    });
  });
});
