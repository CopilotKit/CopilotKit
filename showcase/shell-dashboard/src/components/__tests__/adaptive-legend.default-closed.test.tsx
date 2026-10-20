/**
 * The legend is `position: fixed` and 152px tall while the grid reserves only
 * `pb-12` (48px) beneath it. Open by default, at 1440x900 and maximum scroll it
 * covered 42 of the 84 starter cells — the Chat and Interaction rows were
 * unreachable, and nothing on screen hinted that the legend could be collapsed.
 *
 * So it starts CLOSED. It is still one click from open; this pins the DEFAULT,
 * not the reachability.
 *
 * (The fixed-height / scroll-padding mismatch is a separate defect and is NOT
 * fixed by this: the grid's bottom padding is still a hardcoded value rather
 * than the legend's measured height.)
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { AdaptiveLegend } from "@/components/adaptive-legend";
import type { Overlay } from "@/lib/overlay-types";

const OVERLAYS = new Set<Overlay>(["health"]);

afterEach(cleanup);

describe("AdaptiveLegend default state", () => {
  it("renders CLOSED on first mount — no legend body, only the toggle", () => {
    render(<AdaptiveLegend overlays={OVERLAYS} />);

    expect(screen.getByRole("button", { name: /legend/i })).toBeTruthy();
    expect(document.querySelectorAll("[data-glyph]").length).toBe(0);
  });

  it("one click opens it — closed is a default, not a forced state", () => {
    render(<AdaptiveLegend overlays={OVERLAYS} />);
    fireEvent.click(screen.getByRole("button", { name: /legend/i }));

    expect(document.querySelectorAll("[data-glyph]").length).toBeGreaterThan(0);
  });
});
