/**
 * Unit tests for the worker-runs Ops section (spec §6.2/§6.3) — the
 * family table (WorkerRunsTable) and the section wrapper
 * (WorkerRunsSection) that owns the §6.3 unavailable error-panel
 * variants. Mirrors the status-table.test.tsx harness style: fake
 * timers pinned to NOW so relative times are deterministic.
 *
 * Every rendered outcome/health value is the SERVER value verbatim —
 * these tests deliberately feed "wrong-looking" combinations (e.g. a
 * stalled batch that also has failed jobs) and assert no client-side
 * re-classification happens.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { WorkerRunsTable } from "./worker-runs-table";
import { WorkerRunsSection } from "./worker-runs-section";
import { WorkerRunsProvider } from "../lib/worker-runs-context";
import type { WorkerRunsStatus } from "../hooks/use-worker-runs";
import type {
  ProbeScheduleEntry,
  WorkerFamilySummary,
  WorkerRunBatch,
  WorkerRunsResponse,
  WorkerView,
} from "../lib/ops-api";

const NOW = new Date("2026-06-10T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function batch(overrides: Partial<WorkerRunBatch> = {}): WorkerRunBatch {
  return {
    runId: "01JRUNA",
    triggered: false,
    enqueuedAt: new Date(NOW - 35 * 60_000).toISOString(),
    finishedAt: new Date(NOW - 28 * 60_000).toISOString(),
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

function family(
  overrides: Partial<WorkerFamilySummary> = {},
): WorkerFamilySummary {
  return {
    family: "d5",
    label: "D5 e2e-deep",
    probeKeyPrefix: "d5-single-pill-e2e",
    schedule: "*/30 * * * *",
    periodMs: 1_800_000,
    nextRunAt: new Date(NOW + 10 * 60_000).toISOString(),
    lastRun: batch(),
    inflight: null,
    lastSuccessAt: new Date(NOW - 28 * 60_000).toISOString(),
    ...overrides,
  };
}

function worker(overrides: Partial<WorkerView> = {}): WorkerView {
  return {
    workerId: "worker-railway-abc",
    health: "online",
    lastHeartbeatAt: new Date(NOW - 5_000).toISOString(),
    registeredAt: new Date(NOW - 3_600_000).toISOString(),
    currentJobId: null,
    capacity: { inUse: 0, available: 24, max: 24 },
    ...overrides,
  };
}

function runsResponse(
  overrides: Partial<WorkerRunsResponse> = {},
): WorkerRunsResponse {
  return { families: [family()], workers: [worker()], ...overrides };
}

function starterEntry(
  overrides: Partial<ProbeScheduleEntry> = {},
): ProbeScheduleEntry {
  return {
    id: "starter_smoke",
    kind: "smoke",
    schedule: "40 * * * *",
    nextRunAt: new Date(NOW + 25 * 60_000).toISOString(),
    lastRun: {
      startedAt: new Date(NOW - 35 * 60_000).toISOString(),
      finishedAt: new Date(NOW - 30 * 60_000).toISOString(),
      durationMs: 5 * 60_000,
      state: "completed",
      summary: { total: 17, passed: 17, failed: 0 },
    },
    inflight: null,
    config: { timeout_ms: 30_000, max_concurrency: 4, discovery: null },
    ...overrides,
  };
}

describe("WorkerRunsTable", () => {
  it("renders one row per family with humanized schedule and relative next/last run", () => {
    const data = runsResponse({
      families: [
        family({ family: "d5", label: "D5 e2e-deep" }),
        family({
          family: "d6",
          label: "D6 all-pills",
          probeKeyPrefix: "d6",
          schedule: "0 */6 * * *",
        }),
      ],
    });
    const { getByTestId } = render(
      <WorkerRunsTable data={data} probeEntries={null} />,
    );
    expect(getByTestId("worker-runs-row-d5")).toBeDefined();
    const d6Row = getByTestId("worker-runs-row-d6");
    expect(d6Row.textContent).toContain("D6 all-pills");
    expect(d6Row.textContent).toContain("Every 6h");
    // next run = NOW + 10m, last run = enqueuedAt NOW - 35m.
    expect(d6Row.textContent).toMatch(/in\s+10m/);
    expect(d6Row.textContent).toMatch(/35m\s+ago/);
  });

  it("outcome chip renders stalled verbatim for a batch arriving as stalled (no client re-classification)", () => {
    // The overlap case from §5.2.1: an abandoned batch with BOTH a failed
    // job and zombie non-terminal jobs arrives precedence-classified as
    // "stalled" — the client must render that verbatim, never "failed".
    const data = runsResponse({
      families: [
        family({
          lastRun: batch({
            outcome: "stalled",
            finishedAt: null,
            durationMs: null,
            jobs: { total: 19, done: 12, failed: 2, reclaimed: 0 },
          }),
        }),
      ],
    });
    const { getByTestId } = render(
      <WorkerRunsTable data={data} probeEntries={null} />,
    );
    const outcome = getByTestId("worker-runs-row-d5-outcome");
    expect(outcome.getAttribute("data-outcome")).toBe("stalled");
    expect(outcome.textContent).toContain("stalled");
    expect(outcome.textContent).not.toContain("failed");
  });

  it("running chip shows elapsed and done/total when inflight present", () => {
    const data = runsResponse({
      families: [
        family({
          inflight: {
            runId: "01JRUNX",
            triggered: false,
            enqueuedAt: new Date(NOW - 83_000).toISOString(),
            elapsedMs: 83_000,
            stalled: false,
            jobs: { pending: 4, claimed: 1, running: 3, done: 11, failed: 0 },
          },
        }),
      ],
    });
    const { getByTestId } = render(
      <WorkerRunsTable data={data} probeEntries={null} />,
    );
    const chip = getByTestId("worker-runs-row-d5-running");
    expect(chip.textContent).toContain("running");
    expect(chip.textContent).toContain("1m 23s");
    expect(chip.textContent).toContain("11/19");
  });

  it("renders an amber stalled chip on the in-flight indicator when inflight.stalled", () => {
    const data = runsResponse({
      families: [
        family({
          inflight: {
            runId: "01JRUNX",
            triggered: false,
            enqueuedAt: new Date(NOW - 2 * 3600_000).toISOString(),
            elapsedMs: 2 * 3600_000,
            stalled: true,
            jobs: { pending: 19, claimed: 0, running: 0, done: 0, failed: 0 },
          },
        }),
      ],
    });
    const { getByTestId } = render(
      <WorkerRunsTable data={data} probeEntries={null} />,
    );
    const chip = getByTestId("worker-runs-row-d5-running");
    expect(chip.getAttribute("data-stalled")).toBe("true");
    expect(chip.textContent).toContain("stalled");
    expect(chip.className).toContain("--amber");
  });

  it("reds column omitted when both counters are 0 or null", () => {
    const data = runsResponse({
      families: [
        family({
          family: "d5",
          lastRun: batch({ redsIntroduced: 0, redsCleared: 0 }),
        }),
        family({
          family: "d6",
          probeKeyPrefix: "d6",
          lastRun: batch({ redsIntroduced: null, redsCleared: null }),
        }),
      ],
    });
    const { getByTestId } = render(
      <WorkerRunsTable data={data} probeEntries={null} />,
    );
    expect(getByTestId("worker-runs-row-d5-reds").textContent).toBe("");
    expect(getByTestId("worker-runs-row-d6-reds").textContent).toBe("");
  });

  it("reds column renders +N / −M when either counter is nonzero", () => {
    const data = runsResponse({
      families: [
        family({ lastRun: batch({ redsIntroduced: 1, redsCleared: 2 }) }),
      ],
    });
    const { getByTestId } = render(
      <WorkerRunsTable data={data} probeEntries={null} />,
    );
    const reds = getByTestId("worker-runs-row-d5-reds");
    expect(reds.textContent).toContain("+1");
    expect(reds.textContent).toContain("−2");
  });

  it("worker strip renders online/stale/offline verbatim with amber/red treatments", () => {
    const data = runsResponse({
      workers: [
        worker({ workerId: "worker-a", health: "online" }),
        worker({
          workerId: "worker-b",
          health: "stale",
          capacity: { inUse: 3, available: 21, max: 24 },
        }),
        worker({ workerId: "worker-c", health: "offline" }),
      ],
    });
    const { getByTestId } = render(
      <WorkerRunsTable data={data} probeEntries={null} />,
    );
    const a = getByTestId("worker-chip-worker-a");
    const b = getByTestId("worker-chip-worker-b");
    const c = getByTestId("worker-chip-worker-c");
    expect(a.getAttribute("data-health")).toBe("online");
    expect(a.textContent).toContain("online");
    expect(a.textContent).toContain("0/24 contexts");
    expect(b.getAttribute("data-health")).toBe("stale");
    expect(b.textContent).toContain("stale");
    expect(b.textContent).toContain("3/24 contexts");
    expect(b.className).toContain("--amber");
    expect(c.getAttribute("data-health")).toBe("offline");
    expect(c.textContent).toContain("offline");
    expect(c.className).toContain("--danger");
  });

  it("failed lastRun renders the red left border", () => {
    const data = runsResponse({
      families: [
        family({
          lastRun: batch({
            outcome: "failed",
            jobs: { total: 19, done: 17, failed: 2, reclaimed: 0 },
            errorSummary: "d5-single-pill-e2e:agno — worker-crashed-mid-job",
            commErrorKinds: ["worker-crashed-mid-job"],
          }),
        }),
      ],
    });
    const { getByTestId } = render(
      <WorkerRunsTable data={data} probeEntries={null} />,
    );
    const row = getByTestId("worker-runs-row-d5");
    expect(row.className).toContain("border-l-2");
    expect(row.className).toContain("--danger");
    // Comm-error kinds surface as the failed chip's tooltip (§6.2).
    const outcome = getByTestId("worker-runs-row-d5-outcome");
    expect(outcome.getAttribute("title")).toContain("worker-crashed-mid-job");
  });

  it("does not render the red left border on a completed lastRun", () => {
    const { getByTestId } = render(
      <WorkerRunsTable data={runsResponse()} probeEntries={null} />,
    );
    expect(getByTestId("worker-runs-row-d5").className).not.toContain(
      "border-l-2",
    );
  });

  it("renders the subdued starter-cycle row with the in-process badge from the probes entry", () => {
    const { getByTestId } = render(
      <WorkerRunsTable data={runsResponse()} probeEntries={[starterEntry()]} />,
    );
    const row = getByTestId("worker-runs-starter-row");
    expect(row.getAttribute("data-variant")).toBe("in-process");
    expect(row.textContent).toContain("starter cycle");
    expect(row.textContent).toContain("in-process");
  });

  it("starter row self-omits to the not-mounted variant when probes entries unavailable", () => {
    // Null prop (probes endpoint unmounted — OPS_TRIGGER_TOKEN unset) and
    // empty entries alike: the row never vanishes silently (§6.2).
    for (const probeEntries of [null, [] as ProbeScheduleEntry[]]) {
      const { getByTestId, unmount } = render(
        <WorkerRunsTable data={runsResponse()} probeEntries={probeEntries} />,
      );
      const row = getByTestId("worker-runs-starter-row");
      expect(row.getAttribute("data-variant")).toBe("not-mounted");
      expect(row.textContent).toContain(
        "starter cycle — probes endpoint not mounted",
      );
      unmount();
    }
  });
});

describe("WorkerRunsSection", () => {
  function renderSection(
    status: WorkerRunsStatus | null,
    probeEntries: ProbeScheduleEntry[] | null = [],
  ) {
    return render(
      <WorkerRunsProvider value={status}>
        <WorkerRunsSection probeEntries={probeEntries} />
      </WorkerRunsProvider>,
    );
  }

  it("renders the heading and the family table when the poll is ok", () => {
    const { getByTestId } = renderSection({
      status: "ok",
      data: runsResponse(),
      fetchedAt: NOW,
    });
    expect(getByTestId("worker-runs-heading").textContent).toContain(
      "Worker runs",
    );
    expect(getByTestId("worker-runs-table")).toBeDefined();
  });

  it("opens the detail panel when a family row is selected", () => {
    // The detail panel fetches history on mount — stub fetch so the click
    // doesn't escape jsdom. Resolution details are covered by the panel's
    // own test file.
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            family: "d5",
            runs: [],
            perPage: 20,
            nextBefore: null,
            nextBeforeId: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { getByTestId } = renderSection({
        status: "ok",
        data: runsResponse(),
        fetchedAt: NOW,
      });
      fireEvent.click(getByTestId("worker-runs-row-d5"));
      expect(getByTestId("worker-run-detail-panel")).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("unreachable state renders the error panel with dimmed last-good data beneath", () => {
    const { getByTestId } = renderSection({
      status: "unavailable",
      kind: "unreachable",
      lastGood: { data: runsResponse(), fetchedAt: NOW - 30_000 },
    });
    const panel = getByTestId("worker-runs-error-panel");
    expect(panel.getAttribute("data-kind")).toBe("unreachable");
    expect(panel.textContent).toContain(
      "Worker runs unavailable — ops endpoint unreachable",
    );
    expect(panel.textContent).toMatch(/last good data\s+30s\s+ago/);
    const lastGood = getByTestId("worker-runs-last-good");
    expect(lastGood.className).toContain("opacity");
    expect(
      lastGood.querySelector('[data-testid="worker-runs-table"]'),
    ).not.toBeNull();
  });

  it("misdeploy-404 renders the endpoint-disappeared panel variant (cold and post-success alike)", () => {
    // Cold first poll: no last-good data, nothing beneath the panel.
    const cold = renderSection({
      status: "unavailable",
      kind: "misdeploy-404",
      lastGood: null,
    });
    const coldPanel = cold.getByTestId("worker-runs-error-panel");
    expect(coldPanel.getAttribute("data-kind")).toBe("misdeploy-404");
    expect(coldPanel.textContent).toContain(
      "Worker runs unavailable — endpoint disappeared (possible misdeploy)",
    );
    expect(cold.queryByTestId("worker-runs-last-good")).toBeNull();
    cold.unmount();

    // Post-success: same variant, last-good table dimmed beneath.
    const warm = renderSection({
      status: "unavailable",
      kind: "misdeploy-404",
      lastGood: { data: runsResponse(), fetchedAt: NOW - 60_000 },
    });
    expect(warm.getByTestId("worker-runs-error-panel").textContent).toContain(
      "endpoint disappeared (possible misdeploy)",
    );
    expect(warm.getByTestId("worker-runs-last-good")).toBeDefined();
  });

  it("history-backend marker renders its own panel variant", () => {
    const { getByTestId } = renderSection({
      status: "unavailable",
      kind: "history-backend",
      lastGood: null,
    });
    const panel = getByTestId("worker-runs-error-panel");
    expect(panel.getAttribute("data-kind")).toBe("history-backend");
    expect(panel.textContent).toContain(
      "Worker runs unavailable — run history backend unreachable",
    );
  });

  it("never self-hides: renders the heading with a loading line before the first poll settles", () => {
    const { getByTestId } = renderSection(null);
    expect(getByTestId("worker-runs-heading").textContent).toContain(
      "Worker runs",
    );
    expect(getByTestId("worker-runs-loading")).toBeDefined();
  });
});
