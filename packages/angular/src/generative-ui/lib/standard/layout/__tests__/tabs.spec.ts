import { describe, expect, it } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { ui } from "./helpers";

describe("standard layout", () => {
  it("renders Tabs with one panel at a time and switches on click and arrow keys", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Tabs",
        tabs: [
          { title: "Specs", child: "specs" },
          { title: "Reviews", child: "reviews" },
        ],
      },
      { id: "specs", component: "Label", text: "The specs" },
      { id: "reviews", component: "Label", text: "The reviews" },
    ]);
    const tabs = [
      ...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "Specs",
      "Reviews",
    ]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.tabIndex).toBe(0);
    expect(tabs[1]!.tabIndex).toBe(-1);
    expect(
      view.container.querySelector('[role="tabpanel"]')?.textContent?.trim(),
    ).toBe("The specs");
    view.act(() => tabs[1]!.click());
    expect(
      view.container.querySelector('[role="tabpanel"]')?.textContent?.trim(),
    ).toBe("The reviews");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    const list = view.container.querySelector<HTMLElement>('[role="tablist"]')!;
    view.act(() =>
      list.dispatchEvent(
        // CDK's key manager reads keyCode.
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          keyCode: 39,
          bubbles: true,
        } as KeyboardEventInit),
      ),
    );
    // Wraps around to the first tab.
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(
      view.container.querySelector('[role="tabpanel"]')?.textContent?.trim(),
    ).toBe("The specs");
  });

  it("writes the selected tab to a bound selectedIndex", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Tabs",
          selectedIndex: { "@path": "/tab" },
          tabs: [
            { title: "A", child: "a" },
            { title: "B", child: "b" },
          ],
        },
        { id: "a", component: "Label", text: "Panel A" },
        { id: "b", component: "Label", text: "Panel B" },
      ],
      { tab: 1 },
    );
    expect(
      view.container.querySelector('[role="tabpanel"]')?.textContent?.trim(),
    ).toBe("Panel B");
    const tabs = [
      ...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ];
    view.act(() => tabs[0]!.click());
    expect(view.dataAt("/tab")).toBe(0);
    expect(
      view.container.querySelector('[role="tabpanel"]')?.textContent?.trim(),
    ).toBe("Panel A");
  });
});
