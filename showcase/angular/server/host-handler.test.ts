import { describe, expect, it, vi } from "vitest";

import { createHostHandler } from "./host-handler.js";
import type { HostConfig } from "./host-config.js";
import type { RuntimeIndex } from "./proxy-policy.js";

const runtimeIndex: RuntimeIndex = new Map([
  [
    "langgraph-python/agentic-chat",
    {
      cellId: "angular/langgraph-python/agentic-chat",
      runnable: true,
      runtimePrefix: "/api/copilotkit",
    },
  ],
]);

function config(status: HostConfig["backendConfigStatus"]): HostConfig {
  return {
    port: 3000,
    production: true,
    backendHostPattern:
      status === "valid" ? "showcase-{slug}.example.test" : undefined,
    backendConfigStatus: status,
    frameAncestors: ["'self'", "https://showcase.staging.copilotkit.ai"],
  };
}

describe("Angular Showcase host handler", () => {
  it("allows only configured shell framing and never emits conflicting X-Frame-Options", async () => {
    const handle = createHostHandler({
      config: config("valid"),
      runtimeIndex,
      proxy: vi.fn(),
      serveStatic: vi.fn(async () => new Response("app")),
    });

    const response = await handle(
      new Request("https://angular.example.test/langgraph-python/agentic-chat"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self' https://showcase.staging.copilotkit.ai",
    );
    expect(response.headers.get("x-frame-options")).toBeNull();
  });

  it("permits only the package-owned inline MCP sandbox proxy", async () => {
    const handle = createHostHandler({
      config: config("valid"),
      runtimeIndex,
      proxy: vi.fn(),
      serveStatic: vi.fn(async () => new Response("app")),
    });

    const response = await handle(
      new Request("https://angular.example.test/langgraph-python/mcp-apps"),
    );
    const policy = response.headers.get("content-security-policy") ?? "";
    const scriptPolicy = policy
      .split(";")
      .find((directive) => directive.trimStart().startsWith("script-src"));

    expect(scriptPolicy).toContain(
      "script-src 'self' 'sha256-s0MP3n8Vae8jFX/eWS1yBnmS7QDug5QsfobCIzFoAHE='",
    );
    expect(scriptPolicy).not.toContain("'unsafe-inline'");
  });

  it("fails closed before serving the SPA when backend configuration is missing", async () => {
    const serveStatic = vi.fn(async () => new Response("app"));
    const handle = createHostHandler({
      config: config("missing"),
      runtimeIndex,
      proxy: vi.fn(),
      serveStatic,
    });

    const response = await handle(
      new Request("https://angular.example.test/langgraph-python/agentic-chat"),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("not configured");
    expect(serveStatic).not.toHaveBeenCalled();
  });

  it("reports presence and status without exposing configuration values", async () => {
    const handle = createHostHandler({
      config: config("valid"),
      runtimeIndex,
      proxy: vi.fn(),
      serveStatic: vi.fn(),
      commitSha: "0123456789abcdef",
    });

    const response = await handle(
      new Request("https://angular.example.test/__diagnostics"),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({
      frontend: "angular",
      backendConfig: "valid",
      runnableCells: 1,
      frameAncestorCount: 2,
      commit: "0123456789ab",
    });
    expect(body).not.toContain("showcase-langgraph-python.example.test");
    expect(body).not.toContain("SHOWCASE_BACKEND_HOST_PATTERN");
  });

  it("never sends unknown cells to the SPA or proxy", async () => {
    const proxy = vi.fn();
    const serveStatic = vi.fn();
    const handle = createHostHandler({
      config: config("valid"),
      runtimeIndex,
      proxy,
      serveStatic,
    });

    const response = await handle(
      new Request("https://angular.example.test/unknown/agentic-chat"),
    );

    expect(response.status).toBe(404);
    expect(proxy).not.toHaveBeenCalled();
    expect(serveStatic).not.toHaveBeenCalled();
  });
});
