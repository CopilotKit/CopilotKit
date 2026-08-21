// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QUICK_STARTS } from "@/lib/quickStarts";
import { QuickStartPills } from "./QuickStartPills";

describe("QuickStartPills", () => {
  afterEach(cleanup);

  it("renders each product quick start and submits its exact prompt", () => {
    const onSelect = vi.fn();
    render(<QuickStartPills onSelect={onSelect} />);

    for (const quickStart of QUICK_STARTS) {
      fireEvent.click(screen.getByRole("button", { name: quickStart.label }));
      expect(onSelect).toHaveBeenLastCalledWith(quickStart.prompt);
    }
    expect(onSelect).toHaveBeenCalledTimes(QUICK_STARTS.length);
  });
});
