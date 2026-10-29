import { describe, expect, it, vi } from "vitest";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { renderSurface } from "../../../__tests__/render";
import { standardUI } from "../../index";
import { byText, click, sentEventNames } from "./helpers";

/** Tests ported from the a2ui-renderer standard catalog, on the full catalog. */
describe("standard catalog: inputs (parity)", () => {
  const render = (
    components: A2UIComponentNode[],
    data?: Record<string, unknown>,
  ) => renderSurface(standardUI, components, data);

  it("Pressable and Form repeat a template child per data item", () => {
    const v = render(
      [
        { id: "root", component: "Column", children: ["p", "f"] },
        {
          id: "p",
          component: "Pressable",
          children: { componentId: "pr", path: "/a" },
        },
        { id: "pr", component: "Text", text: { "@path": "name" } },
        {
          id: "f",
          component: "Form",
          children: { componentId: "fr", path: "/b" },
        },
        { id: "fr", component: "Text", text: { "@path": "name" } },
      ],
      { a: [{ name: "P1" }, { name: "P2" }], b: [{ name: "F1" }] },
    );
    expect(byText(v, "P1").closest("[role=button]")).not.toBeNull();
    expect(byText(v, "P2").closest("[role=button]")).not.toBeNull();
    expect(byText(v, "F1").closest("form")).not.toBeNull();
  });

  it("ListItem action inside a Pressable dispatches only the ListItem action", async () => {
    const v = render([
      {
        id: "root",
        component: "Pressable",
        children: ["li"],
        onClick: { event: { name: "outer-a" } },
      },
      {
        id: "li",
        component: "ListItem",
        label: "Row",
        action: { event: { name: "item-a" } },
      },
    ]);
    click(v, byText(v, "Row"));
    await vi.waitFor(() => expect(v.forwardEvent).toHaveBeenCalled());
    expect(sentEventNames(v)).toEqual(["item-a"]);
  });

  it("renders primary buttons and solid badges with token colours, not literals", () => {
    const v = render([
      { id: "root", component: "Column", children: ["b", "g"] },
      {
        id: "b",
        component: "Button",
        label: "Go",
        variant: "primary",
        onClick: { event: { name: "go" } },
      },
      { id: "g", component: "Badge", label: "New", variant: "solid" },
    ]);
    const button = byText(v, "Go").closest("button")!;
    expect(button.style.color).toBe("var(--a2ui-color-on-accent, #fff)");
    expect(button.style.minHeight).toBe("36px");
    const badge = byText(v, "New").closest("span")!;
    expect(badge.style.color).toBe("var(--a2ui-color-on-accent, #fff)");
  });
});
