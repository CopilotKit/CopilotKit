import { render, screen } from "@testing-library/vue";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dataDeclarations } from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../../../../catalog";
import {
  SURFACE_ID,
  renderSurface,
} from "../../../../__tests__/helpers/render-surface";
import {
  CopilotGenerativeUITable,
  CopilotGenerativeUITableCell,
  CopilotGenerativeUITableRow,
  CopilotGenerativeUITableSection,
  tableComponents,
} from "../index";

/** A test-only leaf for table cells. */
const Label = defineComponent({
  props: { text: { type: String, required: true } },
  template: `<span>{{ text }}</span>`,
});

const ui = createGenerativeUI({
  id: "test/data@1",
  components: {
    ...tableComponents,
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

describe("dataComponents", () => {
  // Ported for the table part of the data group: Chart, Map and List have
  // their own folders, and the data group index joins them.
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    const names = Object.keys(tableComponents);
    expect(names).toEqual(["Table", "TableSection", "TableRow", "TableCell"]);
    for (const name of names) {
      expect(ui.manifestComponents[name]!.description).toMatch(/\S/);
    }
    expect(ui.manifestComponents.Table!.slots).toEqual({
      children: "multiple",
      cellComponents: "multiple",
    });
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
    expect(headers[0]!.getAttribute("scope")).toBe("col");
    expect(rowTexts(view)).toEqual([
      "Feature|Team",
      "Price|$29/seat",
      "Seats|10",
    ]);
    expect(view.getByText("10").style.textAlign).toBe("end");
  });

  it("applies the envelope of a TableCell to the cell itself, with no element in between", async () => {
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
    const cell = (await view.findByText("42")).closest("td")!;
    expect(cell.getAttribute("aria-label")).toBe("Total");
    expect(cell.getAttribute("aria-description")).toBe("Incl. VAT");
    expect(cell.parentElement?.tagName).toBe("TR");
    expect(
      view.container.querySelector("[data-a2ui-accessibility]"),
    ).toBeNull();
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

// Ported from React's `data-media-parity.test.tsx` and
// `bindings-parity.test.tsx`. They render through `standardUI`, so Badge
// and Text (other groups) are the test `Label` here.
describe("standard catalog: data and media (parity)", () => {
  it("Table columns render a { componentId } header cell inside <th>", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Table",
        columns: [
          "Laptop",
          { label: "Price", componentId: "hb" },
          { componentId: "hb2" },
        ],
        rows: [["Air 13", "$999", "-"]],
        cellComponents: ["hb", "hb2"],
      },
      { id: "hb", component: "Label", text: "Best value" },
      { id: "hb2", component: "Label", text: "Extra" },
    ]);
    const badge = await view.findByText("Best value");
    const th = badge.closest("th");
    expect(th).not.toBeNull();
    expect(th?.textContent).toContain("Price");
    expect(view.getByText("Extra").closest("th")).not.toBeNull();
  });

  it("TableRow renders its label as a row header cell with labelColSpan", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Table", children: ["r"] },
      {
        id: "r",
        component: "TableRow",
        label: "Day 1",
        labelColSpan: 2,
        children: ["c"],
      },
      { id: "c", component: "TableCell", text: "€80" },
    ]);
    const th = await view.findByText("Day 1");
    expect(th.tagName).toBe("TH");
    expect(th.getAttribute("scope")).toBe("row");
    expect(th.getAttribute("colspan")).toBe("2");
  });

  it("Table rows and columns resolve from data paths", async () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Table",
          columns: { "@path": "/cols" },
          rows: { "@path": "/rows" },
        },
      ],
      {
        cols: ["Plan", { label: "Price", align: "end" }],
        rows: [
          ["Team", "$29"],
          ["Enterprise", "$99"],
        ],
      },
    );
    expect(await view.findByText("Enterprise")).toBeTruthy();
    expect(view.reportError).not.toHaveBeenCalled();
    expect(view.getByText("Price")).toBeTruthy();
    expect(view.container.querySelectorAll("tbody tr").length).toBe(2);
  });
});

// Ported from Angular's `table.spec.ts`: the cases React has no test for.
describe("Table sticky header", () => {
  it("caps a sticky-header Table at 480px and scrolls it", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Table",
        stickyHeader: true,
        columns: ["A"],
        rows: [["1"]],
      },
    ]);
    const header = await view.findByRole("columnheader", { name: "A" });
    const wrapper = view.container.querySelector("table")!.parentElement!;
    expect(wrapper.style.maxHeight).toBe("480px");
    expect(wrapper.style.overflowY).toBe("auto");
    expect(header.style.position).toBe("sticky");
  });
});

describe("Table (Vue-specific semantics)", () => {
  it("adds a row for a new item at the template path", async () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Table",
          children: { componentId: "row", path: "/rows" },
        },
        { id: "row", component: "TableRow", children: ["name"] },
        { id: "name", component: "TableCell", text: { "@path": "name" } },
      ],
      { rows: [{ name: "Alpha" }] },
    );
    await view.findByText("Alpha");
    await view.update({
      version: "1.0",
      updateDataModel: {
        surfaceId: SURFACE_ID,
        path: "/rows",
        value: [{ name: "Alpha" }, { name: "Beta" }],
      },
    });
    expect(rowTexts(view)).toEqual(["Alpha", "Beta"]);
  });

  it("keeps the row dividers when dividers is not set, and drops them when the Table sets false", async () => {
    const tableWith = (dividers: boolean | undefined) =>
      renderSurface(ui, [
        { id: "root", component: "Table", dividers, children: ["s"] },
        { id: "s", component: "TableSection", children: ["r"] },
        { id: "r", component: "TableRow", children: ["c"] },
        { id: "c", component: "TableCell", text: "Cell" },
      ]);
    const divided = tableWith(undefined);
    const cell = await divided.findByText("Cell");
    expect(cell.hasAttribute("data-divider")).toBe(true);
    divided.unmount();
    const plain = tableWith(false);
    const plainCell = await plain.findByText("Cell");
    expect(plainCell.hasAttribute("data-divider")).toBe(false);
  });

  it("a TableSection rowDivider of false wins over the Table", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Table", children: ["s"] },
      {
        id: "s",
        component: "TableSection",
        rowDivider: false,
        children: ["r"],
      },
      { id: "r", component: "TableRow", children: ["c"] },
      { id: "c", component: "TableCell", text: "Plain" },
    ]);
    const cell = await view.findByText("Plain");
    expect(cell.hasAttribute("data-divider")).toBe(false);
  });

  it("renders a header TableRow directly in a Table in its own thead", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Table", children: ["h", "r"] },
      { id: "h", component: "TableRow", header: true, children: ["hc"] },
      { id: "hc", component: "TableCell", text: "Name" },
      { id: "r", component: "TableRow", children: ["c"] },
      { id: "c", component: "TableCell", text: "Ada" },
    ]);
    const name = await view.findByRole("columnheader", { name: "Name" });
    expect(name.parentElement?.parentElement?.tagName).toBe("THEAD");
    expect(view.getByText("Ada").tagName).toBe("TD");
    expect(view.container.querySelectorAll("table > tbody > tr")).toHaveLength(
      1,
    );
  });

  it("renders the parts outside a surface with their own context", () => {
    const Parts = defineComponent({
      components: {
        CopilotGenerativeUITable,
        CopilotGenerativeUITableSection,
        CopilotGenerativeUITableRow,
        CopilotGenerativeUITableCell,
      },
      template: `
        <CopilotGenerativeUITable caption="Team">
          <template #children>
            <CopilotGenerativeUITableSection :header="true">
              <template #children>
                <CopilotGenerativeUITableRow>
                  <template #children>
                    <CopilotGenerativeUITableCell text="Name" />
                  </template>
                </CopilotGenerativeUITableRow>
              </template>
            </CopilotGenerativeUITableSection>
          </template>
        </CopilotGenerativeUITable>
      `,
    });
    render(Parts);
    const table = screen.getByRole("table", { name: "Team" });
    expect(table.querySelector("thead th[scope=col]")?.textContent).toBe(
      "Name",
    );
  });

  it("server-renders a data table without a DOM", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(CopilotGenerativeUITable, {
            columns: ["Plan"],
            rows: [["Team"]],
          }),
      }),
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("th[scope=col]")?.textContent).toBe("Plan");
    expect(host.querySelector("td")?.textContent).toBe("Team");
  });

  it("defines the table components with the shared declarations and the Vue components", () => {
    expect(tableComponents.Table).toEqual({
      ...dataDeclarations.Table,
      component: CopilotGenerativeUITable,
    });
    expect(tableComponents.TableCell.component).toBe(
      CopilotGenerativeUITableCell,
    );
  });
});
