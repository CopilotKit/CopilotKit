/**
 * Unit tests for WorkerRunDetailPanel (spec §6.2) — the run-history
 * drill-down opened from a worker-runs-table row.
 *
 * Mocks `globalThis.fetch` (the ops-api fetchers run against jsdom's
 * default `/api/ops` base) and dispatches on URL: `/api/ops/runs/:family`
 * for history pages, `/api/ops/runs/:family/:runId` for the per-service
 * drill-down. Real timers — the §6.1 throttle test uses `Retry-After: 0`
 * so the fetcher's internal retry loop completes immediately.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

import { WorkerRunDetailPanel } from "./worker-run-detail-panel";
import type {
  WorkerRunBatch,
  WorkerRunDetailResponse,
  WorkerRunHistoryResponse,
  WorkerRunJob,
} from "../lib/ops-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function batch(overrides: Partial<WorkerRunBatch> = {}): WorkerRunBatch {
  return {
    runId: "01JRUNA",
    triggered: false,
    enqueuedAt: "2026-06-10T11:25:00.000Z",
    finishedAt: "2026-06-10T11:32:00.000Z",
    durationMs: 7 * 60_000,
    outcome: "completed",
    jobs: { total: 19, done: 19, failed: 0, reclaimed: 0 },
    cells: { total: 152, passed: 152, failed: 0 },
    redsIntroduced: 0,
    redsCleared: 0,
    errorSummary: null,
    commErrorKinds: [],
    ...overrides,
  };
}

function job(overrides: Partial<WorkerRunJob> = {}): WorkerRunJob {
  return {
    jobId: "job-1",
    probeKey: "d5-single-pill-e2e:agno",
    serviceSlug: "agno",
    status: "failed",
    claimedBy: "worker-railway-abc",
    enqueuedAt: "2026-06-10T11:25:00.000Z",
    claimedAt: "2026-06-10T11:25:04.100Z",
    finishedAt: "2026-06-10T11:28:16.444Z",
    queueLatencyMs: 4100,
    durationMs: 192_344,
    reclaimCount: 0,
    cells: { total: 8, passed: 6, failed: 2 },
    errorSummary: "d5-single-pill-e2e:agno — 2/8 cells failed",
    commError: {
      kind: "worker-crashed-mid-job",
      observedAt: "2026-06-10T11:28:16.444Z",
    },
    ...overrides,
  };
}

function historyResponse(
  overrides: Partial<WorkerRunHistoryResponse> = {},
): WorkerRunHistoryResponse {
  return {
    family: "d5",
    runs: [batch()],
    perPage: 20,
    nextBefore: null,
    nextBeforeId: null,
    ...overrides,
  };
}

function detailResponse(
  overrides: Partial<WorkerRunDetailResponse> = {},
): WorkerRunDetailResponse {
  return { family: "d5", runId: "01JRUNA", jobs: [job()], ...overrides };
}

/** Stub fetch with a URL-dispatched handler map. */
function stubFetch(
  handler: (url: string) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("WorkerRunDetailPanel", () => {
  it("returns null when family is null", () => {
    stubFetch(() => jsonResponse(historyResponse()));
    const { container } = render(
      <WorkerRunDetailPanel family={null} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the history batches with outcome chips and triggered badge", async () => {
    stubFetch(() =>
      jsonResponse(
        historyResponse({
          runs: [
            batch({ runId: "01JRUNA", outcome: "failed", triggered: true }),
            batch({ runId: "01JRUNB", outcome: "completed" }),
          ],
        }),
      ),
    );
    const { getByTestId } = render(
      <WorkerRunDetailPanel family="d5" onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(getByTestId("worker-run-batch-01JRUNA")).toBeDefined();
    });
    expect(getByTestId("worker-run-batch-01JRUNB")).toBeDefined();
    const outcomeA = getByTestId("worker-run-batch-01JRUNA-outcome");
    expect(outcomeA.getAttribute("data-outcome")).toBe("failed");
    expect(getByTestId("worker-run-batch-01JRUNA").textContent).toContain(
      "manual",
    );
  });

  it("expands a batch to the per-service job table with errorSummary inline and the unreachable comm-kind badge", async () => {
    stubFetch((url) =>
      url.includes("/runs/d5/01JRUNA")
        ? jsonResponse(detailResponse())
        : jsonResponse(historyResponse()),
    );
    const { getByTestId } = render(
      <WorkerRunDetailPanel family="d5" onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(getByTestId("worker-run-batch-01JRUNA")).toBeDefined();
    });
    fireEvent.click(getByTestId("worker-run-batch-01JRUNA"));
    await waitFor(() => {
      expect(getByTestId("worker-run-job-job-1")).toBeDefined();
    });
    const row = getByTestId("worker-run-job-job-1");
    expect(row.textContent).toContain("agno");
    expect(row.textContent).toContain("worker-railway-abc");
    expect(row.textContent).toContain(
      "d5-single-pill-e2e:agno — 2/8 cells failed",
    );
    const badge = row.querySelector('[data-testid="comm-kind-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("data-kind")).toBe("worker-crashed-mid-job");
    expect(badge!.getAttribute("data-treatment")).toBe("unreachable");
  });

  it("renders worker-reclaimed-pending comm errors as the gray re-queued badge, never red", async () => {
    stubFetch((url) =>
      url.includes("/runs/d5/01JRUNA")
        ? jsonResponse(
            detailResponse({
              jobs: [
                job({
                  status: "pending",
                  commError: {
                    kind: "worker-reclaimed-pending",
                    observedAt: "2026-06-10T11:28:16.444Z",
                  },
                  errorSummary: null,
                }),
              ],
            }),
          )
        : jsonResponse(historyResponse()),
    );
    const { getByTestId } = render(
      <WorkerRunDetailPanel family="d5" onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(getByTestId("worker-run-batch-01JRUNA")).toBeDefined();
    });
    fireEvent.click(getByTestId("worker-run-batch-01JRUNA"));
    await waitFor(() => {
      expect(getByTestId("worker-run-job-job-1")).toBeDefined();
    });
    const badge = getByTestId("worker-run-job-job-1").querySelector(
      '[data-testid="comm-kind-badge"]',
    );
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("data-treatment")).toBe("pending");
    expect(badge!.textContent).toContain("re-queued");
    expect(badge!.className).not.toContain("--danger");
    expect(badge!.className).not.toContain("indigo");
  });

  it("a 429/ThrottledError on the detail panel renders the throttled-retrying hint and does NOT trip the unreachable treatment", async () => {
    // Every history request answers 429 with Retry-After: 0 so the
    // fetcher's capped internal retry loop (3 attempts) exhausts
    // immediately and throws ThrottledError.
    stubFetch(
      () => new Response("", { status: 429, headers: { "retry-after": "0" } }),
    );
    const { getByTestId, queryByTestId } = render(
      <WorkerRunDetailPanel family="d5" onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(getByTestId("worker-run-detail-throttled")).toBeDefined();
    });
    expect(getByTestId("worker-run-detail-throttled").textContent).toContain(
      "throttled — retrying",
    );
    // NON-incident (§6.1): no error panel, no unreachable treatment.
    expect(queryByTestId("worker-run-detail-error")).toBeNull();
    expect(getByTestId("worker-run-detail-panel").textContent).not.toContain(
      "unreachable",
    );
    // The retry affordance re-issues the request.
    expect(getByTestId("worker-run-detail-retry")).toBeDefined();
  });

  it("truncated batches render the honest-partial marker", async () => {
    stubFetch(() =>
      jsonResponse(
        historyResponse({
          runs: [batch({ runId: "01JRUNT", truncated: true })],
        }),
      ),
    );
    const { getByTestId } = render(
      <WorkerRunDetailPanel family="d5" onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(getByTestId("worker-run-batch-01JRUNT-truncated")).toBeDefined();
    });
    expect(
      getByTestId("worker-run-batch-01JRUNT-truncated").textContent,
    ).toContain("partial");
  });

  it("pages older history via the composite cursor echoed verbatim", async () => {
    const before = "2026-06-10T10:00:00.000Z";
    const beforeId = "row99";
    const spy = stubFetch((url) => {
      const parsed = new URL(url, "http://localhost");
      if (parsed.searchParams.get("before") === before) {
        return jsonResponse(
          historyResponse({ runs: [batch({ runId: "01JRUNOLD" })] }),
        );
      }
      return jsonResponse(
        historyResponse({
          runs: [batch({ runId: "01JRUNA" })],
          nextBefore: before,
          nextBeforeId: beforeId,
        }),
      );
    });
    const { getByTestId } = render(
      <WorkerRunDetailPanel family="d5" onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(getByTestId("worker-run-detail-load-more")).toBeDefined();
    });
    fireEvent.click(getByTestId("worker-run-detail-load-more"));
    await waitFor(() => {
      expect(getByTestId("worker-run-batch-01JRUNOLD")).toBeDefined();
    });
    // Both cursor fields echoed verbatim (§5.2.2 — never `before` alone).
    const pagedCall = spy.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("before="));
    expect(pagedCall).toBeDefined();
    const parsed = new URL(pagedCall!, "http://localhost");
    expect(parsed.searchParams.get("before")).toBe(before);
    expect(parsed.searchParams.get("beforeId")).toBe(beforeId);
    // First page still rendered (appended, not replaced).
    expect(getByTestId("worker-run-batch-01JRUNA")).toBeDefined();
  });

  it("renders the panel-local history-unavailable error when the response carries the marker", async () => {
    stubFetch(() =>
      jsonResponse(historyResponse({ runs: [], error: "history_unavailable" })),
    );
    const { getByTestId } = render(
      <WorkerRunDetailPanel family="d5" onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(getByTestId("worker-run-detail-error")).toBeDefined();
    });
    expect(getByTestId("worker-run-detail-error").textContent).toContain(
      "run history backend unreachable",
    );
  });

  it("invokes onClose from the close button", async () => {
    stubFetch(() => jsonResponse(historyResponse()));
    const onClose = vi.fn();
    const { getByTestId } = render(
      <WorkerRunDetailPanel family="d5" onClose={onClose} />,
    );
    fireEvent.click(getByTestId("worker-run-detail-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
