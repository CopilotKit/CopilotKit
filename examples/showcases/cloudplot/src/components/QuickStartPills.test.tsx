// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QUICK_STARTS } from "@/lib/quickStarts";
import { QuickStartPills } from "./QuickStartPills";

describe("QuickStartPills", () => {
  afterEach(cleanup);

  it("renders each product quick start and submits its exact prompt", () => {
    const onSelect = vi.fn(async () => undefined);
    render(<QuickStartPills onSelect={onSelect} />);

    for (const quickStart of QUICK_STARTS) {
      fireEvent.click(screen.getByRole("button", { name: quickStart.label }));
      expect(onSelect).toHaveBeenLastCalledWith(quickStart.prompt);
    }
    expect(onSelect).toHaveBeenCalledTimes(QUICK_STARTS.length);
  });

  it("shows an agent execution failure instead of dropping the rejection", async () => {
    const onSelect = vi
      .fn()
      .mockRejectedValue(new Error("CloudPlot agent unavailable"));
    render(<QuickStartPills onSelect={onSelect} />);

    fireEvent.click(
      screen.getByRole("button", { name: QUICK_STARTS[0].label }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "CloudPlot agent unavailable",
      ),
    );
  });
});
