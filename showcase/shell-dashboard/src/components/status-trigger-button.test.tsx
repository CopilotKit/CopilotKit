/**
 * Unit tests for StatusTriggerButton — the per-row [Trigger] popover.
 *
 * Coverage: trigger popover open/close, "Run all" calls back with no slugs,
 * "Run specific..." entry hidden when no slugs are known (CR-B2.3 Option C),
 * picker behavior when slugs are present, and resilience to async rejection
 * from the onTrigger callback.
 */
import { describe, it, expect, vi } from "vitest";
import {
  render,
  fireEvent,
  act,
  waitFor,
  cleanup,
} from "@testing-library/react";
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

  it("renders error message when onTrigger rejects (R2-D.2)", async () => {
    // The dead state slot was discarded — operators got a silent no-op when
    // onTrigger threw. Now setLastError is read and rendered inline so the
    // error is observable in the UI rather than vanishing into a write-only
    // setter.
    const onTrigger = vi.fn().mockRejectedValue(new Error("network down"));
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
    await waitFor(() => {
      expect(getByTestId("status-trigger-error")).toBeDefined();
    });
    expect(getByTestId("status-trigger-error").textContent).toContain(
      "network down",
    );
  });

  it("intersects selected slugs when serviceSlugs prop shrinks (R2-D.3)", () => {
    // When the parent re-renders with a different slug list, any previously-
    // checked slug not in the new list must be dropped from `selected` so we
    // never POST stale slugs the parent no longer thinks are live.
    const { getByTestId, getByText, rerender } = render(
      <StatusTriggerButton
        probeId="smoke"
        serviceSlugs={["a", "b", "c"]}
        onTrigger={async () => {}}
      />,
    );
    fireEvent.click(getByTestId("status-trigger-smoke"));
    fireEvent.click(getByText(/Run specific/i));
    fireEvent.click(getByTestId("status-trigger-smoke-slug-b"));
    fireEvent.click(getByTestId("status-trigger-smoke-slug-c"));
    expect(getByText(/Run selected \(2\)/)).toBeDefined();
    // Parent shrinks slug list — selected should drop b and c, leaving zero.
    rerender(
      <StatusTriggerButton
        probeId="smoke"
        serviceSlugs={["a"]}
        onTrigger={async () => {}}
      />,
    );
    expect(getByText(/Run selected \(0\)/)).toBeDefined();
  });

  it("resets pickerOpen and selected when toggling menu closed via Trigger (R3-D.2)", () => {
    cleanup();
    const { getByTestId, getByText, queryByText } = render(
      <StatusTriggerButton
        probeId="smoke"
        serviceSlugs={["a", "b"]}
        onTrigger={async () => {}}
      />,
    );
    // Open menu, open picker, check a slug.
    fireEvent.click(getByTestId("status-trigger-smoke"));
    fireEvent.click(getByText(/Run specific/i));
    fireEvent.click(getByTestId("status-trigger-smoke-slug-a"));
    expect(
      (getByTestId("status-trigger-smoke-slug-a") as HTMLInputElement).checked,
    ).toBe(true);
    // Toggle the menu CLOSED via Trigger button — should reset pickerOpen and
    // selected for consistency with outside-click and Escape close paths.
    fireEvent.click(getByTestId("status-trigger-smoke"));
    expect(queryByText(/Run all/i)).toBeNull();
    // Reopen — picker should be closed (pickerOpen reset) and slug-a unchecked.
    fireEvent.click(getByTestId("status-trigger-smoke"));
    // Picker section should not be visible until "Run specific..." is clicked
    // again — assert by checking the slug checkbox is not in the DOM yet.
    expect(() => getByTestId("status-trigger-smoke-slug-a")).toThrow();
    // Now open picker explicitly — slug-a must be unchecked.
    fireEvent.click(getByText(/Run specific/i));
    expect(
      (getByTestId("status-trigger-smoke-slug-a") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("resets selected when menu closes via outside click (R2-D.3)", () => {
    cleanup();
    const { getByTestId, getByText, queryByText } = render(
      <div>
        <div data-testid="outside">outside</div>
        <StatusTriggerButton
          probeId="smoke"
          serviceSlugs={["a", "b"]}
          onTrigger={async () => {}}
        />
      </div>,
    );
    fireEvent.click(getByTestId("status-trigger-smoke"));
    fireEvent.click(getByText(/Run specific/i));
    fireEvent.click(getByTestId("status-trigger-smoke-slug-a"));
    expect(
      (getByTestId("status-trigger-smoke-slug-a") as HTMLInputElement).checked,
    ).toBe(true);
    // Click outside — menu closes AND selection resets.
    fireEvent.mouseDown(getByTestId("outside"));
    expect(queryByText(/Run all/i)).toBeNull();
    // Reopen — slug-a should not be checked.
    fireEvent.click(getByTestId("status-trigger-smoke"));
    fireEvent.click(getByText(/Run specific/i));
    expect(
      (getByTestId("status-trigger-smoke-slug-a") as HTMLInputElement).checked,
    ).toBe(false);
  });
});
