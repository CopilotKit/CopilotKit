/**
 * Unit tests for StatusTable — renders probe schedule rows with humanized
 * cron, relative times, last-run color coding, and trigger actions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { StatusTable } from "./status-table";
import type { ProbeScheduleEntry } from "./status-tab";

const NOW = new Date("2026-04-25T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function entry(
  overrides: Partial<ProbeScheduleEntry> = {},
): ProbeScheduleEntry {
  return {
    id: "smoke",
    kind: "smoke",
    schedule: "0 */6 * * *",
    nextRunAt: new Date(NOW + 4 * 3600_000 + 23 * 60_000).toISOString(),
    lastRun: {
      startedAt: new Date(NOW - 1 * 3600_000 - 37 * 60_000).toISOString(),
      finishedAt: new Date(NOW - 1 * 3600_000 - 30 * 60_000).toISOString(),
      durationMs: 7 * 60_000,
      state: "completed",
      summary: { total: 17, passed: 14, failed: 3 },
    },
    inflight: null,
    config: { timeout_ms: 30000, max_concurrency: 4, discovery: null },
    ...overrides,
  };
}

describe("StatusTable", () => {
  it("renders a row per entry with probe id", () => {
    const entries = [entry({ id: "smoke" }), entry({ id: "deep" })];
    const { getByTestId } = render(
      <StatusTable entries={entries} onTrigger={async () => {}} />,
    );
    expect(getByTestId("status-row-smoke")).toBeDefined();
    expect(getByTestId("status-row-deep")).toBeDefined();
  });

  it("humanizes a 6-hour cron schedule", () => {
    const { getByTestId } = render(
      <StatusTable
        entries={[entry({ schedule: "0 */6 * * *" })]}
        onTrigger={async () => {}}
      />,
    );
    expect(getByTestId("status-row-smoke").textContent).toContain("Every 6h");
  });

  it("renders relative next-run time", () => {
    const { getByTestId } = render(
      <StatusTable entries={[entry()]} onTrigger={async () => {}} />,
    );
    const row = getByTestId("status-row-smoke");
    expect(row.textContent).toMatch(/in\s+4h\s+23m/);
  });

  it("renders relative last-run time", () => {
    const { getByTestId } = render(
      <StatusTable entries={[entry()]} onTrigger={async () => {}} />,
    );
    const row = getByTestId("status-row-smoke");
    expect(row.textContent).toMatch(/1h\s+37m\s+ago/);
  });

  it("color-codes last-run green when all passed", () => {
    const e = entry({
      lastRun: {
        startedAt: new Date(NOW - 60_000).toISOString(),
        finishedAt: new Date(NOW - 30_000).toISOString(),
        durationMs: 30_000,
        state: "completed",
        summary: { total: 17, passed: 17, failed: 0 },
      },
    });
    const { getByTestId } = render(
      <StatusTable entries={[e]} onTrigger={async () => {}} />,
    );
    expect(
      getByTestId("status-row-smoke-result").getAttribute("data-tone"),
    ).toBe("green");
  });

  it("color-codes last-run red when any failed", () => {
    const { getByTestId } = render(
      <StatusTable entries={[entry()]} onTrigger={async () => {}} />,
    );
    expect(
      getByTestId("status-row-smoke-result").getAttribute("data-tone"),
    ).toBe("red");
  });

  it("color-codes last-run gray when never run", () => {
    const e = entry({ lastRun: null });
    const { getByTestId } = render(
      <StatusTable entries={[e]} onTrigger={async () => {}} />,
    );
    expect(
      getByTestId("status-row-smoke-result").getAttribute("data-tone"),
    ).toBe("gray");
  });

  it("renders pass/total summary text", () => {
    const { getByTestId } = render(
      <StatusTable entries={[entry()]} onTrigger={async () => {}} />,
    );
    expect(getByTestId("status-row-smoke-result").textContent).toContain(
      "14/17 pass",
    );
  });

  it("trigger button is rendered per row", () => {
    const { getByTestId } = render(
      <StatusTable entries={[entry()]} onTrigger={async () => {}} />,
    );
    expect(getByTestId("status-trigger-smoke")).toBeDefined();
  });

  it("relative times tick forward each second", () => {
    const { getByTestId } = render(
      <StatusTable entries={[entry()]} onTrigger={async () => {}} />,
    );
    const before = getByTestId("status-row-smoke").textContent;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const after = getByTestId("status-row-smoke").textContent;
    expect(after).not.toBe(before);
  });

  it("clicking trigger button opens menu with Run all and Run specific", () => {
    const { getByTestId, getByText } = render(
      <StatusTable entries={[entry()]} onTrigger={async () => {}} />,
    );
    fireEvent.click(getByTestId("status-trigger-smoke"));
    expect(getByText("Run all")).toBeDefined();
    expect(getByText(/Run specific/i)).toBeDefined();
  });
});
