/**
 * Unit tests for StatusTab — composes the schedule table + running panel
 * and exposes a trigger callback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { StatusTab } from "./status-tab";
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
    nextRunAt: new Date(NOW + 60_000).toISOString(),
    lastRun: null,
    inflight: null,
    config: { timeout_ms: 30000, max_concurrency: 4, discovery: null },
    ...overrides,
  };
}

describe("StatusTab", () => {
  it("renders schedule table and running panel", () => {
    const { getByTestId } = render(
      <StatusTab entries={[entry()]} onTrigger={async () => {}} />,
    );
    expect(getByTestId("status-table")).toBeDefined();
    expect(getByTestId("status-running-panel")).toBeDefined();
  });

  it("forwards trigger callback when row trigger is invoked", async () => {
    const onTrigger = vi.fn(async () => {});
    const { getByTestId, getByText } = render(
      <StatusTab entries={[entry()]} onTrigger={onTrigger} />,
    );
    fireEvent.click(getByTestId("status-trigger-smoke"));
    fireEvent.click(getByText("Run all"));
    expect(onTrigger).toHaveBeenCalledWith("smoke", undefined);
  });

  it("renders idle panel when no entries provided", () => {
    const { getByTestId } = render(
      <StatusTab entries={[]} onTrigger={async () => {}} />,
    );
    expect(getByTestId("running-idle")).toBeDefined();
  });
});
