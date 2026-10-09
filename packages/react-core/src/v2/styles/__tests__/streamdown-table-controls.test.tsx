/**
 * #5775: CopilotKit ships scoped fallback CSS for streamdown's table action
 * controls (copy / download), which render with raw Tailwind utilities and no
 * stable `data-streamdown` attribute. The CSS therefore targets them
 * structurally: `[data-streamdown="table-wrapper"] > div:first-child:not(:last-child)`.
 *
 * A source-string test (streamdown-styles.test.ts) guards that the selectors
 * exist. This DOM test guards the OTHER half: that streamdown actually renders
 * the structure those selectors assume. If streamdown changes its table-controls
 * markup (adds a data-streamdown attribute, reorders/renests the children), this
 * fails — signalling the scoped CSS must be revisited.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Streamdown } from "streamdown";

const TABLE_MARKDOWN = ["| A | B |", "| - | - |", "| 1 | 2 |", ""].join("\n");

describe("Streamdown table controls DOM (#5775)", () => {
  it("renders a controls row as table-wrapper's first (non-only) child, matching the scoped selector", () => {
    const { container } = render(
      <div data-copilotkit="">
        <Streamdown>{TABLE_MARKDOWN}</Streamdown>
      </div>,
    );

    // The outer wrapper is the first [data-streamdown="table-wrapper"] in
    // document order (a streamdown quirk in 1.6.11 also stamps that value on the
    // <table> element itself, so match the DIV specifically).
    const wrapper = container.querySelector(
      'div[data-streamdown="table-wrapper"]',
    );
    expect(wrapper).not.toBeNull();

    // The table scroll container is the last child and holds the <table>.
    expect(
      wrapper!.querySelector(":scope > div:last-child table"),
    ).not.toBeNull();

    // The controls row is the first child AND distinct from the last child —
    // exactly what `> div:first-child:not(:last-child)` scopes.
    const controlsRow = wrapper!.querySelector(
      ":scope > div:first-child:not(:last-child)",
    );
    expect(controlsRow).not.toBeNull();

    // It has no data-streamdown attribute (the reason we target it structurally)
    expect(controlsRow!.getAttribute("data-streamdown")).toBeNull();

    // ...and it contains the copy/download trigger buttons the CSS styles, each
    // wrapped in a positioned <div> (matching `> div > button`).
    const triggerButtons = controlsRow!.querySelectorAll(
      ":scope > div > button",
    );
    expect(triggerButtons.length).toBeGreaterThanOrEqual(1);
  });
});
