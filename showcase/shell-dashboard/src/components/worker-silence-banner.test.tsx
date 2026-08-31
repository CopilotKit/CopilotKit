/**
 * Unit tests for WorkerSilenceBanner — the coverage-tab worker-family
 * silence banner (spec §7.4).
 *
 * Covers the four §7.4 behaviors:
 *  - amber banner when any family's lastSuccessAt is older than 2 periods
 *    (server-computed periodMs — never client cron parsing),
 *  - never-succeeded families banner off their oldest batch's enqueuedAt
 *    (§5.2.1 null fallback) while zero-batch families stay quiet,
 *  - an unavailable context (incl. the §6.1 404 rule) shows the
 *    unreachable variant with last-good relative time instead of
 *    vanishing,
 *  - the banner is dismissible (and re-surfaces when its content
 *    identity changes).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { WorkerSilenceBanner } from "./worker-silence-banner";
import { WorkerRunsProvider } from "../lib/worker-runs-context";
import type { WorkerRunsStatus } from "../hooks/use-worker-runs";
import type {
  WorkerFamilySummary,
  WorkerRunBatch,
  WorkerRunsResponse,
  WorkerView,
} from "../lib/ops-api";

const NOW = new Date("2026-06-10T12:00:00Z").getTime();
/** 30-minute resolved period (the d5/e2e-smoke default). */
const PERIOD_MS = 1_800_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeBatch(enqueuedAtMs: number): WorkerRunBatch {
  return {
    runId: "run-1",
    triggered: false,
    enqueuedAt: new Date(enqueuedAtMs).toISOString(),
    finishedAt: null,
    durationMs: null,
    outcome: "stalled",
    jobs: { total: 3, done: 0, failed: 0, reclaimed: 0 },
    cells: null,
    redsIntroduced: null,
    redsCleared: null,
    errorSummary: null,
    commErrorKinds: [],
  };
}

function makeFamily(
  overrides: Partial<WorkerFamilySummary> = {},
): WorkerFamilySummary {
  return {
    family: "d5",
    label: "D5 e2e-deep",
    probeKeyPrefix: "d5-single-pill-e2e",
    schedule: "*/30 * * * *",
    periodMs: PERIOD_MS,
    nextRunAt: null,
    lastRun: null,
    inflight: null,
    lastSuccessAt: null,
    ...overrides,
  };
}

function okStatus(
  families: WorkerFamilySummary[],
  workers: WorkerView[] = [],
): WorkerRunsStatus {
  const data: WorkerRunsResponse = { families, workers };
  return { status: "ok", data, fetchedAt: NOW };
}

/** A worker strip entry whose `registeredAt` is the bounce signal. */
function makeWorker(registeredAtMs: number): WorkerView {
  return {
    workerId: "worker-railway-abc",
    health: "online",
    lastHeartbeatAt: new Date(registeredAtMs).toISOString(),
    registeredAt: new Date(registeredAtMs).toISOString(),
    currentJobId: null,
    capacity: { inUse: 0, available: 24, max: 24 },
  };
}

function renderBanner(value: WorkerRunsStatus | null) {
  return render(
    <WorkerRunsProvider value={value}>
      <WorkerSilenceBanner />
    </WorkerRunsProvider>,
  );
}

describe("WorkerSilenceBanner", () => {
  it("shows the amber banner when a family's lastSuccessAt is older than 2 periods (server periodMs)", () => {
    const silent = makeFamily({
      family: "d5",
      label: "D5 e2e-deep",
      lastSuccessAt: new Date(NOW - 2.5 * PERIOD_MS).toISOString(),
    });
    const healthy = makeFamily({
      family: "e2e-smoke",
      label: "E2E smoke",
      probeKeyPrefix: "d4",
      lastSuccessAt: new Date(NOW - 0.5 * PERIOD_MS).toISOString(),
    });
    const { getByTestId } = renderBanner(okStatus([silent, healthy]));
    const banner = getByTestId("worker-silence-banner");
    expect(banner.getAttribute("data-variant")).toBe("silence");
    expect(banner.textContent).toContain(
      "Worker family D5 e2e-deep has not completed successfully since",
    );
    expect(banner.textContent).toContain("see Ops tab.");
    expect(banner.textContent).not.toContain("E2E smoke");
  });

  it("suppresses the banner during the post-bounce drain window (recent worker registration)", () => {
    // A NORMAL deploy bounced the pool (PR #5715): the worker re-registered
    // 0.5 period ago, so although lastSuccessAt is 2.5 periods stale (the
    // pre-bounce success), the family is legitimately mid-sweep and within
    // the 2×period bounce grace — no banner.
    const silent = makeFamily({
      family: "d5",
      label: "D5 e2e-deep",
      lastSuccessAt: new Date(NOW - 2.5 * PERIOD_MS).toISOString(),
    });
    const { queryByTestId } = renderBanner(
      okStatus([silent], [makeWorker(NOW - 0.5 * PERIOD_MS)]),
    );
    expect(queryByTestId("worker-silence-banner")).toBeNull();
  });

  it("still banners a genuinely silent family once the bounce grace has elapsed", () => {
    // Same stale family, but the freshest worker registration is 3 periods
    // old — well past the 2×period grace — so this is a real outage and the
    // banner must still fire.
    const silent = makeFamily({
      family: "d5",
      label: "D5 e2e-deep",
      lastSuccessAt: new Date(NOW - 2.5 * PERIOD_MS).toISOString(),
    });
    const { getByTestId } = renderBanner(
      okStatus([silent], [makeWorker(NOW - 3 * PERIOD_MS)]),
    );
    const banner = getByTestId("worker-silence-banner");
    expect(banner.getAttribute("data-variant")).toBe("silence");
    expect(banner.textContent).toContain(
      "Worker family D5 e2e-deep has not completed successfully since",
    );
  });

  it("uses the server periodMs verbatim — a longer period keeps the same age quiet", () => {
    // Same 2.5x-of-30min age, but the family's resolved period is hourly:
    // 75 min is well inside 2x60min, so no banner. Threshold math must
    // come from periodMs, never a hardcoded window.
    const family = makeFamily({
      family: "d6",
      label: "D6 all-pills",
      periodMs: 3_600_000,
      lastSuccessAt: new Date(NOW - 2.5 * PERIOD_MS).toISOString(),
    });
    const { queryByTestId } = renderBanner(okStatus([family]));
    expect(queryByTestId("worker-silence-banner")).toBeNull();
  });

  it("renders nothing when all families are healthy", () => {
    const { queryByTestId } = renderBanner(
      okStatus([
        makeFamily({
          lastSuccessAt: new Date(NOW - PERIOD_MS).toISOString(),
        }),
      ]),
    );
    expect(queryByTestId("worker-silence-banner")).toBeNull();
  });

  it("renders nothing when no provider data has settled (null context)", () => {
    const { queryByTestId } = renderBanner(null);
    expect(queryByTestId("worker-silence-banner")).toBeNull();
  });

  it("never-succeeded family banners once its oldest batch crosses the threshold; zero-batch family stays quiet", () => {
    const neverSucceeded = makeFamily({
      family: "d5",
      label: "D5 e2e-deep",
      lastSuccessAt: null,
      lastRun: makeBatch(NOW - 3 * PERIOD_MS),
    });
    const zeroBatch = makeFamily({
      family: "e2e-demos",
      label: "E2E demos",
      probeKeyPrefix: "e2e-demos",
      lastSuccessAt: null,
      lastRun: null,
      inflight: null,
    });
    const { getByTestId } = renderBanner(okStatus([neverSucceeded, zeroBatch]));
    const banner = getByTestId("worker-silence-banner");
    expect(banner.textContent).toContain("D5 e2e-deep");
    expect(banner.textContent).not.toContain("E2E demos");
  });

  it("unavailable context (incl. 404) shows the unreachable variant with last-good relative time instead of vanishing", () => {
    const lastGoodAt = NOW - 5 * 60_000;
    const unavailable: WorkerRunsStatus = {
      status: "unavailable",
      kind: "misdeploy-404",
      lastGood: {
        data: { families: [makeFamily()], workers: [] },
        fetchedAt: lastGoodAt,
      },
    };
    const { getByTestId } = renderBanner(unavailable);
    const banner = getByTestId("worker-silence-banner");
    expect(banner.getAttribute("data-variant")).toBe("unreachable");
    expect(banner.textContent).toContain(
      "Worker run telemetry unreachable — ops endpoint not responding",
    );
    expect(banner.textContent).toContain("(last good 5m ago)");
    expect(banner.textContent).toContain("see Ops tab.");
  });

  it("unavailable context with no last-good data still shows the unreachable variant", () => {
    const unavailable: WorkerRunsStatus = {
      status: "unavailable",
      kind: "unreachable",
      lastGood: null,
    };
    const { getByTestId } = renderBanner(unavailable);
    const banner = getByTestId("worker-silence-banner");
    expect(banner.getAttribute("data-variant")).toBe("unreachable");
    expect(banner.textContent).toContain(
      "Worker run telemetry unreachable — ops endpoint not responding",
    );
    expect(banner.textContent).not.toContain("last good");
  });

  it("banner is dismissible", () => {
    const silent = makeFamily({
      lastSuccessAt: new Date(NOW - 3 * PERIOD_MS).toISOString(),
    });
    const { getByTestId, getByLabelText, queryByTestId } = renderBanner(
      okStatus([silent]),
    );
    expect(getByTestId("worker-silence-banner")).toBeDefined();
    fireEvent.click(getByLabelText("Dismiss"));
    expect(queryByTestId("worker-silence-banner")).toBeNull();
  });

  it("a dismissed banner re-surfaces when its content identity changes", () => {
    const silentD5 = makeFamily({
      family: "d5",
      label: "D5 e2e-deep",
      lastSuccessAt: new Date(NOW - 3 * PERIOD_MS).toISOString(),
    });
    const silentSmoke = makeFamily({
      family: "e2e-smoke",
      label: "E2E smoke",
      probeKeyPrefix: "d4",
      lastSuccessAt: new Date(NOW - 3 * PERIOD_MS).toISOString(),
    });
    const { getByLabelText, queryByTestId, rerender } = renderBanner(
      okStatus([silentD5]),
    );
    fireEvent.click(getByLabelText("Dismiss"));
    expect(queryByTestId("worker-silence-banner")).toBeNull();
    // Same silent set on a later poll → stays dismissed.
    rerender(
      <WorkerRunsProvider value={okStatus([silentD5])}>
        <WorkerSilenceBanner />
      </WorkerRunsProvider>,
    );
    expect(queryByTestId("worker-silence-banner")).toBeNull();
    // A NEW family goes silent → the banner re-surfaces.
    rerender(
      <WorkerRunsProvider value={okStatus([silentD5, silentSmoke])}>
        <WorkerSilenceBanner />
      </WorkerRunsProvider>,
    );
    expect(queryByTestId("worker-silence-banner")).not.toBeNull();
  });
});
