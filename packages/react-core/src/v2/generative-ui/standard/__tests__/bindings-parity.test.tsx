import { describe, expect, it, vi } from "vitest";
import { standardUI } from "../index";
import { renderSurface } from "./render";

/**
 * Tests ported from the a2ui-renderer standard catalog: literal props take
 * `{ path }` bindings. On this engine every prop accepts a binding, so the
 * tests pin that the components read the bound values.
 */

// The data-table fallback of the Chart makes bound rows visible in jsdom.
vi.mock("recharts", () => {
  throw new Error("recharts unavailable in this test");
});

const render = (
  ...args: Parameters<typeof renderSurface> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => renderSurface(standardUI, ...args);

describe("standard catalog: data-model bindings on literal props (parity)", () => {
  it("Slider min/max/step/label/unit/marks accept { path } bindings", async () => {
    const v = render(
      [
        {
          id: "root",
          component: "Slider",
          value: { "@path": "/seats" },
          min: { "@path": "/limits/min" },
          max: { "@path": "/limits/max" },
          step: { "@path": "/limits/step" },
          label: { "@path": "/copy/label" },
          unit: { "@path": "/copy/unit" },
          marks: { "@path": "/marks" },
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
    expect(v.reportError).not.toHaveBeenCalled();
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
    const v = render(
      [
        {
          id: "root",
          component: "Slider",
          value: { "@path": "/v" },
          min: { "@path": "/nope/min" },
          max: { "@path": "/nope/max" },
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
    const v = render(
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
    expect(await v.findByText("Enterprise")).toBeTruthy();
    expect(v.reportError).not.toHaveBeenCalled();
    expect(v.getByText("Price")).toBeTruthy();
    expect(v.container.querySelectorAll("tbody tr").length).toBe(2);
  });

  it("Chart data and series resolve from data paths", async () => {
    const v = render(
      [
        {
          id: "root",
          component: "Chart",
          chartType: "bar",
          data: { "@path": "/sales" },
          xKey: "month",
          series: { "@path": "/series" },
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
    expect(v.reportError).not.toHaveBeenCalled();
    expect((await v.findAllByText("Revenue")).length).toBeGreaterThan(0);
    expect(v.getAllByText("Feb").length).toBeGreaterThan(0);
    expect(v.getAllByText("20").length).toBeGreaterThan(0);
  });

  it("Select, RadioGroup and SegmentedControl options resolve from data paths", async () => {
    const v = render(
      [
        { id: "root", component: "Column", children: ["s", "r", "g"] },
        {
          id: "s",
          component: "Select",
          value: { "@path": "/plan" },
          options: { "@path": "/plans" },
          label: { "@path": "/copy/plan" },
        },
        {
          id: "r",
          component: "RadioGroup",
          value: { "@path": "/plan" },
          options: { "@path": "/plans" },
        },
        {
          id: "g",
          component: "SegmentedControl",
          value: { "@path": "/plan" },
          options: { "@path": "/plans" },
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
    expect(v.reportError).not.toHaveBeenCalled();
    const select = v.container.querySelector("select") as HTMLSelectElement;
    expect(
      Array.from(select.options)
        .map((o) => o.value)
        .filter(Boolean),
    ).toEqual(["team", "enterprise"]);
    expect(v.container.querySelectorAll('input[type="radio"]').length).toBe(2);
  });

  it("List items, text-field labels and DateTimeInput bounds resolve from data paths", async () => {
    const v = render(
      [
        { id: "root", component: "Column", children: ["l", "f", "d"] },
        { id: "l", component: "List", items: { "@path": "/todos" } },
        {
          id: "f",
          component: "TextField",
          value: { "@path": "/name" },
          label: { "@path": "/copy/name" },
          placeholder: { "@path": "/copy/hint" },
        },
        {
          id: "d",
          component: "DateTimeInput",
          value: { "@path": "/when" },
          min: { "@path": "/range/from" },
          max: { "@path": "/range/to" },
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
    expect(v.reportError).not.toHaveBeenCalled();
    expect(v.getByText("Write tests")).toBeTruthy();
    expect(v.getByText("Name")).toBeTruthy();
    expect(v.getByPlaceholderText("Your name")).toBeTruthy();
    const date = v.container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    expect(date.min).toBe("2026-01-01");
    expect(date.max).toBe("2026-01-31");
  });

  it("FollowUp items and ImageGrid images resolve from data paths", async () => {
    const v = render(
      [
        { id: "root", component: "Column", children: ["f", "g"] },
        { id: "f", component: "FollowUp", items: { "@path": "/next" } },
        { id: "g", component: "ImageGrid", images: { "@path": "/pics" } },
      ],
      {
        next: ["Cheaper", { label: "Luxury" }],
        pics: [{ url: "https://example.com/1.png", description: "one" }],
      },
    );
    expect(await v.findByRole("button", { name: "Luxury" })).toBeTruthy();
    expect(v.getByAltText("one")).toBeTruthy();
    expect(v.reportError).not.toHaveBeenCalled();
  });
});
