import React from "react";
import { act, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { createGenerativeUI } from "../../catalog";
import {
  describeDateTime,
  inputComponents,
  splitDateTime,
  timeInRange,
  timeSlots,
} from "../inputs";
import { layoutComponents } from "../layout";
import { SURFACE_ID, renderSurface } from "./render";

/** A test-only text leaf, so a test can show a data model value. */
function Label({ text }: { text?: string | number }) {
  return <span data-testid="label">{text}</span>;
}

const ui = createGenerativeUI({
  id: "test/inputs@1",
  components: {
    ...layoutComponents,
    ...inputComponents,
    Label: {
      component: Label,
      props: z.object({ text: z.union([z.string(), z.number()]).optional() }),
    },
  },
});

function renderInputs(
  components: A2UIComponentNode[],
  data?: Record<string, unknown>,
) {
  return renderSurface(ui, components, data);
}

/** An agent write to the data model of the test surface. */
function agentWrite(path: string, value: unknown) {
  return {
    version: "v1.0" as const,
    updateDataModel: { surfaceId: SURFACE_ID, path, value },
  };
}

/** The element as a `type` element. Fails the test when it is another kind. */
function narrow<Kind extends HTMLElement>(
  element: HTMLElement,
  type: new () => Kind,
) {
  if (!(element instanceof type)) {
    throw new Error(`Expected a ${type.name}, got <${element.tagName}>.`);
  }
  return element;
}

/** The names of the events that the agent got, in order. */
function sentEventNames(view: ReturnType<typeof renderInputs>) {
  return view.forwardEvent.mock.calls.map(([event]) => event.name);
}

const PLAN_OPTIONS = [
  { value: "team", label: "Team" },
  { value: "enterprise", label: "Enterprise" },
];

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
      expect(ui.manifestComponents[name].description).toMatch(/\S/);
    }
    expect(Object.keys(ui.manifestComponents.Button.events ?? {})).toEqual([
      "onClick",
    ]);
    expect(Object.keys(ui.manifestComponents.Form.events ?? {})).toEqual([
      "onSubmit",
    ]);
    expect(ui.manifestComponents.Pressable.slots).toEqual({
      children: "multiple",
    });
  });
});

describe("standard inputs: values", () => {
  it("writes what the user types into a bound path, and an agent write to that path later does not change it", async () => {
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
    const field = await view.findByLabelText("Email");
    fireEvent.change(field, { target: { value: "ada@example.com" } });
    expect(view.dataAt("/form/email")).toBe("ada@example.com");
    expect(view.getByTestId("label").textContent).toBe("ada@example.com");

    view.update(agentWrite("/form/email", "agent@example.com"));
    expect(view.dataAt("/form/email")).toBe("ada@example.com");
    expect(narrow(view.getByLabelText("Email"), HTMLInputElement).value).toBe(
      "ada@example.com",
    );
  });

  it("keeps a literal value in local state and does not write the data model", async () => {
    const view = renderInputs(
      [{ id: "root", component: "TextArea", label: "Notes", value: "Draft" }],
      { notes: "unchanged" },
    );
    const area = narrow(
      await view.findByLabelText("Notes"),
      HTMLTextAreaElement,
    );
    expect(area.value).toBe("Draft");
    fireEvent.change(area, { target: { value: "Final" } });
    expect(
      narrow(view.getByLabelText("Notes"), HTMLTextAreaElement).value,
    ).toBe("Final");
    expect(view.dataAt("/")).toEqual({ notes: "unchanged" });
  });

  it("writes a CheckBox state to its value path", async () => {
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
    const box = narrow(
      await view.findByLabelText("Annual billing"),
      HTMLInputElement,
    );
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(view.dataAt("/annual")).toBe(true);
    expect(
      narrow(view.getByLabelText("Annual billing"), HTMLInputElement).checked,
    ).toBe(true);
  });

  it("writes a Slider value as a number and shows it with the unit", async () => {
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
    const range = narrow(await view.findByLabelText("Seats"), HTMLInputElement);
    expect(range.min).toBe("1");
    expect(range.max).toBe("50");
    expect(view.getByText("8 users")).toBeTruthy();
    fireEvent.change(range, { target: { value: "12" } });
    expect(view.dataAt("/seats")).toBe(12);
    expect(view.getByText("12 users")).toBeTruthy();
  });

  it("writes a DateTimeInput date and clears it with the clear button", async () => {
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
    const date = await view.findByLabelText("Start date");
    fireEvent.change(date, { target: { value: "2026-01-05" } });
    expect(view.dataAt("/when")).toBe("2026-01-05");
    fireEvent.click(view.getByRole("button", { name: "Clear" }));
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

  it("reads options as strings, objects, or a bound path, and shares one value", async () => {
    const view = renderInputs(planControls, {
      plan: "team",
      plans: PLAN_OPTIONS,
    });
    const select = narrow(
      await view.findByLabelText("Plan"),
      HTMLSelectElement,
    );
    expect(Array.from(select.options).map((option) => option.label)).toEqual([
      "Team",
      "Enterprise",
    ]);

    fireEvent.change(select, { target: { value: "enterprise" } });
    expect(view.dataAt("/plan")).toBe("enterprise");
    expect(
      narrow(view.getByRole("radio", { name: "enterprise" }), HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      view.getByRole("radio", { name: "Ent seg" }).getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(view.getByRole("radio", { name: "Team seg" }));
    expect(view.dataAt("/plan")).toBe("team");
    expect(narrow(view.getByLabelText("Plan"), HTMLSelectElement).value).toBe(
      "team",
    );
  });

  it("moves the SegmentedControl selection and focus with the arrow keys, as one tab stop", async () => {
    const view = renderInputs(planControls, {
      plan: "team",
      plans: PLAN_OPTIONS,
    });
    const team = await view.findByRole("radio", { name: "Team seg" });
    expect(team.tabIndex).toBe(0);
    expect(view.getByRole("radio", { name: "Ent seg" }).tabIndex).toBe(-1);

    fireEvent.keyDown(team, { key: "ArrowRight" });
    const enterprise = view.getByRole("radio", { name: "Ent seg" });
    expect(view.dataAt("/plan")).toBe("enterprise");
    expect(document.activeElement).toBe(enterprise);
    expect(enterprise.tabIndex).toBe(0);

    // The arrow keys wrap at the end.
    fireEvent.keyDown(enterprise, { key: "ArrowRight" });
    expect(view.dataAt("/plan")).toBe("team");
  });

  it("shows option descriptions in a RadioGroup and names the group with its legend", async () => {
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
    expect(await view.findByRole("group", { name: "Support" })).toBeTruthy();
    expect(view.getByText("Email only")).toBeTruthy();
  });
});

describe("standard inputs: events", () => {
  it("renders Button text when label is not set, and prefers label", async () => {
    const view = renderInputs([
      { id: "root", component: "Row", children: ["a", "b"] },
      { id: "a", component: "Button", text: "Request quote" },
      { id: "b", component: "Button", label: "Send", text: "Ignored" },
    ]);
    expect(
      await view.findByRole("button", { name: "Request quote" }),
    ).toBeTruthy();
    expect(view.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(view.queryByText("Ignored")).toBeNull();
  });

  it("sends a bound Button event with its context read from the data model at click time", async () => {
    const view = renderInputs(
      [
        { id: "root", component: "Column", children: ["f", "b"] },
        {
          id: "f",
          component: "TextField",
          label: "Email",
          value: { "@path": "/form/email" },
        },
        {
          id: "b",
          component: "Button",
          label: "Subscribe",
          onClick: {
            event: {
              name: "subscribe",
              context: { email: { "@path": "/form/email" }, source: "footer" },
            },
          },
        },
      ],
      { form: { email: "" } },
    );
    fireEvent.change(await view.findByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(view.getByRole("button", { name: "Subscribe" }));
    expect(view.forwardEvent).toHaveBeenCalledTimes(1);
    expect(view.forwardEvent.mock.calls[0][0]).toEqual({
      name: "subscribe",
      surfaceId: SURFACE_ID,
      componentId: "b",
      timestamp: expect.any(String),
      context: { email: "ada@example.com", source: "footer" },
    });
  });

  it("applies the accessibility envelope to a field and to a CheckBox", async () => {
    const view = renderInputs([
      { id: "root", component: "Column", children: ["f", "c"] },
      {
        id: "f",
        component: "TextField",
        label: "Email",
        accessibility: { label: "Contact email", description: "Work address" },
      },
      {
        id: "c",
        component: "CheckBox",
        label: "Terms",
        accessibility: { hidden: true },
      },
    ]);
    const group = await view.findByRole("group", { name: "Contact email" });
    expect(group.getAttribute("aria-description")).toBe("Work address");
    // The control itself carries the name: ARIA names do not inherit.
    const input = view.getByRole("textbox", { name: "Contact email" });
    expect(input.getAttribute("aria-description")).toBe("Work address");
    expect(group.contains(input)).toBe(true);
    const box = view.getByLabelText("Terms");
    expect(box.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("names a Button by the accessibility label of its envelope", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Button",
        label: "Go",
        accessibility: { label: "Send the order", description: "Final step" },
      },
    ]);
    const button = await view.findByRole("button", { name: "Send the order" });
    expect(button.getAttribute("aria-description")).toBe("Final step");
    expect(button.textContent).toBe("Go");
  });

  it("does not send the event of a disabled Button", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Button",
        label: "Nope",
        disabled: true,
        onClick: { event: { name: "nope" } },
      },
    ]);
    fireEvent.click(await view.findByRole("button", { name: "Nope" }));
    expect(view.forwardEvent).not.toHaveBeenCalled();
  });

  it("sends only the Form onSubmit when a submit Button inside the Form is clicked", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "Form",
          label: "Signup",
          children: ["f", "b"],
          onSubmit: {
            event: {
              name: "signup",
              context: { email: { "@path": "/form/email" } },
            },
          },
        },
        {
          id: "f",
          component: "TextField",
          label: "Email",
          value: { "@path": "/form/email" },
        },
        {
          id: "b",
          component: "Button",
          label: "Send",
          submit: true,
          onClick: { event: { name: "button-click" } },
        },
      ],
      { form: { email: "" } },
    );
    expect(await view.findByRole("form", { name: "Signup" })).toBeTruthy();
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(view.getByRole("button", { name: "Send" }));
    expect(sentEventNames(view)).toEqual(["signup"]);
    expect(view.forwardEvent.mock.calls[0][0].context).toEqual({
      email: "ada@example.com",
    });
  });

  it("sends the onClick of a submit Button that is outside of a Form", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Button",
        label: "Lone",
        submit: true,
        onClick: { event: { name: "lone-submit" } },
      },
    ]);
    fireEvent.click(await view.findByRole("button", { name: "Lone" }));
    expect(sentEventNames(view)).toEqual(["lone-submit"]);
  });

  it("sends only the innermost event when a control inside a Pressable is used", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Pressable",
        children: ["inner", "b"],
        onClick: { event: { name: "outer" } },
      },
      {
        id: "inner",
        component: "Pressable",
        children: ["t"],
        onClick: { event: { name: "inner" } },
      },
      { id: "t", component: "Label", text: "Inner" },
      {
        id: "b",
        component: "Button",
        label: "Click",
        onClick: { event: { name: "button" } },
      },
    ]);
    fireEvent.click(await view.findByRole("button", { name: "Click" }));
    fireEvent.click(view.getByText("Inner"));
    expect(sentEventNames(view)).toEqual(["button", "inner"]);
  });

  it("presses a Pressable with Enter, but not when Enter is on a Button inside it", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Pressable",
        children: ["b"],
        onClick: { event: { name: "outer" } },
      },
      {
        id: "b",
        component: "Button",
        label: "Key",
        onClick: { event: { name: "button" } },
      },
    ]);
    // The Pressable takes its name from its content, so both are "Key".
    const [pressable, button] = await view.findAllByRole("button", {
      name: "Key",
    });
    fireEvent.keyDown(button, { key: "Enter" });
    expect(view.forwardEvent).not.toHaveBeenCalled();
    fireEvent.keyDown(pressable, { key: "Enter" });
    expect(sentEventNames(view)).toEqual(["outer"]);
  });
});

describe("standard inputs: DateTimeInput", () => {
  const inWords = (
    date: string,
    time: string,
    mode: "date" | "time" | "datetime",
  ) => describeDateTime({ date, time }, mode);

  it("splits an ISO value into its date and its time", () => {
    expect(splitDateTime("2026-10-23T14:30")).toEqual({
      date: "2026-10-23",
      time: "14:30",
    });
    expect(splitDateTime("2026-10-23")).toEqual({
      date: "2026-10-23",
      time: "",
    });
    expect(splitDateTime("09:15")).toEqual({ date: "", time: "09:15" });
    expect(splitDateTime("")).toEqual({ date: "", time: "" });
  });

  it("says the value in words with the hour of the day, and nothing for an incomplete value", () => {
    const text = describeDateTime(
      { date: "2026-10-23", time: "14:30" },
      "datetime",
      "en-US",
    );
    expect(text).toContain("Oct 23, 2026");
    expect(text).toContain("2:30");
    expect(text).toContain("PM");
    expect(describeDateTime({ date: "", time: "09:05" }, "time", "en-US")).toBe(
      "9:05 AM",
    );
    expect(
      describeDateTime({ date: "2026-10-23", time: "" }, "datetime"),
    ).toBeUndefined();
    expect(
      describeDateTime({ date: "soon", time: "" }, "date"),
    ).toBeUndefined();
  });

  it("lists the times of a day step minutes apart within the bounds, keeping a current off-step time", () => {
    expect(timeSlots(360)).toEqual(["00:00", "06:00", "12:00", "18:00"]);
    expect(timeSlots(30, "09:00", "10:30")).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
    ]);
    expect(timeSlots(60, "09:00", "11:00", "09:45")).toEqual([
      "09:00",
      "09:45",
      "10:00",
      "11:00",
    ]);
  });

  it("shows a date and a time as two named fields under one label and writes the value once both are set", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Pickup",
          enableDate: true,
          enableTime: true,
          value: { "@path": "/when" },
        },
      ],
      { when: "" },
    );
    const group = await view.findByRole("group", { name: "Pickup" });
    const date = within(group).getByLabelText("Date") as HTMLInputElement;
    const time = within(group).getByLabelText("Time") as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(time.type).toBe("time");
    fireEvent.change(date, { target: { value: "2026-10-23" } });
    // Half a value is not a value.
    expect(view.dataAt("/when")).toBe("");
    expect(date.value).toBe("2026-10-23");
    fireEvent.change(time, { target: { value: "14:30" } });
    expect(view.dataAt("/when")).toBe("2026-10-23T14:30");
    expect(
      view.getByText(inWords("2026-10-23", "14:30", "datetime")!),
    ).toBeTruthy();
    // Clearing the time clears the value and keeps the date.
    fireEvent.change(time, { target: { value: "" } });
    expect(view.dataAt("/when")).toBe("");
    expect(date.value).toBe("2026-10-23");
  });

  it("shows a value the agent writes, and clears both fields with the clear button", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Pickup",
          enableDate: true,
          enableTime: true,
          clearable: true,
          value: { "@path": "/when" },
        },
      ],
      { when: "2026-10-23T09:00" },
    );
    const date = (await view.findByLabelText("Date")) as HTMLInputElement;
    const time = view.getByLabelText("Time") as HTMLInputElement;
    expect([date.value, time.value]).toEqual(["2026-10-23", "09:00"]);
    act(() => view.update(agentWrite("/when", "2026-11-02T17:15")));
    expect([date.value, time.value]).toEqual(["2026-11-02", "17:15"]);
    fireEvent.click(view.getByRole("button", { name: "Clear" }));
    expect(view.dataAt("/when")).toBe("");
    expect([date.value, time.value]).toEqual(["", ""]);
  });

  it("applies a time bound only on the day of that bound", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Pickup",
          enableDate: true,
          enableTime: true,
          min: "2026-10-23T09:00",
          max: "2026-10-30T17:00",
          value: { "@path": "/when" },
        },
      ],
      { when: "2026-10-23T10:00" },
    );
    const date = (await view.findByLabelText("Date")) as HTMLInputElement;
    const time = view.getByLabelText("Time") as HTMLInputElement;
    expect([date.min, date.max]).toEqual(["2026-10-23", "2026-10-30"]);
    expect([time.min, time.max]).toEqual(["09:00", ""]);
    fireEvent.change(date, { target: { value: "2026-10-30" } });
    expect([time.min, time.max]).toEqual(["", "17:00"]);
  });

  it("offers the times as a list with timeStep, named in words", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Call time",
          enableTime: true,
          timeStep: 30,
          min: "09:00",
          max: "10:00",
          value: { "@path": "/at" },
        },
      ],
      { at: "" },
    );
    const select = (await view.findByLabelText(
      "Call time",
    )) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect([...select.options].map((o) => o.value)).toEqual([
      "",
      "09:00",
      "09:30",
      "10:00",
    ]);
    expect(select.options[2].textContent).toBe(inWords("", "09:30", "time"));
    fireEvent.change(select, { target: { value: "09:30" } });
    expect(view.dataAt("/at")).toBe("09:30");
  });

  it("formats the value as written, not shifted by a daylight-saving gap of the viewer", () => {
    const zone = process.env.TZ;
    process.env.TZ = "Europe/Vienna";
    try {
      // 02:30 on 29 March 2026 does not exist in Vienna.
      const text = describeDateTime(
        { date: "2026-03-29", time: "02:30" },
        "datetime",
        "en-US",
      );
      expect(text).toContain("2:30");
      expect(text).not.toContain("3:30");
    } finally {
      process.env.TZ = zone;
    }
  });

  it("lists a range over midnight from its start", () => {
    expect(timeInRange("23:00", "22:00", "02:00")).toBe(true);
    expect(timeInRange("01:00", "22:00", "02:00")).toBe(true);
    expect(timeInRange("12:00", "22:00", "02:00")).toBe(false);
    expect(timeSlots(60, "22:00", "02:00")).toEqual([
      "22:00",
      "23:00",
      "00:00",
      "01:00",
      "02:00",
    ]);
  });

  it("marks a listed time that the date moved out of range as invalid, so a form does not submit it", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "Form",
          label: "Booking",
          children: ["when"],
        },
        {
          id: "when",
          component: "DateTimeInput",
          label: "Call",
          enableDate: true,
          enableTime: true,
          timeStep: 30,
          min: "2026-11-02T09:00",
          value: { "@path": "/when" },
        },
      ],
      { when: "2026-11-03T08:30" },
    );
    const form = (await view.findByRole("form")) as HTMLFormElement;
    const time = view.getByLabelText("Time") as HTMLSelectElement;
    // The day after the bound: 08:30 is fine.
    expect(form.checkValidity()).toBe(true);
    fireEvent.change(view.getByLabelText("Date"), {
      target: { value: "2026-11-02" },
    });
    expect(time.value).toBe("08:30");
    expect(time.getAttribute("aria-invalid")).toBe("true");
    expect(form.checkValidity()).toBe(false);
    expect(view.getByRole("alert").textContent).toBe(
      `Pick a time from ${inWords("", "09:00", "time")} to the end of the day`,
    );
    fireEvent.change(time, { target: { value: "09:30" } });
    expect(form.checkValidity()).toBe(true);
    expect(view.queryByRole("alert")).toBeNull();
  });

  it("steps the slots from the range start, and compares bounds with their seconds", () => {
    expect(timeSlots(30, "09:15", "10:15")).toEqual([
      "09:15",
      "09:45",
      "10:15",
    ]);
    expect(timeSlots(30, "09:15", "09:20")).toEqual(["09:15"]);
    expect(timeSlots(90, "23:00", "02:00")).toEqual([
      "23:00",
      "00:30",
      "02:00",
    ]);
    expect(timeInRange("10:00:30", undefined, "10:00")).toBe(false);
    expect(timeInRange("10:00", undefined, "10:00:30")).toBe(true);
  });

  it("gives an impossible date no summary rather than a rolled-over one", () => {
    expect(
      describeDateTime({ date: "2026-02-30", time: "" }, "date"),
    ).toBeUndefined();
    expect(
      describeDateTime({ date: "", time: "25:00" }, "time"),
    ).toBeUndefined();
  });

  it("does not let a form submit half a date and time, and allows both empty", async () => {
    const view = renderInputs(
      [
        { id: "root", component: "Form", label: "Booking", children: ["when"] },
        {
          id: "when",
          component: "DateTimeInput",
          label: "Pickup",
          enableDate: true,
          enableTime: true,
          value: { "@path": "/when" },
        },
      ],
      { when: "" },
    );
    const form = (await view.findByRole("form")) as HTMLFormElement;
    expect(form.checkValidity()).toBe(true);
    const time = view.getByLabelText("Time") as HTMLInputElement;
    fireEvent.change(view.getByLabelText("Date"), {
      target: { value: "2026-10-23" },
    });
    expect(form.checkValidity()).toBe(false);
    expect(time.validationMessage).toBe("Pick a time too");
    fireEvent.change(time, { target: { value: "14:30" } });
    expect(form.checkValidity()).toBe(true);
  });

  it("keeps a half-filled date and time when the agent writes the value afterwards", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Pickup",
          enableDate: true,
          enableTime: true,
          value: { "@path": "/when" },
        },
      ],
      { when: "" },
    );
    const date = (await view.findByLabelText("Date")) as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-10-23" } });
    act(() => view.update(agentWrite("/when", "2026-12-01T08:00")));
    expect(date.value).toBe("2026-10-23");
    expect(view.dataAt("/when")).toBe("");
  });

  it("keeps a single time field named by its label", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Alarm",
          enableTime: true,
          value: { "@path": "/alarm" },
        },
      ],
      { alarm: "07:45" },
    );
    const time = (await view.findByLabelText("Alarm")) as HTMLInputElement;
    expect(time.type).toBe("time");
    expect(time.value).toBe("07:45");
    expect(view.queryByRole("group")).toBeNull();
    expect(view.getByText(inWords("", "07:45", "time")!)).toBeTruthy();
  });
});
