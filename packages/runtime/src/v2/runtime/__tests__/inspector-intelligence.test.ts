import { expect, test, vi } from "vitest";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import type { IntelligenceAccessCallback } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { handleInspectorIntelligence } from "../handlers/handle-inspector-intelligence";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";

/** Creates a real runtime; the only fake is the outgoing platform HTTP response. */
function setup(access?: IntelligenceAccessCallback) {
  const intelligence = new CopilotKitIntelligence({
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://intelligence.example",
    apiKey: "test-server-only",
  });
  const runtime = new CopilotIntelligenceRuntime({
    agents: {},
    intelligence,
    identifyUser: async () => ({ id: "reviewer-1", name: "Reviewer" }),
    access,
  });
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ data: [] }));
  const call = (body: unknown, headers: Record<string, string> = {}) =>
    handleInspectorIntelligence({
      runtime,
      request: new Request("https://customer.example/inspector-intelligence", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    });
  return { runtime, call, fetch, cleanup: () => fetch.mockRestore() };
}

test("discovers server-granted permissions without exposing a platform credential", async () => {
  const grant = {
    permissions: { "analytics.numbers": { agents: ["support"] } },
  } as const;
  const { call, fetch, cleanup } = setup(async () => grant);
  try {
    const response = await call({ method: "GET", path: "/context" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 1,
      grant,
      agents: [],
      askAvailable: false,
    });
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test("resolves identity and grants server-side on each product read", async () => {
  const policy = vi.fn<IntelligenceAccessCallback>().mockResolvedValue({
    permissions: { "analytics.numbers": { agents: ["support"] } },
  });
  const { call, fetch, cleanup } = setup(policy);
  try {
    const response = await call(
      { method: "GET", path: "/api/v1/runs", query: { agentId: "support" } },
      { "x-cpki-user-id": "forged", "x-cpki-grant": "forged" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://intelligence.example/api/v1/runs?agentId=support"),
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: "Bearer test-server-only",
          "x-cpki-user-id": "reviewer-1",
          "x-cpki-grant": JSON.stringify({
            permissions: { "analytics.numbers": { agents: ["support"] } },
          }),
        }),
      }),
    );
    await call({ method: "GET", path: "/context" });
    expect(policy).toHaveBeenCalledTimes(2);
  } finally {
    cleanup();
  }
});

test("hides context without a grant and never trusts a browser grant", async () => {
  const { call, fetch, cleanup } = setup();
  try {
    const response = await call(
      { method: "GET", path: "/context" },
      {
        "x-cpki-grant": '{"permissions":{"governance.record":{"agents":"*"}}}',
      },
    );

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test("rejects write requests before contacting Intelligence", async () => {
  const { call, fetch, cleanup } = setup(async () => ({ permissions: {} }));
  try {
    const response = await call({
      method: "DELETE",
      path: "/api/v1/conversations/thread-1",
    });

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test("preserves revoked access but does not reflect upstream error text", async () => {
  const { call, fetch, cleanup } = setup(async () => ({ permissions: {} }));
  try {
    fetch.mockResolvedValue(
      Response.json({ error: "private database details" }, { status: 403 }),
    );
    const response = await call({ method: "GET", path: "/api/v1/runs" });

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private database details");
  } finally {
    cleanup();
  }
});

test("preserves a deleted conversation status without forwarding its private error payload", async () => {
  const { call, fetch, cleanup } = setup(async () => ({
    permissions: { "conversations.text": { agents: "*" } },
  }));
  try {
    fetch.mockResolvedValue(
      Response.json({ error: "private deletion details" }, { status: 410 }),
    );
    const response = await call({
      method: "GET",
      path: "/api/v1/conversations/thread-1/replay",
    });
    expect(response.status).toBe(410);
    expect(await response.text()).not.toContain("private deletion details");
  } finally {
    cleanup();
  }
});

test("mounts the same authenticated read in multi-route and single-route runtimes", async () => {
  const { runtime, fetch, cleanup } = setup(async () => ({
    permissions: { "analytics.numbers": { agents: "*" } },
  }));
  try {
    const read = { method: "GET", path: "/api/v1/runs" };
    for (const mode of ["multi-route", "single-route"] as const) {
      fetch.mockResolvedValue(Response.json({ data: ["run-1"] }));
      const handler = createCopilotRuntimeHandler({
        runtime,
        mode,
        basePath: "/api/copilotkit",
      });
      const response = await handler(
        new Request(
          `https://customer.example/api/copilotkit${mode === "multi-route" ? "/inspector-intelligence" : ""}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              mode === "multi-route"
                ? read
                : { method: "inspector/intelligence", body: read },
            ),
          },
        ),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: ["run-1"] });
    }
  } finally {
    cleanup();
  }
});

test("rejects an oversized request before it reaches Intelligence", async () => {
  const { call, fetch, cleanup } = setup(async () => ({
    permissions: { "analytics.numbers": { agents: "*" } },
  }));
  try {
    const response = await call({
      method: "POST",
      path: "/api/v1/metrics/query",
      body: { metric: "x".repeat(70_000) },
    });

    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test("bounds platform response bodies before sending data to the iframe", async () => {
  const { call, fetch, cleanup } = setup(async () => ({
    permissions: { "analytics.numbers": { agents: "*" } },
  }));
  try {
    fetch.mockResolvedValue(Response.json({ data: "x".repeat(5_300_000) }));
    const response = await call({ method: "GET", path: "/api/v1/runs" });

    expect(response.status).toBe(503);
  } finally {
    cleanup();
  }
});

test("creates exports and downloads CSV through fresh server grants without forwarding upstream cookies", async () => {
  const policy = vi
    .fn<IntelligenceAccessCallback>()
    .mockResolvedValue({
      permissions: { "analytics.numbers": { agents: "*" } },
    });
  const world = setup(policy);
  try {
    world.fetch.mockResolvedValueOnce(
      Response.json(
        { id: "10000000-0000-4000-8000-000000000001", status: "queued" },
        { status: 202 },
      ),
    );
    const created = await world.call({
      method: "POST",
      path: "/api/v1/exports",
      body: {
        kind: "runs",
        format: "csv",
        from: "2026-09-20T00:00:00.000Z",
        to: "2026-09-27T00:00:00.000Z",
      },
    });
    expect(created.status).toBe(200);
    world.fetch.mockResolvedValueOnce(
      new Response("runId,tokens\r\nrun-1,20\r\n", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "X-Export-Metadata": '{"rowCount":1}',
          "Set-Cookie": "private=never-forward",
        },
      }),
    );
    const download = await world.call({
      method: "GET",
      path: "/api/v1/exports/10000000-0000-4000-8000-000000000001/content",
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("text/csv");
    expect(download.headers.get("x-export-metadata")).toBe('{"rowCount":1}');
    expect(download.headers.get("set-cookie")).toBeNull();
    expect(await download.text()).toBe("runId,tokens\r\nrun-1,20\r\n");
    expect(policy).toHaveBeenCalledTimes(2);
    world.fetch.mockResolvedValueOnce(
      Response.json({ error: "private revoked grant" }, { status: 403 }),
    );
    const denied = await world.call({
      method: "GET",
      path: "/api/v1/exports/10000000-0000-4000-8000-000000000001/content",
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("private revoked grant");
  } finally {
    world.cleanup();
  }
});

test("preserves binary exports through both runtime endpoint modes", async () => {
  const world = setup(async () => ({
    permissions: { "analytics.numbers": { agents: "*" } },
  }));
  try {
    for (const mode of ["multi-route", "single-route"] as const) {
      world.fetch.mockImplementation(async (input) =>
        String(input).endsWith("/content")
          ? new Response("name,tokens\r\n東京,12\r\n", {
              headers: { "Content-Type": "text/csv" },
            })
          : Response.json({}),
      );
      const handler = createCopilotRuntimeHandler({
        runtime: world.runtime,
        mode,
        basePath: "/api/copilotkit",
      });
      const read = {
        method: "GET",
        path: "/api/v1/exports/10000000-0000-4000-8000-000000000001/content",
      };
      const response = await handler(
        new Request(
          `https://customer.example/api/copilotkit${mode === "multi-route" ? "/inspector-intelligence" : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              mode === "multi-route"
                ? read
                : { method: "inspector/intelligence", body: read },
            ),
          },
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type"), mode).toBe("text/csv");
      expect(await response.text()).toBe("name,tokens\r\n東京,12\r\n");
    }
  } finally {
    world.cleanup();
  }
});
