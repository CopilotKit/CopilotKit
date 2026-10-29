import { describe, expect, it } from "vitest";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { renderSurface } from "../../../__tests__/render";
import { standardUI } from "../../index";
import { byText, click, query } from "./helpers";

/** Tests ported from the a2ui-renderer standard catalog, on the full catalog. */
describe("standard catalog: feedback (parity)", () => {
  const render = (
    components: A2UIComponentNode[],
    data?: Record<string, unknown>,
  ) => renderSurface(standardUI, components, data);

  it("Popover sideOffset moves the content and a block trigger fills the width", () => {
    const v = render([
      { id: "root", component: "Popover", children: ["t", "c"] },
      { id: "t", component: "PopoverTrigger", block: true, children: ["b"] },
      { id: "b", component: "Text", text: "Toggle" },
      { id: "c", component: "PopoverContent", sideOffset: 12, children: ["x"] },
      { id: "x", component: "Text", text: "Body" },
    ]);
    const trigger = byText(v, "Toggle").closest<HTMLElement>(
      "[data-a2ui-popover-trigger]",
    )!;
    expect(trigger.style.width).toBe("100%");
    click(v, trigger);
    const dialog = query<HTMLElement>(v, "[role=dialog]");
    expect(dialog.style.marginTop).toBe("12px");
  });

  it("PulseIndicator takes endScale and startOpacity", () => {
    const v = render([
      { id: "root", component: "Column", children: ["p"] },
      {
        id: "p",
        component: "PulseIndicator",
        label: "Live",
        endScale: 3,
        startOpacity: 0.4,
      },
    ]);
    const pulse = query<HTMLElement>(v, '[aria-label="Live"]');
    const ring = pulse.querySelector<HTMLElement>("[data-a2ui-motion]")!;
    expect(ring.style.getPropertyValue("--a2ui-pulse-scale")).toBe("3");
    expect(ring.style.getPropertyValue("--a2ui-pulse-opacity")).toBe("0.4");
  });
});
