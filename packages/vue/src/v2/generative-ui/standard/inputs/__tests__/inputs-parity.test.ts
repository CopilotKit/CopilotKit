import { fireEvent, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { renderInputs } from "./helpers";

// A port of the input cases of React's
// `standard/__tests__/inputs-parity.test.tsx`. React renders through the
// whole standard catalog; this file uses the input components and
// stand-ins for Column and Text.
//
// Skipped (they test components of other groups):
// - "ListItem action inside a Pressable dispatches only the ListItem
//   action": ListItem is in the data group.
// - "renders primary buttons and solid badges with token colours, not
//   literals": its Button half is "renders primary buttons with token
//   colours, not literals" in inputs.test.ts; Badge is in the feedback group.
// - "Popover sideOffset moves the content and a block trigger fills the
//   width", "Popover with showOnHover and hoverOpenDelay opens after the
//   delay", "PulseIndicator takes endScale and startOpacity": other groups.
// - "Pressable tooltip, ariaPressed and insetBorder apply" and "Select shows
//   clearLabel on the empty option, an icon and full width" are in
//   inputs.test.ts, as in Angular's spec.

describe("standard catalog: inputs (parity)", () => {
  it("TextField writes to the data model and Text reflects it", async () => {
    const v = renderInputs(
      [
        { id: "root", component: "Column", children: ["f", "t"] },
        {
          id: "f",
          component: "TextField",
          value: { "@path": "/name" },
          placeholder: "Your name",
        },
        { id: "t", component: "Text", text: { "@path": "/name" } },
      ],
      { name: "" },
    );
    await fireEvent.update(await v.findByPlaceholderText("Your name"), "Ada");
    expect(await v.findByText("Ada")).toBeTruthy();
  });

  it("Slider and CheckBox bind and render their labels", async () => {
    const v = renderInputs(
      [
        { id: "root", component: "Column", children: ["s", "c", "t"] },
        {
          id: "s",
          component: "Slider",
          value: { "@path": "/seats" },
          min: 1,
          max: 50,
          step: 1,
        },
        {
          id: "c",
          component: "CheckBox",
          value: { "@path": "/annual" },
          label: "Annual",
        },
        { id: "t", component: "Text", text: { "@path": "/seats" } },
      ],
      { seats: 8, annual: false },
    );
    expect(await v.findByText("Annual")).toBeTruthy();
    const range = v.container.querySelector('input[type="range"]');
    if (!(range instanceof HTMLInputElement)) throw new Error("No range.");
    await fireEvent.update(range, "12");
    expect(await v.findByText("12")).toBeTruthy();
  });

  it("Select, RadioGroup, SegmentedControl, TextArea, DateTimeInput, Form render", async () => {
    const v = renderInputs(
      [
        {
          id: "root",
          component: "Form",
          children: ["s", "r", "g", "a", "d"],
          onSubmit: { event: { name: "submit" } },
        },
        {
          id: "s",
          component: "Select",
          value: { "@path": "/plan" },
          options: [{ value: "team", label: "Team" }, "enterprise"],
        },
        {
          id: "r",
          component: "RadioGroup",
          value: { "@path": "/plan" },
          options: ["team", "enterprise"],
          label: "Plan",
        },
        {
          id: "g",
          component: "SegmentedControl",
          value: { "@path": "/plan" },
          options: ["team", "enterprise"],
        },
        {
          id: "a",
          component: "TextArea",
          value: { "@path": "/notes" },
          rows: 2,
        },
        { id: "d", component: "DateTimeInput", value: { "@path": "/when" } },
      ],
      { plan: "team", notes: "", when: "" },
    );
    expect(await v.findByText("Plan")).toBeTruthy();
    expect(v.container.querySelector("select")).not.toBeNull();
    expect(v.container.querySelector("textarea")).not.toBeNull();
    expect(v.container.querySelector("form")).not.toBeNull();
    expect(v.container.querySelector('input[type="date"]')).not.toBeNull();
  });

  it("Select change propagates to RadioGroup and SegmentedControl", async () => {
    const v = renderInputs(
      [
        { id: "root", component: "Column", children: ["s", "r", "g"] },
        {
          id: "s",
          component: "Select",
          value: { "@path": "/plan" },
          options: ["team", "enterprise"],
        },
        {
          id: "r",
          component: "RadioGroup",
          value: { "@path": "/plan" },
          options: ["team", "enterprise"],
        },
        {
          id: "g",
          component: "SegmentedControl",
          value: { "@path": "/plan" },
          options: [
            { value: "team", label: "Team seg" },
            { value: "enterprise", label: "Ent seg" },
          ],
        },
      ],
      { plan: "team" },
    );
    await v.findByText("Ent seg");
    const select = v.container.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) throw new Error("No select.");
    await fireEvent.update(select, "enterprise");
    await waitFor(() => {
      const radio = v.container.querySelector(
        'input[type="radio"][value="enterprise"]',
      );
      expect(radio instanceof HTMLInputElement && radio.checked).toBe(true);
      expect(
        v.getByText("Ent seg").closest("button")?.getAttribute("aria-checked"),
      ).toBe("true");
    });
    await fireEvent.click(v.getByText("Team seg"));
    await waitFor(() => expect(select.value).toBe("team"));
  });

  it("Pressable and Form repeat a template child per data item", async () => {
    const v = renderInputs(
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
    expect(await v.findByText("P1")).toBeTruthy();
    expect(await v.findByText("P2")).toBeTruthy();
    expect(await v.findByText("F1")).toBeTruthy();
  });
});
