/**
 * Unit tests for TallyTrigger / TallyBreakdownPopover.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { TallyTrigger } from "../tally-breakdown";
import type { TallyItem } from "@/components/tally-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItems(count: number, tone?: string): TallyItem[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `Feature ${tone ?? ""}${i + 1}`,
    dimension: i % 2 === 0 ? ("health" as const) : ("e2e" as const),
    featureId: `feat-${i + 1}`,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TallyTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children inside inert button wrapper when items is empty", () => {
    const { getByText, getByTestId } = render(
      <TallyTrigger items={[]} tone="green">
        <span>✓ 5</span>
      </TallyTrigger>,
    );

    expect(getByText("✓ 5")).toBeInTheDocument();
    // Always renders same DOM structure (div > button) to avoid hydration mismatch
    const trigger = getByTestId("tally-trigger-green");
    expect(trigger).toBeInTheDocument();
    expect(trigger.className).not.toContain("cursor-pointer");
  });

  it("renders button wrapper when items are provided", () => {
    const items = makeItems(3, "green");
    const { getByTestId, getByText } = render(
      <TallyTrigger items={items} tone="green">
        <span>✓ 3</span>
      </TallyTrigger>,
    );

    expect(getByText("✓ 3")).toBeInTheDocument();
    expect(getByTestId("tally-trigger-green")).toBeInTheDocument();
  });

  it("opens popover on click and shows items", () => {
    const items = makeItems(2, "amber");
    const { getByTestId, getByText, queryByTestId } = render(
      <TallyTrigger items={items} tone="amber">
        <span>~ 2</span>
      </TallyTrigger>,
    );

    // Popover not visible initially
    expect(queryByTestId("tally-popover")).not.toBeInTheDocument();

    // Click opens it
    fireEvent.click(getByTestId("tally-trigger-amber"));
    expect(getByTestId("tally-popover")).toBeInTheDocument();

    // Items rendered
    expect(getByText("Feature amber1")).toBeInTheDocument();
    expect(getByText("Feature amber2")).toBeInTheDocument();
  });

  it("shows correct item count in the popover", () => {
    const items = makeItems(4, "red");
    const { getByTestId } = render(
      <TallyTrigger items={items} tone="red">
        <span>✗ 4</span>
      </TallyTrigger>,
    );

    fireEvent.click(getByTestId("tally-trigger-red"));
    const popover = getByTestId("tally-popover");
    const listItems = popover.querySelectorAll("li");
    expect(listItems.length).toBe(4);
  });

  it("displays dimension tags on items", () => {
    const items: TallyItem[] = [
      { label: "Health Signal", dimension: "health", featureId: "h1" },
      { label: "E2E Signal", dimension: "e2e", featureId: "e1" },
    ];
    const { getByTestId, getByText } = render(
      <TallyTrigger items={items} tone="green">
        <span>✓ 2</span>
      </TallyTrigger>,
    );

    fireEvent.click(getByTestId("tally-trigger-green"));
    expect(getByText("health")).toBeInTheDocument();
    expect(getByText("e2e")).toBeInTheDocument();
  });

  it("closes popover on click-outside", () => {
    const items = makeItems(1, "green");
    const { getByTestId, queryByTestId } = render(
      <div>
        <div data-testid="outside">outside</div>
        <TallyTrigger items={items} tone="green">
          <span>✓ 1</span>
        </TallyTrigger>
      </div>,
    );

    // Open the popover
    fireEvent.click(getByTestId("tally-trigger-green"));
    expect(getByTestId("tally-popover")).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(getByTestId("outside"));
    expect(queryByTestId("tally-popover")).not.toBeInTheDocument();
  });

  it("does not open popover on click when items is empty", () => {
    const { getByText, getByTestId, queryByTestId } = render(
      <TallyTrigger items={[]} tone="red">
        <span>✗ 0</span>
      </TallyTrigger>,
    );

    expect(getByText("✗ 0")).toBeInTheDocument();
    // Button wrapper exists (stable DOM) but clicking does not open popover
    const trigger = getByTestId("tally-trigger-red");
    fireEvent.click(trigger);
    expect(queryByTestId("tally-popover")).not.toBeInTheDocument();
  });

  it("toggles popover closed on second click (pin/unpin)", () => {
    const items = makeItems(1, "amber");
    const { getByTestId, queryByTestId } = render(
      <TallyTrigger items={items} tone="amber">
        <span>~ 1</span>
      </TallyTrigger>,
    );

    const trigger = getByTestId("tally-trigger-amber");

    // First click opens
    fireEvent.click(trigger);
    expect(getByTestId("tally-popover")).toBeInTheDocument();

    // Second click closes
    fireEvent.click(trigger);
    expect(queryByTestId("tally-popover")).not.toBeInTheDocument();
  });

  it("opens popover on hover after delay", () => {
    const items = makeItems(1, "green");
    const { getByTestId, queryByTestId } = render(
      <TallyTrigger items={items} tone="green">
        <span>✓ 1</span>
      </TallyTrigger>,
    );

    const trigger = getByTestId("tally-trigger-green");
    const container = trigger.parentElement!;

    // Mouse enter
    fireEvent.mouseEnter(container);
    // Not open yet (200ms delay)
    expect(queryByTestId("tally-popover")).not.toBeInTheDocument();

    // Advance past delay
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(getByTestId("tally-popover")).toBeInTheDocument();
  });

  it("closes hover-opened popover on mouse leave", () => {
    const items = makeItems(1, "green");
    const { getByTestId, queryByTestId } = render(
      <TallyTrigger items={items} tone="green">
        <span>✓ 1</span>
      </TallyTrigger>,
    );

    const trigger = getByTestId("tally-trigger-green");
    const container = trigger.parentElement!;

    // Hover open
    fireEvent.mouseEnter(container);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(getByTestId("tally-popover")).toBeInTheDocument();

    // Mouse leave should close after 150ms (not pinned)
    fireEvent.mouseLeave(container);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(queryByTestId("tally-popover")).not.toBeInTheDocument();
  });
});
