import { describe, expect, it } from "vitest";
import { renderSurface, updateDataModel } from "../../../__tests__/render";
import { dataComponents } from "../index";
import { rowTexts, ui } from "./helpers";

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
      expect(ui.manifestComponents[name]!.description).toMatch(/\S/);
    }
    expect(ui.manifestComponents.Table!.slots).toEqual({
      children: "multiple",
      cellComponents: "multiple",
    });
    expect(Object.keys(ui.manifestComponents.List!.events ?? {})).toEqual([
      "action",
    ]);
    expect(Object.keys(ui.manifestComponents.ListItem!.events ?? {})).toEqual([
      "action",
    ]);
  });
});

describe("Table", () => {
  it("renders columns as column headers and rows as cells", () => {
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
    expect(view.container.querySelector("caption")?.textContent?.trim()).toBe(
      "Plans",
    );
    const headers = [...view.container.querySelectorAll("th[scope=col]")];
    expect(headers.map((header) => header.textContent?.trim())).toEqual([
      "Feature",
      "Team",
    ]);
    expect(rowTexts(view)).toEqual([
      "Feature|Team",
      "Price|$29/seat",
      "Seats|10",
    ]);
    const seats = [...view.container.querySelectorAll("td")].find(
      (cell) => cell.textContent?.trim() === "10",
    )!;
    expect(seats.style.textAlign).toBe("end");
    expect(
      view.container.querySelector(
        ".a2ui-std-table-wrap > table.a2ui-std-table",
      ),
    ).not.toBeNull();
  });

  it("applies the envelope of a TableCell to the cell itself, with no element in between", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Table", children: ["r"] },
      { id: "r", component: "TableRow", children: ["c"] },
      {
        id: "c",
        component: "TableCell",
        children: ["t"],
        accessibility: { label: "Total", description: "Incl. VAT" },
      },
      { id: "t", component: "Label", text: "42" },
    ]);
    const cell = view.container.querySelector("td")!;
    expect(cell.textContent?.trim()).toBe("42");
    expect(cell.getAttribute("aria-label")).toBe("Total");
    expect(cell.getAttribute("aria-description")).toBe("Incl. VAT");
    expect(cell.parentElement?.tagName).toBe("TR");
    expect(cell.parentElement?.parentElement?.tagName).toBe("TABLE");
    expect(
      view.container.querySelector("[data-a2ui-accessibility]"),
    ).toBeNull();
  });

  it("repeats a TableRow template for each item at /rows", () => {
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
    expect(rowTexts(view)).toEqual(["Alpha|10", "Beta|20"]);
    view.update(
      updateDataModel("/rows", [
        { name: "Alpha", price: 10 },
        { name: "Beta", price: 20 },
        { name: "Gamma", price: 30 },
      ]),
    );
    expect(rowTexts(view)).toEqual(["Alpha|10", "Beta|20", "Gamma|30"]);
  });

  it("renders a header TableSection with column header cells", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Table", children: ["head", "body"] },
      { id: "head", component: "TableSection", header: true, children: ["h"] },
      { id: "h", component: "TableRow", children: ["hc"] },
      { id: "hc", component: "TableCell", text: "City" },
      { id: "body", component: "TableSection", children: ["r"] },
      { id: "r", component: "TableRow", children: ["c"] },
      { id: "c", component: "TableCell", header: true, text: "Vienna" },
    ]);
    const city = view.container.querySelector('th[scope="col"]')!;
    expect(city.textContent?.trim()).toBe("City");
    expect(city.closest("tbody")?.hasAttribute("data-a2ui-header")).toBe(true);
    const vienna =
      view.container.querySelector<HTMLElement>('th[scope="row"]')!;
    expect(vienna.textContent?.trim()).toBe("Vienna");
    expect(vienna.style.fontWeight).toBe("500");
  });

  it("shows the component of a { componentId } cell and column from cellComponents", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Table",
        columns: [
          "Laptop",
          { label: "Pick", componentId: "hint" },
          { componentId: "hint" },
        ],
        rows: [
          ["Air 13", { componentId: "best" }, "-"],
          ["Pro 14", { id: "best" }, "-"],
        ],
        cellComponents: ["best", "hint"],
      },
      { id: "best", component: "Label", text: "Best value" },
      { id: "hint", component: "Label", text: "(1)" },
    ]);
    // A column with a component and no label is still a header cell.
    expect(view.container.querySelectorAll("th[scope=col]")).toHaveLength(3);
    expect(rowTexts(view)).toEqual([
      "Laptop|Pick (1)|(1)",
      "Air 13|Best value|-",
      "Pro 14|Best value|-",
    ]);
    expect(view.container.textContent).not.toContain("componentId");
  });

  it("reads rows bound to a data path, with component cells", () => {
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
    expect(rowTexts(view)).toEqual([
      "Laptop|Tag",
      "Air 13|Top pick",
      "Pro 14|",
    ]);
  });

  it("shows the empty label when there are no rows", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Table",
        columns: ["A", "B"],
        rows: [],
        emptyLabel: "Nothing yet",
      },
    ]);
    const empty = [...view.container.querySelectorAll("td")].find(
      (cell) => cell.textContent?.trim() === "Nothing yet",
    )!;
    expect(empty.getAttribute("colspan")).toBe("2");
  });

  it("TableRow renders its label as a row header cell with labelColSpan", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Table", children: ["r"] },
      {
        id: "r",
        component: "TableRow",
        label: "Totals",
        labelColSpan: 2,
        children: ["c"],
      },
      { id: "c", component: "TableCell", text: 7 },
    ]);
    const label = view.container.querySelector("th[scope=row]")!;
    expect(label.textContent?.trim()).toBe("Totals");
    expect(label.getAttribute("colspan")).toBe("2");
    expect(rowTexts(view)).toEqual(["Totals|7"]);
  });
});

describe("Table sticky header", () => {
  it("caps a sticky-header Table at 480px and scrolls it", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Table",
        stickyHeader: true,
        columns: ["A"],
        rows: [["1"]],
      },
    ]);
    const wrapper = view.container.querySelector("table")!.parentElement!;
    expect(wrapper.style.maxHeight).toBe("480px");
    expect(wrapper.style.overflowY).toBe("auto");
  });
});
