import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UnconfiguredIntegrationError,
  agentUrl,
  envName,
  forwardedHeaders,
  httpAgent,
  loadIntegration,
  loadIntegrationEnv,
  withForwardedHeaders,
} from "@/lib/agents";

// loadIntegration and loadIntegrationEnv read the real registry, which
// generate-registry.ts builds from the manifests. built-in-agent runs in
// process, so it has no src/integrations/built-in-agent/env.ts.

afterEach(() => {
  vi.unstubAllEnvs();
});

// The error that `run` throws.
function errorFrom(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected a throw.");
}

describe("envName", () => {
  it.each([
    ["AGENT_URL", "strands", "AGENT_URL_STRANDS"],
    ["AGENT_URL", "langgraph-python", "AGENT_URL_LANGGRAPH_PYTHON"],
    [
      "LANGGRAPH_DEPLOYMENT_URL",
      "langgraph-fastapi",
      "LANGGRAPH_DEPLOYMENT_URL_LANGGRAPH_FASTAPI",
    ],
  ])("names %s of %s %s", (name, slug, expected) => {
    expect(envName(name, slug)).toBe(expected);
  });
});

describe("agentUrl", () => {
  it("reads the integration's AGENT_URL variable when called", () => {
    vi.stubEnv("AGENT_URL_STRANDS", "http://strands:8000");

    expect(agentUrl("strands")).toBe("http://strands:8000");
  });

  it("reads a second address by its name", () => {
    vi.stubEnv("LANGGRAPH_DEPLOYMENT_URL_LANGGRAPH_FASTAPI", "http://lgf:8123");

    expect(agentUrl("langgraph-fastapi", "LANGGRAPH_DEPLOYMENT_URL")).toBe(
      "http://lgf:8123",
    );
  });

  it.each([
    ["not set", undefined],
    ["empty", ""],
  ])("throws an error naming the variable when it is %s", (_, value) => {
    vi.stubEnv("AGENT_URL_STRANDS", value);

    const error = errorFrom(() => agentUrl("strands"));

    expect(error).toBeInstanceOf(UnconfiguredIntegrationError);
    expect(error).toMatchObject({ variable: "AGENT_URL_STRANDS" });
  });
});

describe("httpAgent", () => {
  it.each([
    ["the root path by default", undefined, "http://strands:8000/"],
    [
      "the address followed by the path",
      "/interrupt/",
      "http://strands:8000/interrupt/",
    ],
  ])("posts to %s", (_, path, expected) => {
    vi.stubEnv("AGENT_URL_STRANDS", "http://strands:8000");

    expect(httpAgent("strands", path).url).toBe(expected);
  });
});

describe("loadIntegration", () => {
  it.each(["../strands", "Strands", "no-such-integration"])(
    "returns undefined for %s, which no manifest has",
    async (slug) => {
      await expect(loadIntegration(slug)).resolves.toBeUndefined();
      await expect(loadIntegrationEnv(slug)).resolves.toBeUndefined();
    },
  );
});

describe("loadIntegrationEnv", () => {
  it("returns no address variables for an integration that runs in process", async () => {
    await expect(loadIntegrationEnv("built-in-agent")).resolves.toEqual({});
  });
});

describe("forwardedHeaders", () => {
  const request = new Request("http://localhost/api/strands/agentic-chat", {
    headers: {
      "X-AIMock-Context": "strands",
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
  });

  it("returns the x-* headers of the request being handled", () => {
    const headers = withForwardedHeaders(request, () => forwardedHeaders());

    expect(headers).toEqual({ "x-aimock-context": "strands" });
  });

  it("keeps them for work that the request starts later", async () => {
    const headers = await withForwardedHeaders(request, async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return forwardedHeaders();
    });

    expect(headers).toEqual({ "x-aimock-context": "strands" });
  });

  it("is empty outside a request", () => {
    expect(forwardedHeaders()).toEqual({});
  });
});
