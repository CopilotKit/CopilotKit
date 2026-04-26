/**
 * Unit tests for StatusRunsList — renders the recent-runs table that appears
 * inside the probe-detail panel. Covers empty state, populated rows, state
 * badge tones, the "manual" chip when triggered=true, and the summary
 * fallback when summary is null.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { StatusRunsList } from "./status-runs-list";
import type { ProbeRun } from "../lib/ops-api";

const NOW = new Date("2026-04-25T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
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
    summary: { total: 17, passed: 14, failed: 3 },
    ...overrides,
  };
}

describe("StatusRunsList", () => {
  it("renders empty-state message when runs is empty", () => {
    const { getByTestId } = render(<StatusRunsList runs={[]} />);
    expect(getByTestId("status-runs-empty")).toBeDefined();
    expect(getByTestId("status-runs-empty").textContent).toMatch(
      /No runs recorded/i,
    );
  });

  it("renders one row per run", () => {
    const runs = [run({ id: "a" }), run({ id: "b" }), run({ id: "c" })];
    const { getAllByTestId } = render(<StatusRunsList runs={runs} />);
    // Match the row containers exactly — the cells use suffixes like
    // -state / -trigger / -summary that we don't want to count here.
    expect(
      getAllByTestId(/^status-run-row-[a-z]+$/).length,
    ).toBe(3);
  });

  it("renders relative started time, formatted duration, and pass/total", () => {
    const { getByTestId } = render(<StatusRunsList runs={[run({ id: "a" })]} />);
    const row = getByTestId("status-run-row-a");
    // 5 minutes ago
    expect(row.textContent).toMatch(/5m\s+ago/);
    // 60_000 ms → "1m 0s"
    expect(row.textContent).toMatch(/1m\s+0s/);
    expect(row.textContent).toContain("14/17 pass");
  });

  it("renders em-dash for summary when null", () => {
    const { getByTestId } = render(
      <StatusRunsList runs={[run({ id: "a", summary: null })]} />,
    );
    const cell = getByTestId("status-run-row-a-summary");
    expect(cell.textContent).toBe("—");
  });

  it("badges completed runs with green tone", () => {
    const r = run({
      id: "a",
      finishedAt: new Date(NOW).toISOString(),
      summary: { total: 17, passed: 17, failed: 0 },
    });
    const { getByTestId } = render(<StatusRunsList runs={[r]} />);
    const badge = getByTestId("status-run-row-a-state");
    expect(badge.getAttribute("data-tone")).toBe("green");
    expect(badge.textContent?.toLowerCase()).toContain("completed");
  });

  it("badges failed runs (any failed in summary) with red tone", () => {
    const r = run({
      id: "a",
      finishedAt: new Date(NOW).toISOString(),
      summary: { total: 17, passed: 14, failed: 3 },
    });
    const { getByTestId } = render(<StatusRunsList runs={[r]} />);
    const badge = getByTestId("status-run-row-a-state");
    expect(badge.getAttribute("data-tone")).toBe("red");
    expect(badge.textContent?.toLowerCase()).toContain("failed");
  });

  it("badges in-flight runs (no finishedAt) with running tone", () => {
    const r = run({
      id: "a",
      finishedAt: null,
      durationMs: null,
      summary: null,
    });
    const { getByTestId } = render(<StatusRunsList runs={[r]} />);
    const badge = getByTestId("status-run-row-a-state");
    expect(badge.getAttribute("data-tone")).toBe("running");
    expect(badge.textContent?.toLowerCase()).toContain("running");
  });

  it("renders manual chip when triggered=true", () => {
    const { getByTestId } = render(
      <StatusRunsList runs={[run({ id: "a", triggered: true })]} />,
    );
    expect(getByTestId("status-run-row-a-trigger").textContent).toMatch(
      /manual/i,
    );
  });

  it("omits manual chip text when triggered=false", () => {
    const { getByTestId } = render(
      <StatusRunsList runs={[run({ id: "a", triggered: false })]} />,
    );
    const cell = getByTestId("status-run-row-a-trigger");
    // Empty cell — no "manual" text
    expect(cell.textContent?.toLowerCase()).not.toContain("manual");
  });

  it("uses unknown label and gray tone when finished but no summary", () => {
    // CR-B2.2: tone/label semantics must agree. A run with finishedAt
    // set but summary === null was previously rendering as a gray badge
    // labeled "completed" — exactly the misleading combo runTone() was
    // designed to avoid. Both must say "unknown" together.
    const r = run({
      id: "a",
      finishedAt: new Date(NOW).toISOString(),
      summary: null,
    });
    const { getByTestId } = render(<StatusRunsList runs={[r]} />);
    const badge = getByTestId("status-run-row-a-state");
    expect(badge.getAttribute("data-tone")).toBe("gray");
    expect(badge.textContent?.toLowerCase()).toContain("unknown");
    expect(badge.textContent?.toLowerCase()).not.toContain("completed");
  });
});
