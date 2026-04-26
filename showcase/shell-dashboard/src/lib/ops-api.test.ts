/**
 * Tests for the showcase-ops fetch client.
 *
 * Mocks `globalThis.fetch` and asserts the on-the-wire contract that B3
 * (the showcase-ops HTTP API) is being built to satisfy:
 *   - GET  <base>/probes                  → ProbesResponse
 *   - GET  <base>/probes/<id>             → { probe, runs }
 *   - POST <base>/probes/<id>/trigger     → TriggerResponse
 *
 * `baseUrl` resolution order is: explicit param → NEXT_PUBLIC_OPS_BASE_URL
 * → fallback `/api/ops` (proxy). The trigger token is supplied per-call;
 * the client just attaches it as a Bearer header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  fetchProbes,
  fetchProbeDetail,
  triggerProbe,
  type ProbesResponse,
  type TriggerResponse,
  type ProbeScheduleEntry,
  type ProbeRun,
} from "./ops-api";

type FetchInit = Parameters<typeof fetch>[1];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function emptyProbesResponse(): ProbesResponse {
  return { probes: [] };
}

function sampleEntry(): ProbeScheduleEntry {
  return {
    id: "smoke",
    kind: "smoke",
    schedule: "*/5 * * * *",
    nextRunAt: "2026-04-25T12:00:00Z",
    lastRun: {
      startedAt: "2026-04-25T11:55:00Z",
      finishedAt: "2026-04-25T11:55:30Z",
      durationMs: 30_000,
      state: "completed",
      summary: { total: 17, passed: 17, failed: 0 },
    },
    inflight: null,
    config: { timeout_ms: 60_000, max_concurrency: 5, discovery: null },
  };
}

function sampleRun(): ProbeRun {
  return {
    id: "run-1",
    probeId: "smoke",
    startedAt: "2026-04-25T11:55:00Z",
    finishedAt: "2026-04-25T11:55:30Z",
    durationMs: 30_000,
    triggered: false,
    summary: { total: 17, passed: 17, failed: 0 },
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  // Reset env across tests so explicit-param vs env-var resolution is
  // exercised cleanly.
  delete process.env.NEXT_PUBLIC_OPS_BASE_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchProbes", () => {
  it("hits <base>/probes and parses the response", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(emptyProbesResponse()));
    const out = await fetchProbes({ baseUrl: "http://ops.test" });
    expect(out).toEqual({ probes: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("http://ops.test/probes");
  });

  it("falls back to /api/ops when no baseUrl is supplied", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(emptyProbesResponse()));
    await fetchProbes();
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("/api/ops/probes");
  });

  it("uses NEXT_PUBLIC_OPS_BASE_URL when explicit param omitted", async () => {
    process.env.NEXT_PUBLIC_OPS_BASE_URL = "https://ops.example.com";
    fetchSpy.mockResolvedValue(jsonResponse(emptyProbesResponse()));
    await fetchProbes();
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://ops.example.com/probes");
  });

  it("strips trailing slashes from baseUrl", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(emptyProbesResponse()));
    await fetchProbes({ baseUrl: "http://ops.test/" });
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("http://ops.test/probes");
  });

  it("propagates the AbortSignal to fetch", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(emptyProbesResponse()));
    const ctrl = new AbortController();
    await fetchProbes({ signal: ctrl.signal, baseUrl: "http://ops.test" });
    const init = fetchSpy.mock.calls[0]![1] as FetchInit;
    expect(init?.signal).toBe(ctrl.signal);
  });

  it("throws on non-2xx responses with the status in the message", async () => {
    fetchSpy.mockResolvedValue(
      new Response("nope", { status: 503, statusText: "Service Unavailable" }),
    );
    await expect(
      fetchProbes({ baseUrl: "http://ops.test" }),
    ).rejects.toThrow(/503/);
  });

  it("throws on 4xx responses", async () => {
    fetchSpy.mockResolvedValue(
      new Response("bad", { status: 400, statusText: "Bad Request" }),
    );
    await expect(
      fetchProbes({ baseUrl: "http://ops.test" }),
    ).rejects.toThrow(/400/);
  });
});

describe("fetchProbeDetail", () => {
  it("hits <base>/probes/<id> and returns probe + runs", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ probe: sampleEntry(), runs: [sampleRun()] }),
    );
    const out = await fetchProbeDetail("smoke", { baseUrl: "http://ops.test" });
    expect(out.probe.id).toBe("smoke");
    expect(out.runs).toHaveLength(1);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("http://ops.test/probes/smoke");
  });

  it("URL-encodes the id segment", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ probe: sampleEntry(), runs: [] }),
    );
    await fetchProbeDetail("e2e demos", { baseUrl: "http://ops.test" });
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("http://ops.test/probes/e2e%20demos");
  });

  it("propagates AbortSignal", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ probe: sampleEntry(), runs: [] }),
    );
    const ctrl = new AbortController();
    await fetchProbeDetail("smoke", {
      signal: ctrl.signal,
      baseUrl: "http://ops.test",
    });
    const init = fetchSpy.mock.calls[0]![1] as FetchInit;
    expect(init?.signal).toBe(ctrl.signal);
  });

  it("throws on 404", async () => {
    fetchSpy.mockResolvedValue(
      new Response("missing", { status: 404, statusText: "Not Found" }),
    );
    await expect(
      fetchProbeDetail("nope", { baseUrl: "http://ops.test" }),
    ).rejects.toThrow(/404/);
  });
});

describe("triggerProbe", () => {
  function triggerOk(): TriggerResponse {
    return {
      runId: "run-42",
      status: "queued",
      probe: "smoke",
      scope: ["agno", "langgraph"],
    };
  }

  it("POSTs to <base>/probes/<id>/trigger with bearer + JSON body", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(triggerOk()));
    const out = await triggerProbe("smoke", {
      slugs: ["agno", "langgraph"],
      token: "secret-token",
      baseUrl: "http://ops.test",
    });
    expect(out.runId).toBe("run-42");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]! as [string, FetchInit];
    expect(String(url)).toBe("http://ops.test/probes/smoke/trigger");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer secret-token");
    expect(headers.get("content-type")).toMatch(/application\/json/);
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ slugs: ["agno", "langgraph"] });
  });

  it("sends an empty-object body when no slugs supplied", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(triggerOk()));
    await triggerProbe("smoke", {
      token: "t",
      baseUrl: "http://ops.test",
    });
    const init = fetchSpy.mock.calls[0]![1] as FetchInit;
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({});
  });

  it("URL-encodes the id in the trigger URL", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(triggerOk()));
    await triggerProbe("e2e demos", {
      token: "t",
      baseUrl: "http://ops.test",
    });
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("http://ops.test/probes/e2e%20demos/trigger");
  });

  it("throws on 401 with status in message", async () => {
    fetchSpy.mockResolvedValue(
      new Response("nope", { status: 401, statusText: "Unauthorized" }),
    );
    await expect(
      triggerProbe("smoke", {
        token: "bad",
        baseUrl: "http://ops.test",
      }),
    ).rejects.toThrow(/401/);
  });

  it("throws on 5xx", async () => {
    fetchSpy.mockResolvedValue(
      new Response("boom", { status: 500, statusText: "Server Error" }),
    );
    await expect(
      triggerProbe("smoke", {
        token: "t",
        baseUrl: "http://ops.test",
      }),
    ).rejects.toThrow(/500/);
  });
});
