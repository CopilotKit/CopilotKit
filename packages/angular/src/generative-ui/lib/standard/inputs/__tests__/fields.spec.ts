import { describe, expect, it, vi } from "vitest";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { renderSurface, updateDataModel } from "../../../__tests__/render";
import { byLabel, byText, click, query } from "../../../__tests__/dom";
import { standardUI } from "../../index";
import { inputComponents } from "../index";
import {
  byAriaLabel,
  keyDown,
  PLAN_OPTIONS,
  renderInputs,
  setValue,
  ui,
} from "./helpers";
import type { View } from "./helpers";

describe("inputComponents", () => {
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    const names = Object.keys(inputComponents);
    expect(names).toEqual([
      "Button",
      "Pressable",
      "Form",
      "TextField",
      "TextArea",
      "Select",
      "CheckBox",
      "Radio",
      "RadioGroup",
      "Slider",
      "SegmentedControl",
      "ChoicePicker",
      "DateTimeInput",
    ]);
    for (const name of names) {
      expect(ui.manifestComponents[name]!.description).toMatch(/\S/);
    }
    expect(Object.keys(ui.manifestComponents.Button!.events ?? {})).toEqual([
      "onClick",
    ]);
    expect(Object.keys(ui.manifestComponents.Form!.events ?? {})).toEqual([
      "onSubmit",
    ]);
    expect(ui.manifestComponents.Pressable!.slots).toEqual({
      children: "multiple",
    });
  });

  it("Pressable and Form repeat a template child per data item", () => {
    const v = renderSurface(
      standardUI,
      [
        { id: "root", component: "Column", children: ["p", "f"] },
        {
          id: "p",
          component: "Pressable",
          children: { componentId: "pr", path: "/a" },
        },
        { id: "pr", component: "Text", text: { "@path": "name" } },
        {
          id: "f",
          component: "Form",
          children: { componentId: "fr", path: "/b" },
        },
        { id: "fr", component: "Text", text: { "@path": "name" } },
      ],
      { a: [{ name: "P1" }, { name: "P2" }], b: [{ name: "F1" }] },
    );
    expect(byText(v.container, "P1").closest("[role=button]")).not.toBeNull();
    expect(byText(v.container, "P2").closest("[role=button]")).not.toBeNull();
    expect(byText(v.container, "F1").closest("form")).not.toBeNull();
  });
});

describe("standard inputs: values", () => {
  it("writes what the user types into a bound path, and an agent write to that path later does not change it", () => {
    const view = renderInputs(
      [
        { id: "root", component: "Column", children: ["f", "t"] },
        {
          id: "f",
          component: "TextField",
          label: "Email",
          value: { "@path": "/form/email" },
        },
        { id: "t", component: "Label", text: { "@path": "/form/email" } },
      ],
      { form: { email: "" } },
    );
    const field = byLabel<HTMLInputElement>(view.container, "Email");
    expect(field.type).toBe("text");
    setValue(view, field, "ada@example.com");
    expect(view.dataAt("/form/email")).toBe("ada@example.com");
    expect(
      query(view.container, "[data-testid=label]").textContent?.trim(),
    ).toBe("ada@example.com");
    view.update(updateDataModel("/form/email", "agent@example.com"));
    expect(view.dataAt("/form/email")).toBe("ada@example.com");
    expect(byLabel<HTMLInputElement>(view.container, "Email").value).toBe(
      "ada@example.com",
    );
  });

  it("keeps a literal value in local state and does not write the data model", () => {
    const view = renderInputs(
      [{ id: "root", component: "TextArea", label: "Notes", value: "Draft" }],
      { notes: "unchanged" },
    );
    const area = byLabel<HTMLTextAreaElement>(view.container, "Notes");
    expect(area.value).toBe("Draft");
    setValue(view, area, "Final");
    expect(byLabel<HTMLTextAreaElement>(view.container, "Notes").value).toBe(
      "Final",
    );
    expect(view.dataAt("/")).toEqual({ notes: "unchanged" });
  });

  it("sizes an autoResize TextArea to the value of the model, not only to typing", () => {
    // jsdom has no layout: the height of the text is 24px per line.
    const scrollHeight = vi
      .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLTextAreaElement) {
        return this.value.split("\n").length * 24;
      });
    try {
      const view = renderInputs(
        [
          {
            id: "root",
            component: "TextArea",
            label: "Notes",
            autoResize: true,
            value: { "@path": "/notes" },
          },
        ],
        { notes: "1\n2\n3\n4\n5" },
      );
      const area = byLabel<HTMLTextAreaElement>(view.container, "Notes");
      expect(area.style.height).toBe("120px");
      view.update(updateDataModel("/notes", "1\n2\n3\n4\n5\n6\n7"));
      expect(area.style.height).toBe("168px");
      setValue(view, area, "1\n2");
      expect(area.style.height).toBe("48px");
    } finally {
      scrollHeight.mockRestore();
    }
  });

  it("writes a CheckBox state to its value path", () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "CheckBox",
          label: "Annual billing",
          value: { "@path": "/annual" },
        },
      ],
      { annual: false },
    );
    const box = byLabel<HTMLInputElement>(view.container, "Annual billing");
    expect(box.checked).toBe(false);
    expect(box.getAttribute("data-shape")).toBe("round");
    click(view, box);
    expect(view.dataAt("/annual")).toBe(true);
    expect(
      byLabel<HTMLInputElement>(view.container, "Annual billing").checked,
    ).toBe(true);
  });

  it("writes a Slider value as a number and shows it with the unit", () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "Slider",
          label: "Seats",
          unit: "users",
          value: { "@path": "/seats" },
          min: { "@path": "/limits/min" },
          max: { "@path": "/limits/max" },
          step: 1,
        },
      ],
      { seats: 8, limits: { min: 1, max: 50 } },
    );
    const range = byLabel<HTMLInputElement>(view.container, "Seats");
    expect(range.type).toBe("range");
    expect(range.className).toBe("a2ui-std-range");
    expect(range.min).toBe("1");
    expect(range.max).toBe("50");
    expect(view.container.textContent).toContain("8 users");
    setValue(view, range, "12");
    expect(view.dataAt("/seats")).toBe(12);
    expect(view.container.textContent).toContain("12 users");
  });

  it("writes a DateTimeInput date and clears it with the clear button", () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Start date",
          value: { "@path": "/when" },
          clearable: true,
        },
      ],
      { when: "" },
    );
    const date = byLabel<HTMLInputElement>(view.container, "Start date");
    expect(date.type).toBe("date");
    setValue(view, date, "2026-01-05");
    expect(view.dataAt("/when")).toBe("2026-01-05");
    click(view, byAriaLabel(view.container, "Clear"));
    expect(view.dataAt("/when")).toBe("");
  });
});

describe("standard inputs: options", () => {
  const planControls: A2UIComponentNode[] = [
    { id: "root", component: "Column", children: ["s", "r", "g"] },
    {
      id: "s",
      component: "Select",
      label: "Plan",
      value: { "@path": "/plan" },
      options: { "@path": "/plans" },
    },
    {
      id: "r",
      component: "RadioGroup",
      label: "Plan choice",
      value: { "@path": "/plan" },
      options: ["team", "enterprise"],
    },
    {
      id: "g",
      component: "SegmentedControl",
      label: "Plan segment",
      value: { "@path": "/plan" },
      options: [
        { value: "team", label: "Team seg" },
        { value: "enterprise", label: "Ent seg" },
      ],
    },
  ];

  const segment = (view: View, label: string) => {
    const buttons = [
      ...view.container.querySelectorAll<HTMLButtonElement>("[role=radio]"),
    ];
    const match = buttons.find((b) => b.textContent?.trim() === label);
    if (!match) throw new Error(`No segment "${label}".`);
    return match;
  };

  it("reads options as strings, objects, or a bound path, and shares one value", () => {
    const view = renderInputs(planControls, {
      plan: "team",
      plans: PLAN_OPTIONS,
    });
    const select = byLabel<HTMLSelectElement>(view.container, "Plan");
    expect([...select.options].map((option) => option.label)).toEqual([
      "Team",
      "Enterprise",
    ]);
    setValue(view, select, "enterprise");
    expect(view.dataAt("/plan")).toBe("enterprise");
    const radio = query<HTMLInputElement>(
      view.container,
      'input[type="radio"][value="enterprise"]',
    );
    expect(radio.checked).toBe(true);
    expect(segment(view, "Ent seg").getAttribute("aria-checked")).toBe("true");
    click(view, segment(view, "Team seg"));
    expect(view.dataAt("/plan")).toBe("team");
    expect(byLabel<HTMLSelectElement>(view.container, "Plan").value).toBe(
      "team",
    );
  });

  it("keeps the left padding of a Select without an icon, and widens it for an icon", () => {
    const view = renderInputs([
      { id: "root", component: "Column", children: ["plain", "iconed"] },
      { id: "plain", component: "Select", label: "Plain", options: ["a"] },
      {
        id: "iconed",
        component: "Select",
        label: "With icon",
        icon: "search",
        options: ["a"],
      },
    ]);
    const plain = byLabel<HTMLSelectElement>(view.container, "Plain");
    const iconed = byLabel<HTMLSelectElement>(view.container, "With icon");
    expect(plain.style.paddingLeft).not.toBe("");
    expect(parseFloat(iconed.style.paddingLeft)).toBeGreaterThan(
      parseFloat(plain.style.paddingLeft),
    );
  });

  it("moves the SegmentedControl selection and focus with the arrow keys, as one tab stop", () => {
    const view = renderInputs(planControls, {
      plan: "team",
      plans: PLAN_OPTIONS,
    });
    const team = segment(view, "Team seg");
    expect(team.tabIndex).toBe(0);
    expect(segment(view, "Ent seg").tabIndex).toBe(-1);
    keyDown(view, team, "ArrowRight");
    const enterprise = segment(view, "Ent seg");
    expect(view.dataAt("/plan")).toBe("enterprise");
    expect(document.activeElement).toBe(enterprise);
    expect(enterprise.tabIndex).toBe(0);
    // The arrow keys wrap at the end.
    keyDown(view, enterprise, "ArrowRight");
    expect(view.dataAt("/plan")).toBe("team");
  });

  it("shows option descriptions in a RadioGroup and names the group with its legend", () => {
    const view = renderInputs([
      {
        id: "root",
        component: "RadioGroup",
        label: "Support",
        variant: "cards",
        options: [
          { value: "basic", label: "Basic", description: "Email only" },
        ],
      },
    ]);
    const fieldset = query<HTMLFieldSetElement>(view.container, "fieldset");
    expect(fieldset.querySelector("legend")?.textContent).toBe("Support");
    expect(view.container.textContent).toContain("Email only");
    const option = fieldset.querySelector("label")!;
    expect(option.style.border).toContain("1px solid");
  });

  it("lets a ChoicePicker pick several options as a list of values", () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "ChoicePicker",
          label: "Toppings",
          variant: "multipleSelection",
          options: ["cheese", "olives"],
          value: { "@path": "/toppings" },
        },
      ],
      { toppings: [] },
    );
    const boxes = [
      ...view.container.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      ),
    ];
    expect(boxes).toHaveLength(2);
    click(view, boxes[0]!);
    expect(view.dataAt("/toppings")).toEqual(["cheese"]);
    click(view, boxes[1]!);
    expect(view.dataAt("/toppings")).toEqual(["cheese", "olives"]);
    click(view, boxes[0]!);
    expect(view.dataAt("/toppings")).toEqual(["olives"]);
  });
});
