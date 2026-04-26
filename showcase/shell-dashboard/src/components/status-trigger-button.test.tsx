/**
 * Unit tests for StatusTriggerButton — the per-row [Trigger] popover.
 *
 * Coverage: trigger popover open/close, "Run all" calls back with no slugs,
 * "Run specific..." entry hidden when no slugs are known (CR-B2.3 Option C),
 * picker behavior when slugs are present, and resilience to async rejection
 * from the onTrigger callback.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { StatusTriggerButton } from "./status-trigger-button";

describe("StatusTriggerButton", () => {
  it("opens menu on click and shows Run all", () => {
    const { getByTestId, getByText } = render(
      <StatusTriggerButton
        probeId="smoke"
        serviceSlugs={["a", "b"]}
        onTrigger={async () => {}}
      />,
    );
    fireEvent.click(getByTestId("status-trigger-smoke"));
    expect(getByText("Run all")).toBeDefined();
  });

  it("calls onTrigger with no slugs for Run all", async () => {
    const onTrigger = vi.fn().mockResolvedValue(undefined);
    const { getByTestId, getByText } = render(
      <StatusTriggerButton
        probeId="smoke"
        serviceSlugs={["a", "b"]}
        onTrigger={onTrigger}
      />,
    );
    fireEvent.click(getByTestId("status-trigger-smoke"));
    await act(async () => {
      fireEvent.click(getByText("Run all"));
    });
    expect(onTrigger).toHaveBeenCalledWith("smoke", undefined);
  });

  it("hides Run specific... entry when no slugs are known (CR-B2.3 Option C)", () => {
    // Probe is idle and no inflight services — the parent passes an
    // empty slug list. We hide "Run specific..." entirely so the
    // operator only sees "Run all", which is the actionable path.
    const { getByTestId, queryByText, getByText } = render(
      <StatusTriggerButton
        probeId="smoke"
        serviceSlugs={[]}
        onTrigger={async () => {}}
      />,
    );
    fireEvent.click(getByTestId("status-trigger-smoke"));
    expect(getByText("Run all")).toBeDefined();
    expect(queryByText(/Run specific/i)).toBeNull();
  });

  it("shows Run specific... when slugs are known", () => {
    const { getByTestId, getByText } = render(
      <StatusTriggerButton
        probeId="smoke"
        serviceSlugs={["a"]}
        onTrigger={async () => {}}
      />,
    );
    fireEvent.click(getByTestId("status-trigger-smoke"));
    expect(getByText(/Run specific/i)).toBeDefined();
  });

  it("does not crash when onTrigger rejects", async () => {
    // CR-B2 bonus: async rejection should be caught locally so the
    // menu can close cleanly rather than surfacing an unhandled
    // rejection that masks the underlying error.
    const onTrigger = vi.fn().mockRejectedValue(new Error("boom"));
    const { getByTestId, getByText } = render(
      <StatusTriggerButton
        probeId="smoke"
        serviceSlugs={["a"]}
        onTrigger={onTrigger}
      />,
    );
    fireEvent.click(getByTestId("status-trigger-smoke"));
    await act(async () => {
      fireEvent.click(getByText("Run all"));
    });
    expect(onTrigger).toHaveBeenCalled();
  });
});
