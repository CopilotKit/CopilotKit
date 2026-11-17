import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dataDeclarations } from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../../../../catalog";
import { renderSurface } from "../../../../__tests__/helpers/render-surface";
import {
  CopilotGenerativeUIList,
  CopilotGenerativeUIListItem,
  listComponents,
} from "../index";

/** A test-only leaf for list children. */
const Label = defineComponent({
  props: { text: { type: String, required: true } },
  template: `<span>{{ text }}</span>`,
});

const ui = createGenerativeUI({
  id: "test/data@1",
  components: {
    ...listComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
  },
});

describe("dataComponents", () => {
  // Ported for the list part of the data group: Table, Chart and Map have
  // their own folders, and the data group index joins them.
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    const names = Object.keys(listComponents);
    expect(names).toEqual(["List", "ListItem"]);
    for (const name of names) {
      expect(ui.manifestComponents[name]!.description).toMatch(/\S/);
    }
    expect(Object.keys(ui.manifestComponents.List!.events ?? {})).toEqual([
      "action",
    ]);
    expect(Object.keys(ui.manifestComponents.ListItem!.events ?? {})).toEqual([
      "action",
    ]);
  });
});

describe("List", () => {
  it("renders items as a numbered list", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "List",
        marker: "number",
        items: ["one", { label: "two", description: "second" }],
      },
    ]);
    await view.findByText("second");
    const list = view.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(
      view.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["one", "twosecond"]);
    // Without an action, items are not buttons.
    expect(view.queryByRole("button")).toBeNull();
  });

  it("repeats a ListItem template for each item at /todos", async () => {
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
    await view.findByText("Walk dog");
    expect(
      view.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["Buy milk", "Walk dog"]);
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
    await fireEvent.click(await view.findByRole("button", { name: "Graz" }));
    await waitFor(() => expect(view.forwardEvent).toHaveBeenCalledOnce());
    expect(view.forwardEvent.mock.calls[0]![0]).toMatchObject({
      name: "pick",
      context: { index: 1, label: "Graz", value: "graz", source: "list" },
    });
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
    await fireEvent.click(
      await view.findByRole("button", { name: "Open details" }),
    );
    await waitFor(() => expect(view.forwardEvent).toHaveBeenCalledOnce());
    expect(view.forwardEvent.mock.calls[0]![0]).toMatchObject({
      name: "open",
      context: { id: "7" },
    });
  });
});

// Ported from React's `data-media-parity.test.tsx` and
// `bindings-parity.test.tsx`. React renders them through `standardUI`;
// the Column of React's value case is a List here, as in Angular.
describe("standard catalog: data and media (parity)", () => {
  it("ListItem disabled renders at half opacity and ignores its action", async () => {
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
    const label = await view.findByText("Sold out");
    const li = label.closest("li")!;
    expect(li.getAttribute("aria-disabled")).toBe("true");
    expect(li.style.opacity).toBe("0.5");
    expect(li.querySelector("button")).toBeNull();
    await fireEvent.click(label);
    expect(view.forwardEvent).not.toHaveBeenCalled();
  });

  it("List items and ListItems show their value on the right of the label", async () => {
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
    const price = await view.findByText("$1,599");
    expect(price.hasAttribute("data-a2ui-list-value")).toBe(true);
    expect(price.style.fontVariantNumeric).toBe("tabular-nums");
    expect(price.parentElement!.style.justifyContent).toBe("space-between");
    expect(view.getByText("32")).not.toBeNull();
    const battery = view.getByText("Up to 18 hrs");
    expect(battery.parentElement!.style.justifyContent).toBe("space-between");
  });

  it("List items with an action keep the value as the pick payload and do not show it", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "List",
        items: [{ label: "Graz", value: "graz" }],
        action: { event: { name: "pick" } },
      },
    ]);
    await fireEvent.click(await view.findByRole("button", { name: "Graz" }));
    expect(view.queryByText("graz")).toBeNull();
    await waitFor(() => expect(view.forwardEvent).toHaveBeenCalledOnce());
    expect(view.forwardEvent.mock.calls[0]![0].context).toMatchObject({
      label: "Graz",
      value: "graz",
    });
  });

  it("List maxMarkerSize and ListItem markerSize size the marker column", async () => {
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
    const wide = await view.findByText("①");
    expect(wide.style.minWidth).toBe("32px");
    expect(wide.style.maxWidth).toBe("32px");
    expect(view.getByText("②").style.minWidth).toBe("48px");
  });

  it("List items resolve from data paths", async () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "List", items: { "@path": "/todos" } }],
      { todos: ["Write tests", { label: "Ship it" }] },
    );
    expect(await view.findByText("Ship it")).toBeTruthy();
    expect(view.reportError).not.toHaveBeenCalled();
    expect(view.getByText("Write tests")).toBeTruthy();
  });
});

describe("List (Vue-specific semantics)", () => {
  it("starts the numbers of a numbered list at start", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "List",
        marker: "number",
        start: 3,
        items: ["one"],
      },
    ]);
    const list = await view.findByRole("list");
    expect(list.getAttribute("start")).toBe("3");
    expect(list.style.listStyleType).toBe("decimal");
  });

  it("keeps the list role and drops the native markers of a horizontal list", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "List",
        direction: "horizontal",
        items: ["one", "two"],
      },
    ]);
    const list = await view.findByRole("list");
    expect(list.tagName).toBe("UL");
    expect(list.getAttribute("role")).toBe("list");
    expect(list.style.listStyleType).toBe("none");
    expect(list.style.flexDirection).toBe("row");
  });

  it("an own ListItem marker replaces the native bullet", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "List", children: ["a", "b"] },
      { id: "a", component: "ListItem", label: "Marked", marker: "→" },
      { id: "b", component: "ListItem", label: "Bulleted" },
    ]);
    const marked = (await view.findByText("Marked")).closest("li")!;
    expect(marked.style.listStyleType).toBe("none");
    const bulleted = view.getByText("Bulleted").closest("li")!;
    expect(bulleted.style.listStyleType).toBe("");
  });

  it("shows the ListItem children after the description", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "List", children: ["i"] },
      {
        id: "i",
        component: "ListItem",
        label: "Order",
        description: "Shipped",
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Track it" },
    ]);
    const item = (await view.findByText("Track it")).closest("li")!;
    expect(item.textContent).toBe("OrderShippedTrack it");
  });

  it("renders a ListItem outside a List as a div", () => {
    render(CopilotGenerativeUIListItem, { props: { label: "Alone" } });
    const item = screen.getByText("Alone");
    expect(item.closest("div")).not.toBeNull();
    expect(item.closest("li")).toBeNull();
  });

  it("server-renders a list without a DOM", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(CopilotGenerativeUIList, {
            marker: "number",
            items: ["one", { label: "two", value: 2 }],
          }),
      }),
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const items = [...host.querySelectorAll("ol > li")];
    expect(items.map((item) => item.textContent)).toEqual(["one", "two2"]);
  });

  it("defines the list components with the shared declarations and the Vue components", () => {
    expect(listComponents.List).toEqual({
      ...dataDeclarations.List,
      component: CopilotGenerativeUIList,
    });
    expect(listComponents.ListItem.component).toBe(CopilotGenerativeUIListItem);
  });
});
