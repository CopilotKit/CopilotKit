import { describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { standardUI } from "../index";
import { renderSurface } from "./render";

/** Tests ported from the a2ui-renderer standard catalog. */

const render = (
  ...args: Parameters<typeof renderSurface> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => renderSurface(standardUI, ...args);

describe("standard catalog: inputs (parity)", () => {
  it("TextField writes to the data model and Text reflects it", async () => {
    const v = render(
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
    fireEvent.change(await v.findByPlaceholderText("Your name"), {
      target: { value: "Ada" },
    });
    expect(await v.findByText("Ada")).toBeTruthy();
  });

  it("Slider and CheckBox bind and render their labels", async () => {
    const v = render(
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
    fireEvent.change(v.container.querySelector('input[type="range"]')!, {
      target: { value: "12" },
    });
    expect(await v.findByText("12")).toBeTruthy();
  });

  it("Select, RadioGroup, SegmentedControl, TextArea, DateTimeInput, Form render", async () => {
    const v = render(
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
    const v = render(
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
    fireEvent.change(v.container.querySelector("select")!, {
      target: { value: "enterprise" },
    });
    await vi.waitFor(() => {
      const radio = v.container.querySelector(
        'input[type="radio"][value="enterprise"]',
      ) as HTMLInputElement;
      expect(radio.checked).toBe(true);
      expect(
        v.getByText("Ent seg").closest("button")!.getAttribute("aria-checked"),
      ).toBe("true");
    });
    fireEvent.click(v.getByText("Team seg"));
    await vi.waitFor(() =>
      expect(
        (v.container.querySelector("select") as HTMLSelectElement).value,
      ).toBe("team"),
    );
  });

  it("Select shows clearLabel on the empty option, an icon and full width", async () => {
    const v = render([
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
    const select = (await v.findByLabelText("Plan")) as HTMLSelectElement;
    expect(select.options[0].textContent).toBe("Any plan");
    expect(select.style.width).toBe("100%");
    expect(select.style.paddingLeft).not.toBe("");
  });

  it("Pressable and Form repeat a template child per data item", async () => {
    const v = render(
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

  it("ListItem action inside a Pressable dispatches only the ListItem action", async () => {
    const v = render([
      {
        id: "root",
        component: "Pressable",
        children: ["li"],
        onClick: { event: { name: "outer-a" } },
      },
      {
        id: "li",
        component: "ListItem",
        label: "Row",
        action: { event: { name: "item-a" } },
      },
    ]);
    fireEvent.click(await v.findByText("Row"));
    expect(v.forwardEvent).toHaveBeenCalledTimes(1);
    expect(v.forwardEvent.mock.calls[0][0].name).toBe("item-a");
  });

  it("Pressable tooltip, ariaPressed and insetBorder apply", async () => {
    const v = render([
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
    const pressable = (await v.findByText("Toggle")).closest(
      "[role=button]",
    ) as HTMLElement;
    expect(pressable.getAttribute("title")).toBe("More");
    expect(pressable.getAttribute("aria-pressed")).toBe("true");
    expect(pressable.style.boxShadow).toContain("inset 0 0 0 1px");
  });

  it("renders primary buttons and solid badges with token colours, not literals", async () => {
    const v = render([
      { id: "root", component: "Column", children: ["b", "g"] },
      {
        id: "b",
        component: "Button",
        label: "Go",
        variant: "primary",
        onClick: { event: { name: "go" } },
      },
      { id: "g", component: "Badge", label: "New", variant: "solid" },
    ]);
    const button = (await v.findByText("Go")).closest("button") as HTMLElement;
    expect(button.style.color).toBe("var(--a2ui-color-on-accent, #fff)");
    const badge = v.getByText("New").closest("span") as HTMLElement;
    expect(badge.style.color).toBe("var(--a2ui-color-on-accent, #fff)");
  });

  it("Popover sideOffset moves the content and a block trigger fills the width", async () => {
    const v = render([
      { id: "root", component: "Popover", children: ["t", "c"] },
      { id: "t", component: "PopoverTrigger", block: true, children: ["b"] },
      { id: "b", component: "Text", text: "Toggle" },
      { id: "c", component: "PopoverContent", sideOffset: 12, children: ["x"] },
      { id: "x", component: "Text", text: "Body" },
    ]);
    const trigger = (await v.findByText("Toggle")).closest(
      "[data-a2ui-popover-trigger]",
    ) as HTMLElement;
    expect(trigger.style.width).toBe("100%");
    fireEvent.click(trigger);
    const dialog = await v.findByRole("dialog");
    expect(dialog.style.marginTop).toBe("12px");
  });

  it("Popover with showOnHover and hoverOpenDelay opens after the delay", async () => {
    vi.useFakeTimers();
    try {
      const v = render([
        {
          id: "root",
          component: "Popover",
          showOnHover: true,
          hoverOpenDelay: 300,
          children: ["t", "c"],
        },
        { id: "t", component: "PopoverTrigger", children: ["b"] },
        { id: "b", component: "Text", text: "Hover" },
        { id: "c", component: "PopoverContent", children: ["x"] },
        { id: "x", component: "Text", text: "Delayed body" },
      ]);
      const trigger = v
        .getByText("Hover")
        .closest("[data-a2ui-popover-trigger]") as HTMLElement;
      fireEvent.mouseEnter(trigger.parentElement!);
      expect(v.queryByText("Delayed body")).toBeNull();
      act(() => vi.advanceTimersByTime(300));
      expect(v.queryByText("Delayed body")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("PulseIndicator takes endScale and startOpacity", async () => {
    const v = render([
      { id: "root", component: "Column", children: ["p"] },
      {
        id: "p",
        component: "PulseIndicator",
        label: "Live",
        endScale: 3,
        startOpacity: 0.4,
      },
    ]);
    const pulse = await v.findByLabelText("Live");
    const ring = pulse.querySelector("[data-a2ui-motion]") as HTMLElement;
    expect(ring.style.getPropertyValue("--a2ui-pulse-scale")).toBe("3");
    expect(ring.style.getPropertyValue("--a2ui-pulse-opacity")).toBe("0.4");
  });
});
