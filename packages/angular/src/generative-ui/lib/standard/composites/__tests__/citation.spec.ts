import { describe, expect, it } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { buttonNamed, ui } from "./helpers";

describe("standard catalog: composites", () => {
  it("Citation shows its source on click", () => {
    const v = renderSurface(ui, [
      { id: "root", component: "Row", children: ["t", "c"] },
      { id: "t", component: "Label", text: "Vienna has 1.9M people" },
      {
        id: "c",
        component: "Citation",
        index: 2,
        title: "Vienna population",
        url: "https://en.wikipedia.org/wiki/Vienna",
        snippet: "1.9 million inhabitants",
      },
    ]);
    const marker = buttonNamed(v.container, "Source 2")!;
    expect(marker.textContent?.trim()).toBe("2");
    expect(v.container.textContent).not.toContain("Vienna population");
    v.act(() => marker.click());
    const panel = v.container.querySelector(
      "[data-a2ui-citation] [role=dialog]",
    )!;
    expect(panel.textContent).toContain("Vienna population");
    expect(panel.textContent).toContain("1.9 million inhabitants");
    expect(panel.textContent).toContain("en.wikipedia.org");
    expect(panel.querySelector("a")?.getAttribute("href")).toBe(
      "https://en.wikipedia.org/wiki/Vienna",
    );
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    v.act(() =>
      document.body.dispatchEvent(new Event("mousedown", { bubbles: true })),
    );
    expect(v.container.querySelector("[role=dialog]")).toBeNull();
  });
});
