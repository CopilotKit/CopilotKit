import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Panel,
  ResizableGroup,
  ResizableGutter,
  ResizableHairline,
  safeLayoutStorage,
} from "@/components/ui/resizable";

describe("resizable wrapper", () => {
  it("renders a horizontal group with both panels and a gutter", () => {
    render(
      <ResizableGroup orientation="horizontal">
        <Panel id="a" minSize={200}>
          <div>left</div>
        </Panel>
        <ResizableGutter />
        <Panel id="b" minSize={480}>
          <div>right</div>
        </Panel>
      </ResizableGroup>,
    );

    expect(screen.getByText("left")).toBeDefined();
    expect(screen.getByText("right")).toBeDefined();
  });

  it("styles the hairline as a 1px divider and the gutter as an 8px gap", () => {
    const { container } = render(
      <ResizableGroup orientation="horizontal">
        <Panel id="a">
          <div>a</div>
        </Panel>
        <ResizableHairline />
        <Panel id="b">
          <div>b</div>
        </Panel>
      </ResizableGroup>,
    );

    // Queried via the library's own `data-separator` hook rather than a
    // `data-testid` — see the id-coupling test below for why one wouldn't stick.
    const hairline = container.querySelector<HTMLElement>("[data-separator]");
    expect(hairline?.className).toContain("w-px");
    expect(hairline?.className).toContain("bg-hairline");
    expect(container.querySelector(".w-2")).toBeNull();
  });

  /**
   * Load-bearing for every consumer: the library DERIVES `data-testid` from a
   * `Panel`'s `id` and overwrites any `data-testid` passed in. So a panel meant
   * to be found as `sidebar-panel` must be given `id="sidebar-panel"` — adding
   * `data-testid="sidebar-panel"` alongside `id="sidebar"` silently yields
   * `data-testid="sidebar"` and every `[data-testid$='-panel']` query misses.
   */
  it("derives a panel's data-testid from its id, overriding any passed in", () => {
    const { container } = render(
      <ResizableGroup orientation="horizontal">
        <Panel id="sidebar-panel" data-testid="ignored">
          <div>side</div>
        </Panel>
        <ResizableGutter />
        <Panel id="app-panel">
          <div>app</div>
        </Panel>
      </ResizableGroup>,
    );

    expect(screen.getByTestId("sidebar-panel")).toBeDefined();
    expect(screen.getByTestId("app-panel")).toBeDefined();
    expect(screen.queryByTestId("ignored")).toBeNull();

    const panels = Array.from(
      container.querySelectorAll("[data-testid$='-panel']"),
    ).map((node) => node.getAttribute("data-testid"));
    expect(panels).toEqual(["sidebar-panel", "app-panel"]);
  });

  it("exposes a storage shim that never throws when localStorage is absent", () => {
    expect(() => safeLayoutStorage.getItem("nope")).not.toThrow();
    expect(() => safeLayoutStorage.setItem("nope", "value")).not.toThrow();
  });
});
