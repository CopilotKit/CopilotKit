/**
 * Integration test: `useProbes` → `lib/ops-api` → `fetch`, with no module
 * mocks between the hook and the real client. This is the missing
 * coverage that masked the production bug where the dashboard rendered
 * "All probes idle" because the resolved URL was hitting the dashboard
 * origin (404) instead of the showcase-ops proxy path.
 *
 * Why both layers must be exercised together:
 *   - `use-probes.test.ts` mocks the entire `lib/ops-api` module, so it
 *     never validates URL resolution.
 *   - `lib/ops-api.test.ts` mocks `globalThis.fetch`, but it imports the
 *     client directly and never goes through the hook layer that the page
 *     actually uses.
 *
 * The bug was a contract gap between layers (next.config rewrite missing
 * + env not set on Railway), which neither isolated test can catch. This
 * suite asserts the end-to-end URL the browser would actually hit when
 * `useProbes()` is called with no overrides — the path the production
 * dashboard runs on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProbes } from "./use-probes";
import type { ProbesResponse } from "../lib/ops-api";

let fetchSpy: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  delete process.env.NEXT_PUBLIC_OPS_BASE_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useProbes → ops-api → fetch wiring", () => {
  it("hits the relative same-origin proxy path /api/ops/probes by default", async () => {
    const body: ProbesResponse = {
      probes: [
        {
          id: "smoke",
          kind: "smoke",
          schedule: "*/5 * * * *",
          nextRunAt: null,
          lastRun: null,
          inflight: null,
          config: { timeout_ms: 60_000, max_concurrency: 5, discovery: null },
        },
      ],
    };
    fetchSpy.mockResolvedValue(jsonResponse(body));

    const { result } = renderHook(() => useProbes());
    await waitFor(() => expect(result.current.data?.probes).toHaveLength(1));

    // The hook must call fetch through ops-api with the same-origin proxy
    // path. Anything else (the dashboard origin + /api/ops, or an inlined
    // ops base URL) means the rewrite contract is broken.
    expect(fetchSpy).toHaveBeenCalled();
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toBe("/api/ops/probes");
  });

  it("parses probes returned by the proxy and exposes them on data", async () => {
    const body: ProbesResponse = {
      probes: [
        {
          id: "image-drift",
          kind: "image-drift",
          schedule: "*/15 * * * *",
          nextRunAt: "2026-04-25T12:15:00Z",
          lastRun: null,
          inflight: null,
          config: { timeout_ms: 60_000, max_concurrency: 5, discovery: null },
        },
        {
          id: "pin-drift",
          kind: "pin-drift",
          schedule: "*/15 * * * *",
          nextRunAt: "2026-04-25T12:15:00Z",
          lastRun: null,
          inflight: null,
          config: { timeout_ms: 60_000, max_concurrency: 5, discovery: null },
        },
      ],
    };
    fetchSpy.mockResolvedValue(jsonResponse(body));

    const { result } = renderHook(() => useProbes());
    await waitFor(() =>
      expect(result.current.data?.probes.map((p) => p.id)).toEqual([
        "image-drift",
        "pin-drift",
      ]),
    );
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("surfaces a useful error when the proxy path returns 404 (regression)", async () => {
    // Production failure mode this guards against: the rewrite is missing
    // and /api/ops/probes 404s against the dashboard's own origin. The
    // hook must surface the 404 with the URL in the message so the
    // operator can grep their way back to "the rewrite is missing"
    // instead of seeing a vague "All probes idle" empty state.
    fetchSpy.mockResolvedValue(
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );

    const { result } = renderHook(() => useProbes());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error?.message).toMatch(/404/);
    expect(result.current.error?.message).toMatch(/\/api\/ops\/probes/);
    expect(result.current.data).toBeNull();
  });
});
