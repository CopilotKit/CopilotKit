/**
 * Unit tests for the runtime /api/ops proxy Route Handler.
 *
 * These lock in the behaviors the production overlay depends on:
 *   - OPS_BASE_URL is read at REQUEST time (per-call), not frozen — the
 *     whole reason this handler exists instead of a next.config rewrite.
 *   - The path mapping `/api/ops/<segments>` → `${OPS_BASE_URL}/api/<segments>`
 *     (single `/api`, never doubled/dropped) plus the original query string.
 *   - Upstream status + body are relayed through.
 *   - A missing OPS_BASE_URL yields a clear 503, not a throw/500.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const ORIGINAL_OPS_BASE_URL = process.env.OPS_BASE_URL;

let fetchSpy: ReturnType<typeof vi.fn>;

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

function ctx(path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) };
}

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (ORIGINAL_OPS_BASE_URL === undefined) {
    delete process.env.OPS_BASE_URL;
  } else {
    process.env.OPS_BASE_URL = ORIGINAL_OPS_BASE_URL;
  }
});

describe("/api/ops proxy Route Handler", () => {
  it("proxies GET /api/ops/probes → ${OPS_BASE_URL}/api/probes", async () => {
    process.env.OPS_BASE_URL = "https://harness.example.com";
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ probes: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await GET(
      makeRequest("http://dashboard.local/api/ops/probes"),
      ctx(["probes"]),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchSpy.mock.calls[0]![0]);
    expect(calledUrl).toBe("https://harness.example.com/api/probes");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ probes: [] });
  });

  it("forwards the query string and nested path segments", async () => {
    process.env.OPS_BASE_URL = "https://harness.example.com/";
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));

    await GET(
      makeRequest("http://dashboard.local/api/ops/probes/abc?limit=5"),
      ctx(["probes", "abc"]),
    );

    const calledUrl = String(fetchSpy.mock.calls[0]![0]);
    // Trailing slash on base normalized away; single /api; query preserved.
    expect(calledUrl).toBe(
      "https://harness.example.com/api/probes/abc?limit=5",
    );
  });

  it("reads OPS_BASE_URL at REQUEST time, not at module load", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));

    process.env.OPS_BASE_URL = "https://first.example.com";
    await GET(
      makeRequest("http://dashboard.local/api/ops/probes"),
      ctx(["probes"]),
    );
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      "https://first.example.com/api/probes",
    );

    // Change the env between requests — the second call must pick up the
    // new value, proving per-request resolution (no build/module freeze).
    process.env.OPS_BASE_URL = "https://second.example.com";
    await GET(
      makeRequest("http://dashboard.local/api/ops/probes"),
      ctx(["probes"]),
    );
    expect(String(fetchSpy.mock.calls[1]![0])).toBe(
      "https://second.example.com/api/probes",
    );
  });

  it("relays the upstream non-2xx status and body through", async () => {
    process.env.OPS_BASE_URL = "https://harness.example.com";
    fetchSpy.mockResolvedValue(
      new Response("boom", { status: 502, statusText: "Bad Gateway" }),
    );

    const res = await GET(
      makeRequest("http://dashboard.local/api/ops/probes"),
      ctx(["probes"]),
    );

    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toBe("boom");
  });

  it("forwards POST method + body to the harness", async () => {
    process.env.OPS_BASE_URL = "https://harness.example.com";
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ runId: "r1" }), { status: 200 }),
    );

    await POST(
      makeRequest("http://dashboard.local/api/ops/probes/smoke/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slugs: ["a"] }),
      }),
      ctx(["probes", "smoke", "trigger"]),
    );

    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
    expect(String(calledUrl)).toBe(
      "https://harness.example.com/api/probes/smoke/trigger",
    );
    expect((calledInit as RequestInit).method).toBe("POST");
    expect((calledInit as RequestInit).body).toBeDefined();
  });

  it("returns 503 (not a throw/500) when OPS_BASE_URL is unset", async () => {
    delete process.env.OPS_BASE_URL;

    const res = await GET(
      makeRequest("http://dashboard.local/api/ops/probes"),
      ctx(["probes"]),
    );

    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/OPS_BASE_URL/);
  });

  it("returns 502 when the upstream fetch rejects (harness unreachable)", async () => {
    process.env.OPS_BASE_URL = "https://harness.example.com";
    fetchSpy.mockRejectedValue(new Error("ENOTFOUND"));

    const res = await GET(
      makeRequest("http://dashboard.local/api/ops/probes"),
      ctx(["probes"]),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/ENOTFOUND/);
  });
});
