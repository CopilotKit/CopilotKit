/**
 * Unit tests for StatusRunningPanel — the "currently running" card and
 * idle fallback message.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { StatusRunningPanel } from "./status-running-panel";
import type { ProbeScheduleEntry } from "./status-tab";

const NOW = new Date("2026-04-25T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function inflightEntry(): ProbeScheduleEntry {
  return {
    id: "smoke",
    kind: "smoke",
    schedule: "0 */6 * * *",
    nextRunAt: null,
    lastRun: null,
    inflight: {
      startedAt: new Date(NOW - 90_000).toISOString(),
      elapsedMs: 90_000,
      services: [
        { slug: "next-langgraph-py", state: "completed", result: "green" },
        { slug: "next-langgraph-js", state: "running" },
        { slug: "next-crewai", state: "queued" },
        { slug: "next-mastra", state: "failed", result: "red" },
      ],
    },
    config: { timeout_ms: 30000, max_concurrency: 4, discovery: null },
  };
}

function idleEntry(): ProbeScheduleEntry {
  return {
    id: "smoke",
    kind: "smoke",
    schedule: "0 */6 * * *",
    nextRunAt: new Date(NOW + 7 * 60_000).toISOString(),
    lastRun: null,
    inflight: null,
    config: { timeout_ms: 30000, max_concurrency: 4, discovery: null },
  };
}

describe("StatusRunningPanel", () => {
  it("renders running card when a probe is inflight", () => {
    const { getByTestId } = render(
      <StatusRunningPanel entries={[inflightEntry()]} />,
    );
    expect(getByTestId("running-card-smoke")).toBeDefined();
  });

  it("shows elapsed time text", () => {
    const { getByTestId } = render(
      <StatusRunningPanel entries={[inflightEntry()]} />,
    );
    const card = getByTestId("running-card-smoke");
    expect(card.textContent).toMatch(/running.*1m\s+30s\s+elapsed/);
  });

  it("renders progress bar with completed/total", () => {
    const { getByTestId } = render(
      <StatusRunningPanel entries={[inflightEntry()]} />,
    );
    const bar = getByTestId("running-progress-smoke");
    // 1 completed + 1 failed = 2 done out of 4
    expect(bar.getAttribute("data-completed")).toBe("2");
    expect(bar.getAttribute("data-total")).toBe("4");
  });

  it("renders per-service grid with state markers", () => {
    const { getByTestId } = render(
      <StatusRunningPanel entries={[inflightEntry()]} />,
    );
    expect(
      getByTestId("running-service-smoke-next-langgraph-py").getAttribute(
        "data-state",
      ),
    ).toBe("completed");
    expect(
      getByTestId("running-service-smoke-next-langgraph-js").getAttribute(
        "data-state",
      ),
    ).toBe("running");
    expect(
      getByTestId("running-service-smoke-next-crewai").getAttribute(
        "data-state",
      ),
    ).toBe("queued");
    expect(
      getByTestId("running-service-smoke-next-mastra").getAttribute(
        "data-state",
      ),
    ).toBe("failed");
  });

  it("renders idle message when nothing is inflight", () => {
    const { getByTestId } = render(
      <StatusRunningPanel entries={[idleEntry()]} />,
    );
    const idle = getByTestId("running-idle");
    expect(idle.textContent).toContain("All probes idle");
    expect(idle.textContent).toContain("smoke");
    expect(idle.textContent).toMatch(/in\s+7m/);
  });

  it("idle message handles empty entries list", () => {
    const { getByTestId } = render(<StatusRunningPanel entries={[]} />);
    expect(getByTestId("running-idle")).toBeDefined();
  });

  it("idle message ignores past nextRunAt and shows no-upcoming sentinel", () => {
    // CR-B2.1: when only entry has a past nextRunAt, banner must NOT
    // say "5m ago" — it should fall back to the "no upcoming runs"
    // sentinel rather than reporting a nonsensical past time.
    const past: ProbeScheduleEntry = {
      id: "smoke",
      kind: "smoke",
      schedule: "0 */6 * * *",
      nextRunAt: new Date(NOW - 5 * 60_000).toISOString(),
      lastRun: null,
      inflight: null,
      config: { timeout_ms: 30000, max_concurrency: 4, discovery: null },
    };
    const { getByTestId } = render(<StatusRunningPanel entries={[past]} />);
    const idle = getByTestId("running-idle");
    expect(idle.textContent).not.toMatch(/ago/);
    expect(idle.textContent).toContain("No upcoming runs scheduled");
  });
});
