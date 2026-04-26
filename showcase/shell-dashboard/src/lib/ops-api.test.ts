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
    await expect(fetchProbes({ baseUrl: "http://ops.test" })).rejects.toThrow(
      /503/,
    );
  });

  it("throws on 4xx responses", async () => {
    fetchSpy.mockResolvedValue(
      new Response("bad", { status: 400, statusText: "Bad Request" }),
    );
    await expect(fetchProbes({ baseUrl: "http://ops.test" })).rejects.toThrow(
      /400/,
    );
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

  it("propagates AbortSignal to fetch (CR-B1.5)", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(triggerOk()));
    const ctrl = new AbortController();
    await triggerProbe("smoke", {
      token: "t",
      baseUrl: "http://ops.test",
      signal: ctrl.signal,
    });
    const init = fetchSpy.mock.calls[0]![1] as FetchInit;
    expect(init?.signal).toBe(ctrl.signal);
  });
});

describe("GET requests bypass cache (R3-D.1)", () => {
  it("fetchProbes sends cache: 'no-store' to defeat browser/Next caching", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(emptyProbesResponse()));
    await fetchProbes({ baseUrl: "http://ops.test" });
    const init = fetchSpy.mock.calls[0]![1] as FetchInit;
    expect(init?.cache).toBe("no-store");
  });

  it("fetchProbeDetail sends cache: 'no-store' to defeat browser/Next caching", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ probe: sampleEntry(), runs: [] }),
    );
    await fetchProbeDetail("smoke", { baseUrl: "http://ops.test" });
    const init = fetchSpy.mock.calls[0]![1] as FetchInit;
    expect(init?.cache).toBe("no-store");
  });
});

describe("ensureOk error handling (CR-B1.6)", () => {
  it("includes a body-read failure marker when text() throws", async () => {
    // Build a Response-like object whose `text()` throws and whose `ok` is
    // false. Response.text() does not normally throw on Response objects
    // with string bodies, so we hand-roll a stub.
    const fakeResponse = {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: vi.fn(async () => {
        throw new Error("stream consumed");
      }),
    } as unknown as Response;
    fetchSpy.mockResolvedValue(fakeResponse);
    let caught: unknown = null;
    try {
      await fetchProbes({ baseUrl: "http://ops.test" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/body read failed/);
    // status should still appear so callers can match on it.
    expect((caught as Error).message).toMatch(/502/);
  });

  it("re-throws AbortError as-is from response.text() (preserves name)", async () => {
    // R2-C.3: when body read fails with AbortError (e.g. caller aborted
    // mid-body), preserve the AbortError name so hooks can filter it.
    const abortErr = new DOMException("aborted", "AbortError");
    const fakeResponse = {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: vi.fn(async () => {
        throw abortErr;
      }),
    } as unknown as Response;
    fetchSpy.mockResolvedValue(fakeResponse);
    let caught: unknown = null;
    try {
      await fetchProbes({ baseUrl: "http://ops.test" });
    } catch (err) {
      caught = err;
    }
    // Must be the original AbortError, not a wrapped Error.
    expect((caught as { name?: string })?.name).toBe("AbortError");
  });

  it("re-throws AbortError as-is from response.json() (parseJson)", async () => {
    // R2-C.3: parseJson must propagate AbortError from response.json().
    const abortErr = new DOMException("aborted", "AbortError");
    const fakeResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: vi.fn(async () => {
        throw abortErr;
      }),
    } as unknown as Response;
    fetchSpy.mockResolvedValue(fakeResponse);
    let caught: unknown = null;
    try {
      await fetchProbes({ baseUrl: "http://ops.test" });
    } catch (err) {
      caught = err;
    }
    expect((caught as { name?: string })?.name).toBe("AbortError");
  });

  it("still wraps non-Abort body-read failures with a descriptive message", async () => {
    // R2-C.3: regression guard — non-Abort body errors keep the wrap path.
    const fakeResponse = {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: vi.fn(async () => {
        throw new Error("stream consumed");
      }),
    } as unknown as Response;
    fetchSpy.mockResolvedValue(fakeResponse);
    let caught: unknown = null;
    try {
      await fetchProbes({ baseUrl: "http://ops.test" });
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toMatch(/body read failed/);
    expect((caught as { name?: string })?.name).not.toBe("AbortError");
  });
});

describe("triggerProbe abort behavior (R2-C.4)", () => {
  function triggerOk(): TriggerResponse {
    return {
      runId: "run-9",
      status: "queued",
      probe: "smoke",
      scope: [],
    };
  }

  it("rejects with AbortError when called with an already-aborted signal", async () => {
    // Real fetch raises AbortError synchronously when the signal is already
    // aborted. We mimic that here so triggerProbe surfaces AbortError
    // unwrapped (per R2-C.3).
    fetchSpy.mockImplementation((_url: string, init?: FetchInit) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("aborted", "AbortError"));
      }
      return Promise.resolve(jsonResponse(triggerOk()));
    });
    const ctrl = new AbortController();
    ctrl.abort();
    let caught: unknown = null;
    try {
      await triggerProbe("smoke", {
        token: "t",
        baseUrl: "http://ops.test",
        signal: ctrl.signal,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as { name?: string })?.name).toBe("AbortError");
  });
});
