import { describe, expect, it } from "vitest";
import { renderSurface } from "../../__tests__/render";
import type { SurfaceRender } from "../../__tests__/render";
import { standardUI } from "../index";

/**
 * Tests ported from the a2ui-renderer standard catalog: literal props take
 * `{ path }` bindings. On this engine every prop accepts a binding, so the
 * tests pin that the components read the bound values. Without a chart
 * loader the Chart shows its data table, which makes bound rows visible.
 */

const render = (
  ...args: Parameters<typeof renderSurface> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => renderSurface(standardUI, ...args);

/** The element whose own text is `text`. */
function byText(view: SurfaceRender, text: string): HTMLElement {
  const match = [...view.container.querySelectorAll<HTMLElement>("*")].find(
    (el) =>
      [...el.childNodes].some(
        (node) => node.nodeType === 3 && node.textContent?.trim() === text,
      ),
  );
  if (!match) throw new Error(`No element with the text "${text}".`);
  return match;
}

describe("standard catalog: data-model bindings on literal props (parity)", () => {
  it("Slider min/max/step/label/unit/marks accept { path } bindings", () => {
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
    expect(byText(v, "Seats")).toBeTruthy();
    expect(v.reportError).not.toHaveBeenCalled();
    const range = v.container.querySelector<HTMLInputElement>(
      'input[type="range"]',
    )!;
    expect(range.min).toBe("5");
    expect(range.max).toBe("40");
    expect(range.step).toBe("5");
    expect(byText(v, "12 users")).toBeTruthy();
    expect(byText(v, "Few")).toBeTruthy();
  });

  it("Slider keeps its defaults when bound paths are missing", () => {
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
    expect(byText(v, "Volume")).toBeTruthy();
    const range = v.container.querySelector<HTMLInputElement>(
      'input[type="range"]',
    )!;
    expect(range.min).toBe("0");
    expect(range.max).toBe("100");
  });

  it("Chart data and series resolve from data paths", () => {
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
    expect(byText(v, "Sales")).toBeTruthy();
    expect(v.reportError).not.toHaveBeenCalled();
    const text = v.container.textContent ?? "";
    expect(text).toContain("Revenue");
    expect(text).toContain("Feb");
    expect(text).toContain("20");
  });

  it("Select, RadioGroup and SegmentedControl options resolve from data paths", () => {
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
    expect(byText(v, "Choose a plan")).toBeTruthy();
    expect(v.reportError).not.toHaveBeenCalled();
    const select = v.container.querySelector("select")!;
    expect(
      [...select.options].map((option) => option.value).filter(Boolean),
    ).toEqual(["team", "enterprise"]);
    expect(v.container.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(v.container.querySelectorAll("[role=radio]")).toHaveLength(2);
  });

  it("List items, text-field labels and DateTimeInput bounds resolve from data paths", () => {
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
    expect(byText(v, "Ship it")).toBeTruthy();
    expect(v.reportError).not.toHaveBeenCalled();
    expect(byText(v, "Write tests")).toBeTruthy();
    expect(byText(v, "Name").tagName).toBe("LABEL");
    expect(
      v.container.querySelector('input[placeholder="Your name"]'),
    ).not.toBeNull();
    const date =
      v.container.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(date.min).toBe("2026-01-01");
    expect(date.max).toBe("2026-01-31");
  });

  it("FollowUp items and ImageGrid images resolve from data paths", () => {
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
    expect(
      [...v.container.querySelectorAll("button")].map((button) =>
        button.textContent?.trim(),
      ),
    ).toContain("Luxury");
    expect(v.container.querySelector('img[alt="one"]')).not.toBeNull();
    expect(v.reportError).not.toHaveBeenCalled();
  });
});
