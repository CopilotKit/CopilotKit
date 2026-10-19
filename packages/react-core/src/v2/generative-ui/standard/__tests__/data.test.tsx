import React from "react";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGenerativeUI } from "../../catalog";
import { useStableValue } from "../Chart";
import { dataComponents } from "../data";
import { guardNumericFilter, guardStyleFilters } from "../Map";
import { renderSurface } from "./render";

// maplibre-gl is an optional peer dependency. This models an app that does
// not install it: the import rejects.
vi.mock("maplibre-gl", () => {
  throw new Error("Cannot find package 'maplibre-gl'");
});

/** A test-only leaf for table cells and list children. */
function Label({ text }: { text: string }) {
  return <span>{text}</span>;
}

const ui = createGenerativeUI({
  id: "test/data@1",
  components: {
    ...dataComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
  },
});

type SurfaceView = ReturnType<typeof renderSurface>;

/** The text of each row of the table, cells joined by "|". */
function rowTexts(view: SurfaceView) {
  const rows = [...view.container.querySelectorAll("tr")];
  return rows.map((row) =>
    [...row.querySelectorAll("th, td")]
      .map((cell) => cell.textContent)
      .join("|"),
  );
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("dataComponents", () => {
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    const names = Object.keys(dataComponents);
    expect(names).toEqual([
      "Table",
      "TableSection",
      "TableRow",
      "TableCell",
      "List",
      "ListItem",
      "Chart",
      "Map",
    ]);
    for (const name of names) {
      expect(ui.manifestComponents[name].description).toMatch(/\S/);
    }
    expect(ui.manifestComponents.Table.slots).toEqual({
      children: "multiple",
      cellComponents: "multiple",
    });
    expect(Object.keys(ui.manifestComponents.List.events ?? {})).toEqual([
      "action",
    ]);
    expect(Object.keys(ui.manifestComponents.ListItem.events ?? {})).toEqual([
      "action",
    ]);
  });
});

describe("Table", () => {
  it("renders columns as column headers and rows as cells", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Table",
        caption: "Plans",
        columns: ["Feature", { label: "Team", align: "end" }],
        rows: [
          ["Price", "$29/seat"],
          ["Seats", 10],
        ],
      },
    ]);
    await view.findByText("$29/seat");
    expect(view.getByRole("table", { name: "Plans" })).toBeTruthy();
    const headers = view.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Feature",
      "Team",
    ]);
    expect(headers[0].getAttribute("scope")).toBe("col");
    expect(rowTexts(view)).toEqual([
      "Feature|Team",
      "Price|$29/seat",
      "Seats|10",
    ]);
    expect(view.getByText("10").style.textAlign).toBe("end");
  });

  it("repeats a TableRow template for each item at /rows", async () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Table",
          children: { componentId: "row", path: "/rows" },
        },
        { id: "row", component: "TableRow", children: ["name", "price"] },
        { id: "name", component: "TableCell", text: { "@path": "name" } },
        { id: "price", component: "TableCell", text: { "@path": "price" } },
      ],
      {
        rows: [
          { name: "Alpha", price: 10 },
          { name: "Beta", price: 20 },
        ],
      },
    );
    await view.findByText("Beta");
    expect(rowTexts(view)).toEqual(["Alpha|10", "Beta|20"]);
    // Each row directly in the table gets its own row group.
    expect(view.container.querySelectorAll("table > tbody > tr")).toHaveLength(
      2,
    );
  });

  it("renders a header TableSection with column header cells", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Table", children: ["head", "body"] },
      { id: "head", component: "TableSection", header: true, children: ["h"] },
      { id: "h", component: "TableRow", children: ["hc"] },
      { id: "hc", component: "TableCell", text: "City" },
      { id: "body", component: "TableSection", children: ["r"] },
      { id: "r", component: "TableRow", children: ["c"] },
      { id: "c", component: "TableCell", header: true, text: "Vienna" },
    ]);
    const city = await view.findByRole("columnheader", { name: "City" });
    expect(city.closest("thead")).not.toBeNull();
    expect(view.getByRole("rowheader", { name: "Vienna" })).toBeTruthy();
  });

  it("shows the component of a { componentId } cell and column from cellComponents", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Table",
        columns: ["Laptop", { label: "Pick", componentId: "hint" }],
        rows: [
          ["Air 13", { componentId: "best" }],
          ["Pro 14", { id: "best" }],
        ],
        cellComponents: ["best", "hint"],
      },
      { id: "best", component: "Label", text: "Best value" },
      { id: "hint", component: "Label", text: "(1)" },
    ]);
    await view.findAllByText("Best value");
    expect(rowTexts(view)).toEqual([
      "Laptop|Pick(1)",
      "Air 13|Best value",
      "Pro 14|Best value",
    ]);
    expect(view.container.textContent).not.toContain("componentId");
  });

  it("reads rows bound to a data path, with component cells", async () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Table",
          columns: { "@path": "/columns" },
          rows: { "@path": "/rows" },
          cellComponents: ["top"],
        },
        { id: "top", component: "Label", text: "Top pick" },
      ],
      {
        columns: ["Laptop", "Tag"],
        rows: [
          ["Air 13", { componentId: "top" }],
          ["Pro 14", null],
        ],
      },
    );
    await view.findByText("Top pick");
    expect(rowTexts(view)).toEqual([
      "Laptop|Tag",
      "Air 13|Top pick",
      "Pro 14|",
    ]);
  });

  it("shows the empty label when there are no rows", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Table",
        columns: ["A", "B"],
        rows: [],
        emptyLabel: "Nothing yet",
      },
    ]);
    const empty = await view.findByText("Nothing yet");
    expect(empty.getAttribute("colspan")).toBe("2");
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
    await click(await view.findByRole("button", { name: "Graz" }));
    expect(view.forwardEvent).toHaveBeenCalledOnce();
    expect(view.forwardEvent.mock.calls[0][0]).toMatchObject({
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
    await click(await view.findByRole("button", { name: "Open details" }));
    expect(view.forwardEvent.mock.calls[0][0]).toMatchObject({
      name: "open",
      context: { id: "7" },
    });
  });
});

describe("Chart", () => {
  it("draws the chart with recharts and gives the series data as a table", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Chart",
        title: "Cost",
        xKey: "month",
        format: "currency",
        data: [
          { month: "Jan", cost: 290 },
          { month: "Feb", cost: 580 },
        ],
        series: [{ key: "cost", label: "Monthly cost" }],
      },
    ]);
    await waitFor(() =>
      expect(
        view.container.querySelector(".recharts-responsive-container"),
      ).not.toBeNull(),
    );
    const figure = view.getByRole("figure");
    expect(figure.querySelector("figcaption")?.textContent).toBe("Cost");
    expect(rowTexts(view)).toEqual([
      "month|Monthly cost",
      "Jan|$290",
      "Feb|$580",
    ]);
  });

  it("charts every number field except xKey when series is not set", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Chart",
        chartType: "line",
        xKey: "day",
        data: [{ day: "Mon", food: 3, rent: 10, note: "x" }],
      },
    ]);
    await view.findByRole("table");
    expect(rowTexts(view)).toEqual(["day|food|rent", "Mon|3|10"]);
  });
});

describe("useStableValue", () => {
  it("keeps the previous object while the content is equal", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: { day: string; food: number }[] }) =>
        useStableValue(value),
      { initialProps: { value: [{ day: "Mon", food: 1 }] } },
    );
    const first = result.current;
    rerender({ value: [{ day: "Mon", food: 1 }] });
    expect(result.current).toBe(first);
    rerender({ value: [{ day: "Mon", food: 2 }] });
    expect(result.current).toEqual([{ day: "Mon", food: 2 }]);
  });
});

describe("Map", () => {
  it("shows a list of places when maplibre-gl is not installed, and a pick writes the bound path", async () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Map",
          markers: [
            { label: "Vienna", lat: 48.2, lng: 16.37 },
            { label: "Graz", lat: 47.07, lng: 15.44, category: "City" },
          ],
          selected: { "@path": "/city" },
        },
      ],
      { city: "Vienna" },
    );
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-a2ui-map="fallback"]'),
      ).not.toBeNull(),
    );
    const places = view.getByRole("list", { name: "Map places" });
    expect(places.hasAttribute("data-collapsed")).toBe(false);
    const vienna = view.getByRole("button", { name: /Vienna/ });
    const graz = view.getByRole("button", { name: /Graz/ });
    expect(vienna.getAttribute("aria-pressed")).toBe("true");
    expect(graz.textContent).toBe("Graz47.0700, 15.4400 · City");
    await click(graz);
    expect(view.dataAt("/city")).toBe("Graz");
    expect(graz.getAttribute("aria-pressed")).toBe("true");
    expect(vienna.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("map style filter guard", () => {
  it("guards numeric property comparisons with a has check, at any depth", () => {
    const filter = [
      "all",
      ["<=", ["get", "ref_length"], 6],
      ["match", ["geometry-type"], ["LineString"], true, false],
    ];
    expect(guardNumericFilter(filter)).toEqual([
      "all",
      ["all", ["has", "ref_length"], ["<=", ["get", "ref_length"], 6]],
      ["match", ["geometry-type"], ["LineString"], true, false],
    ]);
  });

  it("leaves comparisons that do not compare a property with a number", () => {
    expect(guardNumericFilter([">", ["zoom"], 5])).toEqual([">", ["zoom"], 5]);
    expect(guardNumericFilter(["==", ["get", "rank"], 1])).toEqual([
      "==",
      ["get", "rank"],
      1,
    ]);
  });

  it("guards the filter of each style layer and keeps layers without one", () => {
    const style = {
      version: 8,
      layers: [{ id: "a", filter: [">=", ["get", "rank"], 2] }, { id: "b" }],
    };
    expect(guardStyleFilters(style).layers).toEqual([
      { id: "a", filter: ["all", ["has", "rank"], [">=", ["get", "rank"], 2]] },
      { id: "b" },
    ]);
  });
});
