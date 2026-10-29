import { describe, expect, it, vi } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { buttons, byText, ui } from "./helpers";

describe("List", () => {
  it("renders items as a numbered list", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "List",
        marker: "number",
        start: 3,
        items: ["one", { label: "two", description: "second" }],
      },
    ]);
    const list = view.container.querySelector<HTMLElement>("ul.a2ui-std-list")!;
    expect(list.style.listStyleType).toBe("decimal");
    expect(list.style.counterReset).toBe("list-item 2");
    expect(
      [...list.querySelectorAll("li")].map((item) =>
        item.textContent?.replace(/\s+/g, ""),
      ),
    ).toEqual(["one", "twosecond"]);
    // Without an action, items are not buttons.
    expect(buttons(view)).toHaveLength(0);
  });

  it("repeats a ListItem template for each item at /todos", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "List",
          marker: "none",
          children: { componentId: "item", path: "/todos" },
        },
        { id: "item", component: "ListItem", label: { "@path": "title" } },
      ],
      { todos: [{ title: "Buy milk" }, { title: "Walk dog" }] },
    );
    expect(
      [...view.container.querySelectorAll("li")].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["Buy milk", "Walk dog"]);
    expect(view.container.querySelector("ul")?.getAttribute("role")).toBe(
      "list",
    );
  });

  it("sends the List action with the index, label and value of the picked item", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "List",
        items: ["Vienna", { label: "Graz", value: "graz" }],
        action: { event: { name: "pick", context: { source: "list" } } },
      },
    ]);
    const graz = buttons(view).find((button) =>
      button.textContent?.includes("Graz"),
    )!;
    // With an action, the value is the payload, not shown.
    expect(graz.querySelector("[data-a2ui-list-value]")).toBeNull();
    expect(view.container.textContent).not.toContain("graz");
    graz.click();
    await vi.waitFor(() => expect(view.forwardEvent).toHaveBeenCalledOnce());
    expect(view.forwardEvent.mock.calls[0]![0]).toMatchObject({
      name: "pick",
      context: { index: 1, label: "Graz", value: "graz", source: "list" },
    });
  });

  it("List items and ListItems show their value on the right of the label", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "List", children: ["l", "i"] },
      {
        id: "l",
        component: "List",
        marker: "none",
        items: [
          { label: "Price", value: "$1,599" },
          { label: "RAM", value: 32 },
        ],
      },
      {
        id: "i",
        component: "ListItem",
        label: "Battery",
        value: "Up to 18 hrs",
      },
    ]);
    const [price, ram, battery] = [
      ...view.container.querySelectorAll<HTMLElement>("[data-a2ui-list-value]"),
    ];
    expect(price!.textContent).toBe("$1,599");
    expect(price!.style.fontVariantNumeric).toBe("tabular-nums");
    expect(price!.parentElement!.style.justifyContent).toBe("space-between");
    expect(ram!.textContent).toBe("32");
    expect(battery!.textContent).toBe("Up to 18 hrs");
    expect(battery!.parentElement!.style.justifyContent).toBe("space-between");
  });

  it("List maxMarkerSize and ListItem markerSize size the marker column", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "List",
        marker: "rich",
        maxMarkerSize: 32,
        children: ["a", "b"],
      },
      { id: "a", component: "ListItem", label: "Wide", marker: "①" },
      {
        id: "b",
        component: "ListItem",
        label: "Own",
        marker: "②",
        markerSize: 48,
      },
    ]);
    const wide = byText(view, "①");
    expect(wide.style.minWidth).toBe("32px");
    expect(wide.style.maxWidth).toBe("32px");
    expect(byText(view, "②").style.minWidth).toBe("48px");
  });

  it("sends the ListItem action when the user picks the item", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "List", children: ["a"] },
      {
        id: "a",
        component: "ListItem",
        label: "Open details",
        action: { event: { name: "open", context: { id: "7" } } },
      },
    ]);
    expect(buttons(view)).toHaveLength(1);
    buttons(view)[0]!.click();
    await vi.waitFor(() => expect(view.forwardEvent).toHaveBeenCalledOnce());
    expect(view.forwardEvent.mock.calls[0]![0]).toMatchObject({
      name: "open",
      context: { id: "7" },
    });
  });

  it("ListItem disabled renders at half opacity and ignores its action", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "List", children: ["i"] },
      {
        id: "i",
        component: "ListItem",
        label: "Sold out",
        disabled: true,
        action: { event: { name: "pick" } },
      },
    ]);
    const item = byText(view, "Sold out").closest("li")!;
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.style.opacity).toBe("0.5");
    expect(item.querySelector("button")).toBeNull();
    view.act(() => byText(view, "Sold out").click());
    expect(view.forwardEvent).not.toHaveBeenCalled();
  });
});
