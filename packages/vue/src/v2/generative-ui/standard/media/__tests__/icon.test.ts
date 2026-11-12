import { waitFor } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import { renderInColumn } from "./helpers";

// The Icon cases of Angular's `standard/media/__tests__/icon.spec.ts` that
// React's suites do not have. The cases both have are in `media.test.ts`.
vi.mock("lucide-vue-next", () => import("./fake-lucide"));

/** The rendered Lucide icon of `name`, once the icon set has loaded. */
async function findLucideIcon(container: Element, name: string) {
  return waitFor(() => {
    const icon = container.querySelector(`svg.lucide-${name}`);
    if (!icon) throw new Error(`no ${name} icon`);
    return icon;
  });
}

describe("Icon", () => {
  it("loads a lucide Icon on first use and hides it from screen readers", async () => {
    const view = renderInColumn({
      id: "i",
      component: "Icon",
      name: "arrow-right",
    });
    const icon = await findLucideIcon(view.container, "arrow-right");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("width")).toBe("20");
    expect(icon.getAttribute("stroke")).toBe("currentColor");
    expect(icon.querySelectorAll("path")).toHaveLength(2);
    expect(icon.querySelector("path")?.namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );
  });

  it("names an Icon with a label for screen readers", async () => {
    // "arrowForward" is an A2UI name, mapped to the lucide arrow.
    const view = renderInColumn({
      id: "l",
      component: "Icon",
      name: "arrowForward",
      label: "Next",
      size: "lg",
    });
    const named = await findLucideIcon(view.container, "arrow-right");
    expect(named.getAttribute("role")).toBe("img");
    expect(named.getAttribute("aria-label")).toBe("Next");
    expect(named.getAttribute("aria-hidden")).toBeNull();
    expect(named.getAttribute("width")).toBe("24");
  });

  it("draws an svgPath icon with a fill, named by the envelope label", async () => {
    const view = renderInColumn({
      id: "p",
      component: "Icon",
      name: { svgPath: "M0 0h24v24H0z" },
      color: "danger",
      accessibility: { label: "Alert" },
    });
    const icon = await view.findByRole("img", { name: "Alert" });
    expect(icon.getAttribute("fill")).toBe(
      "var(--a2ui-color-text-danger, #c1322c)",
    );
    expect(icon.querySelector("path")?.getAttribute("d")).toBe("M0 0h24v24H0z");
  });
});
