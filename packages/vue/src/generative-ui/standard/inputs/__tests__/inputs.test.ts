import { fireEvent, waitFor, within } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSSRApp,
  defineComponent,
  h,
  isProxy,
  provide,
  shallowRef,
} from "vue";
import { renderToString } from "vue/server-renderer";
import type { A2UIComponentNode } from "@copilotkit/shared";
import {
  SURFACE_ID,
  createTestRuntime,
} from "../../../__tests__/helpers/render-surface";
import { GenerativeUIRuntimeKey } from "../../../runtime-context";
import { SurfaceView } from "../../../SurfaceView";
import {
  describeDateTime,
  inputComponents,
  splitDateTime,
  timeInRange,
  timeSlots,
} from "../index";
import {
  PLAN_OPTIONS,
  agentWrite,
  narrow,
  renderInputs,
  sentEventNames,
  ui,
} from "./helpers";

// A port of React's `standard/__tests__/inputs.test.tsx`, with the cases of
// Angular's `inputs/__tests__/*.spec.ts` that React has no counterpart for.
//
// Skipped:
// - Angular "Button icons: sizes the icon with the button scale and hides it
//   from screen readers", and the svg part of "Button with copy writes to
//   the clipboard and shows a check": the lucide icon is the Icon of the
//   media group, so this group renders the icon wrappers only.

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
      expect(ui.manifestComponents[name]?.description).toMatch(/\S/);
    }
    expect(Object.keys(ui.manifestComponents.Button?.events ?? {})).toEqual([
      "onClick",
    ]);
    expect(Object.keys(ui.manifestComponents.Form?.events ?? {})).toEqual([
      "onSubmit",
    ]);
    expect(ui.manifestComponents.Pressable?.slots).toEqual({
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
    await fireEvent.update(field, "ada@example.com");
    expect(view.dataAt("/form/email")).toBe("ada@example.com");
    await waitFor(() =>
      expect(view.getByTestId("label").textContent).toBe("ada@example.com"),
    );

    await view.update(agentWrite("/form/email", "agent@example.com"));
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
    await fireEvent.update(area, "Final");
    expect(
      narrow(view.getByLabelText("Notes"), HTMLTextAreaElement).value,
    ).toBe("Final");
    expect(view.dataAt("/")).toEqual({ notes: "unchanged" });
  });

  it("sizes an autoResize TextArea to the value of the model, not only to typing", async () => {
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
      const area = narrow(
        await view.findByLabelText("Notes"),
        HTMLTextAreaElement,
      );
      expect(area.style.height).toBe("120px");
      await view.update(agentWrite("/notes", "1\n2\n3\n4\n5\n6\n7"));
      await waitFor(() => expect(area.style.height).toBe("168px"));
      await fireEvent.update(area, "1\n2");
      await waitFor(() => expect(area.style.height).toBe("48px"));
    } finally {
      scrollHeight.mockRestore();
    }
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
    await fireEvent.click(box);
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
    await fireEvent.update(range, "12");
    expect(view.dataAt("/seats")).toBe(12);
    expect(await view.findByText("12 users")).toBeTruthy();
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
    await fireEvent.update(date, "2026-01-05");
    expect(view.dataAt("/when")).toBe("2026-01-05");
    await fireEvent.click(await view.findByRole("button", { name: "Clear" }));
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

    await fireEvent.update(select, "enterprise");
    expect(view.dataAt("/plan")).toBe("enterprise");
    await waitFor(() =>
      expect(
        narrow(
          view.getByRole("radio", { name: "enterprise" }),
          HTMLInputElement,
        ).checked,
      ).toBe(true),
    );
    expect(
      view.getByRole("radio", { name: "Ent seg" }).getAttribute("aria-checked"),
    ).toBe("true");

    await fireEvent.click(view.getByRole("radio", { name: "Team seg" }));
    expect(view.dataAt("/plan")).toBe("team");
    await waitFor(() =>
      expect(narrow(view.getByLabelText("Plan"), HTMLSelectElement).value).toBe(
        "team",
      ),
    );
  });

  it("keeps the left padding of a Select without an icon, and widens it for an icon", async () => {
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
    const plain = narrow(
      await view.findByLabelText("Plain"),
      HTMLSelectElement,
    );
    const iconed = narrow(view.getByLabelText("With icon"), HTMLSelectElement);
    expect(plain.style.paddingLeft).toBe("18px");
    expect(iconed.style.paddingLeft).toBe("42px");
  });

  it("moves the SegmentedControl selection and focus with the arrow keys, as one tab stop", async () => {
    const view = renderInputs(planControls, {
      plan: "team",
      plans: PLAN_OPTIONS,
    });
    const team = await view.findByRole("radio", { name: "Team seg" });
    expect(team.tabIndex).toBe(0);
    expect(view.getByRole("radio", { name: "Ent seg" }).tabIndex).toBe(-1);

    await fireEvent.keyDown(team, { key: "ArrowRight" });
    const enterprise = view.getByRole("radio", { name: "Ent seg" });
    expect(view.dataAt("/plan")).toBe("enterprise");
    expect(document.activeElement).toBe(enterprise);
    await waitFor(() => expect(enterprise.tabIndex).toBe(0));

    // The arrow keys wrap at the end.
    await fireEvent.keyDown(enterprise, { key: "ArrowRight" });
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
    const group = await view.findByRole("group", { name: "Support" });
    expect(view.getByText("Email only")).toBeTruthy();
    expect(group.querySelector("label")?.style.border).toContain("1px solid");
  });

  it("lets a ChoicePicker pick several options as a list of values", async () => {
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
    const cheese = await view.findByRole("checkbox", { name: "cheese" });
    const olives = view.getByRole("checkbox", { name: "olives" });
    await fireEvent.click(cheese);
    expect(view.dataAt("/toppings")).toEqual(["cheese"]);
    await fireEvent.click(olives);
    expect(view.dataAt("/toppings")).toEqual(["cheese", "olives"]);
    await fireEvent.click(cheese);
    expect(view.dataAt("/toppings")).toEqual(["olives"]);
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
    await fireEvent.update(
      await view.findByLabelText("Email"),
      "ada@example.com",
    );
    await fireEvent.click(view.getByRole("button", { name: "Subscribe" }));
    expect(view.forwardEvent).toHaveBeenCalledTimes(1);
    expect(view.forwardEvent.mock.calls[0]?.[0]).toEqual({
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
    await fireEvent.click(await view.findByRole("button", { name: "Nope" }));
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
    await fireEvent.update(view.getByLabelText("Email"), "ada@example.com");
    await fireEvent.click(view.getByRole("button", { name: "Send" }));
    expect(sentEventNames(view)).toEqual(["signup"]);
    expect(view.forwardEvent.mock.calls[0]?.[0].context).toEqual({
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
    await fireEvent.click(await view.findByRole("button", { name: "Lone" }));
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
    await fireEvent.click(await view.findByRole("button", { name: "Click" }));
    await fireEvent.click(view.getByText("Inner"));
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
    if (!pressable || !button) throw new Error("Expected two buttons.");
    await fireEvent.keyDown(button, { key: "Enter" });
    expect(view.forwardEvent).not.toHaveBeenCalled();
    await fireEvent.keyDown(pressable, { key: "Enter" });
    expect(sentEventNames(view)).toEqual(["outer"]);
  });

  it("Pressable tooltip, ariaPressed and insetBorder apply", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Pressable",
        tooltip: "More",
        ariaPressed: true,
        insetBorder: true,
        children: ["t"],
      },
      { id: "t", component: "Text", text: "Toggle" },
    ]);
    const pressable = (await view.findByText("Toggle")).closest(
      "[role=button]",
    );
    if (!(pressable instanceof HTMLElement)) throw new Error("No Pressable.");
    expect(pressable.getAttribute("title")).toBe("More");
    expect(pressable.getAttribute("aria-pressed")).toBe("true");
    expect(pressable.style.boxShadow).toContain("inset 0 0 0 1px");
  });

  it("Select shows clearLabel on the empty option, an icon and full width", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Select",
        label: "Plan",
        clearable: true,
        clearLabel: "Any plan",
        icon: "search",
        block: true,
        options: ["team"],
      },
    ]);
    const select = narrow(
      await view.findByLabelText("Plan"),
      HTMLSelectElement,
    );
    expect(select.options[0]?.textContent).toBe("Any plan");
    expect(select.style.width).toBe("100%");
    expect(select.style.paddingLeft).not.toBe("");
  });
});

describe("Button and Pressable client-side verbs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Button with href opens the URL in a new tab and does not dispatch", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const view = renderInputs([
      {
        id: "root",
        component: "Button",
        label: "Docs",
        href: "https://docs.copilotkit.ai",
        onClick: { event: { name: "never" } },
      },
    ]);
    await fireEvent.click(await view.findByRole("button", { name: "Docs" }));
    expect(open).toHaveBeenCalledWith(
      "https://docs.copilotkit.ai",
      "_blank",
      "noopener,noreferrer",
    );
    expect(view.forwardEvent).not.toHaveBeenCalled();
  });

  it("Button with href ignores unsafe schemes", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const view = renderInputs([
      {
        id: "root",
        component: "Button",
        label: "Bad",
        href: "javascript:alert(1)",
      },
    ]);
    await fireEvent.click(await view.findByRole("button", { name: "Bad" }));
    expect(open).not.toHaveBeenCalled();
  });

  it("Button with copy writes to the clipboard and shows a check", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const view = renderInputs([
      { id: "root", component: "Button", label: "Copy code", copy: "ABC-123" },
    ]);
    const button = await view.findByRole("button", { name: "Copy code" });
    await fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("ABC-123");
    await waitFor(() =>
      expect(button.hasAttribute("data-a2ui-copied")).toBe(true),
    );
    expect(button.querySelector('[data-icon="check"]')).not.toBeNull();
  });

  it("Pressable with href opens the URL", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const view = renderInputs([
      {
        id: "root",
        component: "Pressable",
        href: "https://copilotkit.ai",
        children: ["t"],
      },
      { id: "t", component: "Text", text: "Go" },
    ]);
    const pressable = (await view.findByText("Go")).closest("[role=button]");
    if (!(pressable instanceof HTMLElement)) throw new Error("No Pressable.");
    await fireEvent.click(pressable);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("Button styles", () => {
  it("renders primary buttons with token colours, not literals", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Button",
        label: "Go",
        variant: "primary",
        onClick: { event: { name: "go" } },
      },
    ]);
    const button = (await view.findByText("Go")).closest("button");
    expect(button?.style.color).toBe("var(--a2ui-color-on-accent, #fff)");
    expect(button?.style.minHeight).toBe("36px");
  });
});

describe("standard inputs: DateTimeInput", () => {
  const inWords = (
    date: string,
    time: string,
    mode: "date" | "time" | "datetime",
  ) => describeDateTime({ date, time }, mode) ?? "";

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
    const date = narrow(within(group).getByLabelText("Date"), HTMLInputElement);
    const time = narrow(within(group).getByLabelText("Time"), HTMLInputElement);
    expect(date.type).toBe("date");
    expect(time.type).toBe("time");
    await fireEvent.update(date, "2026-10-23");
    // Half a value is not a value.
    expect(view.dataAt("/when")).toBe("");
    expect(date.value).toBe("2026-10-23");
    await fireEvent.update(time, "14:30");
    expect(view.dataAt("/when")).toBe("2026-10-23T14:30");
    expect(
      await view.findByText(inWords("2026-10-23", "14:30", "datetime")),
    ).toBeTruthy();
    // Clearing the time clears the value and keeps the date.
    await fireEvent.update(time, "");
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
    const date = narrow(await view.findByLabelText("Date"), HTMLInputElement);
    const time = narrow(view.getByLabelText("Time"), HTMLInputElement);
    expect([date.value, time.value]).toEqual(["2026-10-23", "09:00"]);
    await view.update(agentWrite("/when", "2026-11-02T17:15"));
    await waitFor(() =>
      expect([date.value, time.value]).toEqual(["2026-11-02", "17:15"]),
    );
    await fireEvent.click(view.getByRole("button", { name: "Clear" }));
    expect(view.dataAt("/when")).toBe("");
    await waitFor(() => expect([date.value, time.value]).toEqual(["", ""]));
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
    const date = narrow(await view.findByLabelText("Date"), HTMLInputElement);
    const time = narrow(view.getByLabelText("Time"), HTMLInputElement);
    expect([date.min, date.max]).toEqual(["2026-10-23", "2026-10-30"]);
    expect([time.min, time.max]).toEqual(["09:00", ""]);
    await fireEvent.update(date, "2026-10-30");
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
    const select = narrow(
      await view.findByLabelText("Call time"),
      HTMLSelectElement,
    );
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "09:00",
      "09:30",
      "10:00",
    ]);
    expect(select.options[2]?.textContent).toBe(inWords("", "09:30", "time"));
    await fireEvent.update(select, "09:30");
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
    const form = narrow(await view.findByRole("form"), HTMLFormElement);
    const time = narrow(view.getByLabelText("Time"), HTMLSelectElement);
    // The day after the bound: 08:30 is fine.
    expect(form.checkValidity()).toBe(true);
    await fireEvent.update(view.getByLabelText("Date"), "2026-11-02");
    expect(time.value).toBe("08:30");
    expect(time.getAttribute("aria-invalid")).toBe("true");
    expect(form.checkValidity()).toBe(false);
    expect(view.getByRole("alert").textContent).toBe(
      `Pick a time from ${inWords("", "09:00", "time")} to the end of the day`,
    );
    await fireEvent.update(time, "09:30");
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
    const form = narrow(await view.findByRole("form"), HTMLFormElement);
    expect(form.checkValidity()).toBe(true);
    const time = narrow(view.getByLabelText("Time"), HTMLInputElement);
    await fireEvent.update(view.getByLabelText("Date"), "2026-10-23");
    expect(form.checkValidity()).toBe(false);
    expect(time.validationMessage).toBe("Pick a time too");
    await fireEvent.update(time, "14:30");
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
    const date = narrow(await view.findByLabelText("Date"), HTMLInputElement);
    await fireEvent.update(date, "2026-10-23");
    await view.update(agentWrite("/when", "2026-12-01T08:00"));
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
    const time = narrow(await view.findByLabelText("Alarm"), HTMLInputElement);
    expect(time.type).toBe("time");
    expect(time.value).toBe("07:45");
    expect(view.queryByRole("group")).toBeNull();
    expect(view.getByText(inWords("", "07:45", "time"))).toBeTruthy();
  });
});

/** Server-renders `components` (with a `root`) on a surface of the test catalog. */
function renderOnServer(components: A2UIComponentNode[]) {
  const { runtime } = createTestRuntime(ui);
  runtime.manager.ingest("thread", "default", {
    surfaceId: SURFACE_ID,
    target: "inline",
    catalogId: ui.id,
    operations: [
      {
        version: "1.0",
        createSurface: { surfaceId: SURFACE_ID, catalogId: ui.id },
      },
      {
        version: "1.0",
        updateComponents: { surfaceId: SURFACE_ID, components },
      },
    ],
    status: "streaming",
    rejected: [],
  });
  const surface = runtime.manager.getSurface("thread", SURFACE_ID);
  if (!surface) throw new Error("The surface was not created.");
  return renderToString(
    createSSRApp(
      defineComponent({
        setup() {
          provide(GenerativeUIRuntimeKey, shallowRef(runtime));
          return () => h(SurfaceView, { surface });
        },
      }),
    ),
  );
}

describe("Vue-specific semantics", () => {
  it("writes a ChoicePicker list to the data model as a plain array, not a reactive proxy", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "ChoicePicker",
          label: "Size",
          options: ["S", "M"],
          value: { "@path": "/size" },
        },
      ],
      { size: [] },
    );
    await fireEvent.click(await view.findByRole("radio", { name: "M" }));
    const written = view.dataAt("/size");
    expect(written).toEqual(["M"]);
    expect(isProxy(written)).toBe(false);
    expect(() => structuredClone(written)).not.toThrow();
  });

  it("unchecks the chosen radio of a single ChoicePicker on a second click", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "ChoicePicker",
          label: "Size",
          options: ["S", "M"],
          value: { "@path": "/size" },
        },
      ],
      { size: ["M"] },
    );
    const medium = narrow(
      await view.findByRole("radio", { name: "M" }),
      HTMLInputElement,
    );
    expect(medium.checked).toBe(true);
    await fireEvent.click(medium);
    expect(view.dataAt("/size")).toEqual([]);
    await waitFor(() => expect(medium.checked).toBe(false));
  });

  it("keeps an unset pill a pill and an unset Pressable ariaPressed off, as Vue would cast them to false", async () => {
    const view = renderInputs([
      { id: "root", component: "Column", children: ["p", "f"] },
      { id: "p", component: "Pressable", children: ["t"] },
      { id: "t", component: "Text", text: "Card" },
      { id: "f", component: "TextField", label: "Name" },
    ]);
    const pressable = (await view.findByText("Card")).closest("[role=button]");
    expect(pressable?.hasAttribute("aria-pressed")).toBe(false);
    const field = narrow(view.getByLabelText("Name"), HTMLInputElement);
    expect(field.style.borderRadius).toBe("9999px");
  });

  it("renders every input on the server", async () => {
    const html = await renderOnServer([
      {
        id: "root",
        component: "Form",
        label: "Order",
        children: ["b", "p", "f", "a", "s", "c", "r", "g", "l", "k", "d"],
      },
      { id: "b", component: "Button", label: "Send", submit: true },
      { id: "p", component: "Pressable", children: [] },
      { id: "f", component: "TextField", label: "Name" },
      { id: "a", component: "TextArea", label: "Notes", autoResize: true },
      { id: "s", component: "Select", label: "Plan", options: ["team"] },
      { id: "c", component: "CheckBox", label: "Terms" },
      { id: "r", component: "RadioGroup", label: "Size", options: ["S"] },
      { id: "g", component: "SegmentedControl", options: ["day"] },
      { id: "l", component: "Slider", label: "Seats" },
      { id: "k", component: "ChoicePicker", label: "Toppings", options: ["x"] },
      {
        id: "d",
        component: "DateTimeInput",
        label: "Pickup",
        enableDate: true,
        enableTime: true,
        value: "2026-10-23T14:30",
      },
    ]);
    expect(html).toContain('aria-label="Order"');
    // Vue marks the slot fragments with comments.
    expect(html).toMatch(/type="submit"[^>]*>(<!--[^>]*-->)*Send</);
    expect(html).toContain("<textarea");
    expect(html).toContain('type="range"');
    expect(html).toContain('value="2026-10-23"');
    expect(html).toContain("data-a2ui-datetime-summary");
  });
});
