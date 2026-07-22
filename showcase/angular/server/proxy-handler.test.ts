import { describe, expect, it, vi } from "vitest";

import { createProxyHandler } from "./proxy-handler.js";
import { buildRuntimeIndex } from "./proxy-policy.js";

const index = buildRuntimeIndex(
  {
    integrations: [
      {
        slug: "langgraph-python",
        demos: [
          {
            id: "agentic-chat",
            route: "/demos/agentic-chat",
            runtime_path: "/api/copilotkit",
            highlight: ["src/app/api/copilotkit/route.ts"],
          },
        ],
      },
    ],
  },
  {
    cells: [
      {
        id: "angular/langgraph-python/agentic-chat",
        frontend: "angular",
        integration: "langgraph-python",
        feature: "agentic-chat",
        runnable: true,
      },
    ],
  },
);

function handler(fetchImpl: typeof fetch, log = vi.fn()) {
  return createProxyHandler({
    index,
    backendHostPattern: "showcase-{slug}.example.test",
    production: true,
    fetchImpl,
    log,
  });
}

describe("Angular Showcase proxy handler", () => {
  it("forwards only approved headers and returns cell correlation headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (target, init) => {
      expect(String(target)).toBe(
        "https://showcase-langgraph-python.example.test/api/copilotkit/agent/default/run",
      );
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer demo-token");
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("x-aimock-strict")).toBe("true");
      expect(headers.get("x-aimock-context")).toBe("langgraph-python");
      expect(headers.get("x-test-id")).toBe("fm-angular-cell-1");
      expect(headers.get("x-diag-run-id")).toBe("matrix-run-1");
      expect(headers.get("x-diag-hops")).toBe("frontend-matrix");
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("x-arbitrary")).toBeNull();
      expect(init?.redirect).toBe("manual");
      return new Response("event: done\n\n", {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "set-cookie": "provider-secret=never",
          "x-arbitrary": "hidden",
        },
      });
    });
    const log = vi.fn();
    const response = await handler(
      fetchImpl,
      log,
    )(
      new Request(
        "https://angular.example.test/api/copilotkit/langgraph-python/agentic-chat/agent/default/run",
        {
          method: "POST",
          headers: {
            authorization: "Bearer demo-token",
            "content-type": "application/json",
            cookie: "shell-session=secret",
            "x-arbitrary": "not-forwarded",
            "x-aimock-strict": "true",
            "x-aimock-context": "langgraph-python",
            "x-test-id": "fm-angular-cell-1",
            "x-diag-run-id": "matrix-run-1",
            "x-diag-hops": "frontend-matrix",
            "x-copilotkit-correlation-id": "corr_123",
          },
          body: JSON.stringify({ messages: [] }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-showcase-cell-id")).toBe(
      "angular/langgraph-python/agentic-chat",
    );
    expect(response.headers.get("x-copilotkit-correlation-id")).toBe(
      "corr_123",
    );
    expect(await response.text()).toBe("event: done\n\n");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "angular_proxy_complete",
        cellId: "angular/langgraph-python/agentic-chat",
        correlationId: "corr_123",
        status: 200,
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("demo-token");
  });

  it("drops upstream compression metadata after fetch decodes the body", async () => {
    const response = await handler(
      vi.fn<typeof fetch>(
        async () =>
          new Response("decoded upstream body", {
            status: 200,
            headers: {
              "content-encoding": "gzip",
              "content-length": "512",
              "content-language": "en",
              etag: '"representation-id"',
            },
          }),
      ),
    )(
      new Request(
        "https://angular.example.test/api/copilotkit/langgraph-python/agentic-chat/info",
      ),
    );

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("content-language")).toBe("en");
    expect(response.headers.get("etag")).toBe('"representation-id"');
    expect(await response.text()).toBe("decoded upstream body");
  });

  it("returns safe structured errors for malformed routes without calling fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await handler(fetchImpl)(
      new Request(
        "https://angular.example.test/api/copilotkit/langgraph-python/agentic-chat/unknown/path",
        { method: "POST", body: "secret prompt" },
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid-runtime-path" },
      cell: {
        frontend: "angular",
        integration: "langgraph-python",
        feature: "agentic-chat",
      },
      correlationId: expect.any(String),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses provider redirects instead of following them to a new origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.redirect("https://attacker.example/collect", 307),
    );
    const response = await handler(fetchImpl)(
      new Request(
        "https://angular.example.test/api/copilotkit/langgraph-python/agentic-chat/info",
      ),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "upstream-redirect-rejected" },
    });
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns fatal configuration without exposing a destination", async () => {
    const response = await createProxyHandler({
      index,
      backendHostPattern: undefined,
      production: true,
      fetchImpl: vi.fn<typeof fetch>(),
      log: vi.fn(),
    })(
      new Request(
        "https://angular.example.test/api/copilotkit/langgraph-python/agentic-chat/info",
      ),
    );

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("missing-backend-config");
    expect(body).not.toContain("SHOWCASE_BACKEND_HOST_PATTERN");
    expect(body).not.toContain("example.test");
  });
});
