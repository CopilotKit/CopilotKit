import { describe, expect, it } from "vitest";
import { renderInputs } from "./helpers";

// A port of the input cases of React's
// `standard/__tests__/bindings-parity.test.tsx`: literal props take
// `{ "@path" }` bindings, and the components read the bound values.
//
// Skipped (they test components of other groups): "Table rows and columns
// resolve from data paths", "Chart data and series resolve from data
// paths", "FollowUp items and ImageGrid images resolve from data paths".
// "List items, text-field labels and DateTimeInput bounds resolve from data
// paths" is ported without its List.

/** The range input of the view. Fails the test when there is none. */
function rangeOf(view: ReturnType<typeof renderInputs>) {
  const range = view.container.querySelector('input[type="range"]');
  if (!(range instanceof HTMLInputElement)) throw new Error("No range.");
  return range;
}

describe("standard catalog: data-model bindings on literal props (parity)", () => {
  it("Slider min/max/step/label/unit/marks accept { path } bindings", async () => {
    const v = renderInputs(
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
    const range = rangeOf(v);
    expect(range.min).toBe("5");
    expect(range.max).toBe("40");
    expect(range.step).toBe("5");
    expect(v.getByText("12 users")).toBeTruthy();
    expect(v.getByText("Few")).toBeTruthy();
  });

  it("Slider keeps its defaults when bound paths are missing", async () => {
    const v = renderInputs(
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
    const range = rangeOf(v);
    expect(range.min).toBe("0");
    expect(range.max).toBe("100");
  });

  it("Select, RadioGroup and SegmentedControl options resolve from data paths", async () => {
    const v = renderInputs(
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
    const select = v.container.querySelector("select");
    expect(
      Array.from(select?.options ?? [])
        .map((option) => option.value)
        .filter(Boolean),
    ).toEqual(["team", "enterprise"]);
    expect(v.container.querySelectorAll('input[type="radio"]').length).toBe(2);
  });

  it("List items, text-field labels and DateTimeInput bounds resolve from data paths", async () => {
    const v = renderInputs(
      [
        { id: "root", component: "Column", children: ["f", "d"] },
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
        name: "",
        copy: { name: "Name", hint: "Your name" },
        when: "2026-01-05",
        range: { from: "2026-01-01", to: "2026-01-31" },
      },
    );
    expect(await v.findByText("Name")).toBeTruthy();
    expect(v.reportError).not.toHaveBeenCalled();
    expect(v.getByPlaceholderText("Your name")).toBeTruthy();
    const date = v.container.querySelector('input[type="date"]');
    if (!(date instanceof HTMLInputElement)) throw new Error("No date field.");
    expect(date.min).toBe("2026-01-01");
    expect(date.max).toBe("2026-01-31");
  });
});
