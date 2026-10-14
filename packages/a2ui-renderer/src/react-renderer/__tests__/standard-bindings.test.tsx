import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderStandard } from "./standard-test-utils";
import { standardCatalog } from "../a2ui-react/catalog/standard";
import { gridItemColumn } from "../a2ui-react/catalog/standard/renderers/layout";

// Force the Chart's data-table fallback so bound rows are observable in jsdom.
vi.mock("recharts", () => {
  throw new Error("recharts unavailable in this test");
});

const alertText = (v: ReturnType<typeof render>) =>
  v.queryByRole("alert")?.textContent ?? null;

describe("standard catalog: data-model bindings on literal props", () => {
  it("Slider min/max/step/label/unit/marks accept { path } bindings", async () => {
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Slider",
          value: { path: "/seats" },
          min: { path: "/limits/min" },
          max: { path: "/limits/max" },
          step: { path: "/limits/step" },
          label: { path: "/copy/label" },
          unit: { path: "/copy/unit" },
          marks: { path: "/marks" },
        },
      ],
      {
        seats: 12,
        limits: { min: 5, max: 40, step: 5 },
        copy: { label: "Seats", unit: "users" },
        marks: [{ value: 5, label: "Few" }, { value: 40 }],
      },
    );
    expect(await v.findByText("Seats")).toBeTruthy();
    expect(alertText(v)).toBeNull();
    const range = v.container.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    expect(range.min).toBe("5");
    expect(range.max).toBe("40");
    expect(range.step).toBe("5");
    expect(v.getByText("12 users")).toBeTruthy();
    expect(v.getByText("Few")).toBeTruthy();
  });

  it("Slider keeps its defaults when bound paths are missing", async () => {
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Slider",
          value: { path: "/v" },
          min: { path: "/nope/min" },
          max: { path: "/nope/max" },
          label: "Volume",
        },
      ],
      { v: 30 },
    );
    expect(await v.findByText("Volume")).toBeTruthy();
    const range = v.container.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    expect(range.min).toBe("0");
    expect(range.max).toBe("100");
  });

  it("Table rows and columns resolve from data paths", async () => {
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Table",
          columns: { path: "/cols" },
          rows: { path: "/rows" },
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
    expect(await v.findByText("Enterprise")).toBeTruthy();
    expect(alertText(v)).toBeNull();
    expect(v.getByText("Price")).toBeTruthy();
    expect(v.container.querySelectorAll("tbody tr").length).toBe(2);
  });

  it("Table falls back to its empty label when a bound value is not an array", async () => {
    const v = renderStandard(
      [{ id: "root", component: "Table", rows: { path: "/rows" } }],
      { rows: "oops" },
    );
    expect(await v.findByText("No rows")).toBeTruthy();
  });

  it("Chart data and series resolve from data paths", async () => {
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Chart",
          chartType: "bar",
          data: { path: "/sales" },
          xKey: "month",
          series: { path: "/series" },
          title: "Sales",
        },
      ],
      {
        sales: [
          { month: "Jan", revenue: 10 },
          { month: "Feb", revenue: 20 },
        ],
        series: [{ key: "revenue", label: "Revenue" }],
      },
    );
    await v.findByText("Sales");
    expect(alertText(v)).toBeNull();
    // recharts is mocked away, so the data-table fallback shows the bound rows.
    expect(await v.findByText("Revenue")).toBeTruthy();
    expect(v.getByText("Feb")).toBeTruthy();
    expect(v.getByText("20")).toBeTruthy();
  });

  it("Select, RadioGroup and SegmentedControl options resolve from data paths", async () => {
    const v = renderStandard(
      [
        { id: "root", component: "Column", children: ["s", "r", "g"] },
        {
          id: "s",
          component: "Select",
          value: { path: "/plan" },
          options: { path: "/plans" },
          label: { path: "/copy/plan" },
        },
        {
          id: "r",
          component: "RadioGroup",
          value: { path: "/plan" },
          options: { path: "/plans" },
        },
        {
          id: "g",
          component: "SegmentedControl",
          value: { path: "/plan" },
          options: { path: "/plans" },
        },
      ],
      {
        plan: "team",
        plans: [
          { value: "team", label: "Team" },
          { value: "enterprise", label: "Enterprise" },
        ],
        copy: { plan: "Choose a plan" },
      },
    );
    expect(await v.findByText("Choose a plan")).toBeTruthy();
    expect(alertText(v)).toBeNull();
    const select = v.container.querySelector("select") as HTMLSelectElement;
    expect(
      Array.from(select.options)
        .map((o) => o.value)
        .filter(Boolean),
    ).toEqual(["team", "enterprise"]);
    expect(v.container.querySelectorAll('input[type="radio"]').length).toBe(2);
  });

  it("List items, text-field labels and DateTimeInput bounds resolve from data paths", async () => {
    const v = renderStandard(
      [
        { id: "root", component: "Column", children: ["l", "f", "d"] },
        { id: "l", component: "List", items: { path: "/todos" } },
        {
          id: "f",
          component: "TextField",
          value: { path: "/name" },
          label: { path: "/copy/name" },
          placeholder: { path: "/copy/hint" },
        },
        {
          id: "d",
          component: "DateTimeInput",
          value: { path: "/when" },
          min: { path: "/range/from" },
          max: { path: "/range/to" },
        },
      ],
      {
        todos: ["Write tests", { label: "Ship it" }],
        name: "",
        copy: { name: "Name", hint: "Your name" },
        when: "2026-01-05",
        range: { from: "2026-01-01", to: "2026-01-31" },
      },
    );
    expect(await v.findByText("Ship it")).toBeTruthy();
    expect(alertText(v)).toBeNull();
    expect(v.getByText("Write tests")).toBeTruthy();
    expect(v.getByText("Name")).toBeTruthy();
    expect(v.getByPlaceholderText("Your name")).toBeTruthy();
    const date = v.container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    expect(date.min).toBe("2026-01-01");
    expect(date.max).toBe("2026-01-31");
  });

  it("schemas accept literal and bound values for array props", () => {
    const schema = (name: string) =>
      standardCatalog.components.get(name)!.schema;
    expect(schema("Table").safeParse({ rows: { path: "/r" } }).success).toBe(
      true,
    );
    expect(schema("Table").safeParse({ rows: [["a"]] }).success).toBe(true);
    expect(schema("Map").safeParse({ markers: { path: "/m" } }).success).toBe(
      true,
    );
    expect(schema("Slider").safeParse({ min: "1" }).success).toBe(false);
  });
});

describe("standard catalog: GridItem span", () => {
  it("clamps spans that cover every column to the full row", () => {
    expect(gridItemColumn(undefined, 3)).toBeUndefined();
    expect(gridItemColumn(2, 3)).toBe("span 2");
    expect(gridItemColumn(3, 3)).toBe("1 / -1");
    expect(gridItemColumn(5, 2)).toBe("1 / -1");
    // Collapsed auto-fit grid: a single rendered column.
    expect(gridItemColumn(2, 1)).toBe("1 / -1");
    // Unknown column count (string template): keep the span.
    expect(gridItemColumn(2, undefined)).toBe("span 2");
  });

  it("GridItem with span > columns fills the row instead of overflowing", async () => {
    const v = renderStandard([
      { id: "root", component: "Grid", columns: 2, children: ["a", "b"] },
      { id: "a", component: "GridItem", span: 4, children: ["ta"] },
      { id: "ta", component: "Text", text: "Wide" },
      { id: "b", component: "GridItem", span: 1, children: ["tb"] },
      { id: "tb", component: "Text", text: "Narrow" },
    ]);
    const wide = (await v.findByText("Wide")).parentElement!;
    const narrow = v.getByText("Narrow").parentElement!;
    expect(wide.style.gridColumn).toBe("1 / -1");
    expect(narrow.style.gridColumn).toBe("span 1");
  });
});
