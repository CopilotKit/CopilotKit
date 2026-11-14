import { describe, expect, it } from "vitest";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { renderSurface } from "../../__tests__/helpers/render-surface";
import { standardUI } from "../index";

/**
 * The port of Angular's `standard/__tests__/literal-bindings.spec.ts`, the
 * Angular form of React's `standard/__tests__/bindings-parity.test.tsx`.
 * Every prop accepts a `{ path }` binding, so these tests pin that the
 * components read the bound values of props that are literal in the schema.
 * Without a chart loader the Chart shows its data table, which makes bound
 * rows visible.
 *
 * The input group's `bindings-parity.test.ts` renders the input cases with
 * stand-ins. This file renders every case through `standardUI`, so it also
 * owns the cases that need other groups: the Chart, the List, FollowUp and
 * ImageGrid.
 */

const render = (
  components: A2UIComponentNode[],
  data?: Record<string, unknown>,
) => renderSurface(standardUI, components, data);

/** The first element of `selector` in the view. Fails the test when there is none. */
function elementOf<Kind extends Element>(
  view: ReturnType<typeof render>,
  selector: string,
  kind: abstract new () => Kind,
) {
  const element = view.container.querySelector(selector);
  if (!(element instanceof kind)) throw new Error(`No ${selector}.`);
  return element;
}

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
    const range = elementOf(v, 'input[type="range"]', HTMLInputElement);
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
    const range = elementOf(v, 'input[type="range"]', HTMLInputElement);
    expect(range.min).toBe("0");
    expect(range.max).toBe("100");
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
    expect(await v.findByText("Sales")).toBeTruthy();
    expect(v.reportError).not.toHaveBeenCalled();
    const text = v.container.textContent ?? "";
    expect(text).toContain("Revenue");
    expect(text).toContain("Feb");
    expect(text).toContain("20");
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
    const select = elementOf(v, "select", HTMLSelectElement);
    expect(
      [...select.options].map((option) => option.value).filter(Boolean),
    ).toEqual(["team", "enterprise"]);
    expect(v.container.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(v.container.querySelectorAll("[role=radio]")).toHaveLength(2);
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
    expect(v.getByText("Name").tagName).toBe("LABEL");
    expect(
      v.container.querySelector('input[placeholder="Your name"]'),
    ).not.toBeNull();
    const date = elementOf(v, 'input[type="date"]', HTMLInputElement);
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
    expect(await v.findByAltText("one")).toBeTruthy();
    expect(
      [...v.container.querySelectorAll("button")].map((button) =>
        button.textContent?.trim(),
      ),
    ).toContain("Luxury");
    expect(v.reportError).not.toHaveBeenCalled();
  });
});
