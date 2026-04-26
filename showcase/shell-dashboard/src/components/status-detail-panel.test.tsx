/**
 * Unit tests for StatusDetailPanel — the probe-drilldown drawer that opens
 * when a row in the Status table is selected. We mock `useProbeDetail` to
 * exercise the loading / error / data states without touching the network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// vi.mock must be hoisted; declare the mock factory BEFORE importing the
// module under test (which reads the hook).
const mockUseProbeDetail = vi.fn();
vi.mock("../hooks/use-probes", () => ({
  useProbeDetail: (...args: unknown[]) => mockUseProbeDetail(...args),
}));

import { StatusDetailPanel } from "./status-detail-panel";
import type { ProbeRun, ProbeScheduleEntry } from "../lib/ops-api";

const NOW = new Date("2026-04-25T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockUseProbeDetail.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function run(overrides: Partial<ProbeRun> = {}): ProbeRun {
  return {
    id: "run-1",
    probeId: "smoke",
    startedAt: new Date(NOW - 5 * 60_000).toISOString(),
    finishedAt: new Date(NOW - 4 * 60_000).toISOString(),
    durationMs: 60_000,
    triggered: false,
    summary: { total: 17, passed: 17, failed: 0 },
    ...overrides,
  };
}

function probe(): ProbeScheduleEntry {
  return {
    id: "smoke",
    kind: "smoke",
    schedule: "0 */6 * * *",
    nextRunAt: new Date(NOW + 60_000).toISOString(),
    lastRun: null,
    inflight: null,
    config: { timeout_ms: 30000, max_concurrency: 4, discovery: null },
  };
}

describe("StatusDetailPanel", () => {
  it("renders nothing when probeId is null", () => {
    mockUseProbeDetail.mockReturnValue({
      data: null,
      error: null,
      loading: false,
    });
    const { container } = render(
      <StatusDetailPanel probeId={null} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a loading state while data is loading", () => {
    mockUseProbeDetail.mockReturnValue({
      data: null,
      error: null,
      loading: true,
    });
    const { getByTestId } = render(
      <StatusDetailPanel probeId="smoke" onClose={() => {}} />,
    );
    expect(getByTestId("status-detail-loading")).toBeDefined();
  });

  it("renders an error state when the hook reports an error", () => {
    mockUseProbeDetail.mockReturnValue({
      data: null,
      error: new Error("nope"),
      loading: false,
    });
    const { getByTestId } = render(
      <StatusDetailPanel probeId="smoke" onClose={() => {}} />,
    );
    const err = getByTestId("status-detail-error");
    expect(err).toBeDefined();
    expect(err.textContent).toContain("nope");
  });

  it("renders the probe id, runs section, and trend section when data loads", () => {
    mockUseProbeDetail.mockReturnValue({
      data: {
        probe: probe(),
        runs: [run({ id: "a" }), run({ id: "b", durationMs: 90_000 })],
      },
      error: null,
      loading: false,
    });
    const { getByTestId } = render(
      <StatusDetailPanel probeId="smoke" onClose={() => {}} />,
    );
    expect(getByTestId("status-detail-panel")).toBeDefined();
    expect(getByTestId("status-detail-header").textContent).toContain("smoke");
    expect(getByTestId("status-detail-runs")).toBeDefined();
    expect(getByTestId("status-detail-trend")).toBeDefined();
  });

  it("forwards probeId into useProbeDetail", () => {
    mockUseProbeDetail.mockReturnValue({
      data: null,
      error: null,
      loading: true,
    });
    render(<StatusDetailPanel probeId="deep" onClose={() => {}} />);
    expect(mockUseProbeDetail).toHaveBeenCalledWith("deep");
  });

  it("invokes onClose when the close button is clicked", () => {
    mockUseProbeDetail.mockReturnValue({
      data: { probe: probe(), runs: [] },
      error: null,
      loading: false,
    });
    const onClose = vi.fn();
    const { getByTestId } = render(
      <StatusDetailPanel probeId="smoke" onClose={onClose} />,
    );
    fireEvent.click(getByTestId("status-detail-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
