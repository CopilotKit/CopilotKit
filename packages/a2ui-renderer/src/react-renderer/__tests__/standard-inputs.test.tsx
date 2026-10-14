import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderStandard } from "./standard-test-utils";

describe("standard catalog: inputs", () => {
  it("TextField writes to the data model and Text reflects it", async () => {
    const v = renderStandard(
      [
        { id: "root", component: "Column", children: ["f", "t"] },
        {
          id: "f",
          component: "TextField",
          value: { path: "/name" },
          placeholder: "Your name",
        },
        { id: "t", component: "Text", text: { path: "/name" } },
      ],
      { name: "" },
    );
    fireEvent.change(await v.findByPlaceholderText("Your name"), {
      target: { value: "Ada" },
    });
    expect(await v.findByText("Ada")).toBeTruthy();
  });

  it("Slider and CheckBox bind and render their labels", async () => {
    const v = renderStandard(
      [
        { id: "root", component: "Column", children: ["s", "c", "t"] },
        {
          id: "s",
          component: "Slider",
          value: { path: "/seats" },
          min: 1,
          max: 50,
          step: 1,
        },
        {
          id: "c",
          component: "CheckBox",
          checked: { path: "/annual" },
          label: "Annual",
        },
        { id: "t", component: "Text", text: { path: "/seats" } },
      ],
      { seats: 8, annual: false },
    );
    expect(await v.findByText("Annual")).toBeTruthy();
    fireEvent.change(v.container.querySelector('input[type="range"]')!, {
      target: { value: "12" },
    });
    expect(await v.findByText("12")).toBeTruthy();
  });

  it("CheckBox writes checked back to the data model", async () => {
    const v = renderStandard(
      [
        { id: "root", component: "Column", children: ["c"] },
        {
          id: "c",
          component: "CheckBox",
          checked: { path: "/annual" },
          label: "Annual",
        },
      ],
      { annual: false },
    );
    await v.findByText("Annual");
    const box = v.container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await vi.waitFor(() =>
      expect(
        (
          v.container.querySelector(
            'input[type="checkbox"]',
          ) as HTMLInputElement
        ).checked,
      ).toBe(true),
    );
  });

  it("Button dispatches its action with context", async () => {
    const onAction = vi.fn();
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Button",
          label: "Go",
          action: { event: { name: "go", context: { message: "Go now" } } },
        },
      ],
      undefined,
      onAction,
    );
    fireEvent.click(await v.findByText("Go"));
    expect(onAction).toHaveBeenCalled();
    expect(JSON.stringify(onAction.mock.calls[0][0])).toContain('"go"');
  });

  it("disabled Button does not dispatch", async () => {
    const onAction = vi.fn();
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Button",
          label: "Nope",
          disabled: true,
          action: { event: { name: "nope" } },
        },
      ],
      undefined,
      onAction,
    );
    fireEvent.click(await v.findByText("Nope"));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("Form dispatches its action on submit", async () => {
    const onAction = vi.fn();
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Form",
          children: ["b"],
          action: { event: { name: "submit-form" } },
        },
        { id: "b", component: "Button", label: "Send", submit: true },
      ],
      undefined,
      onAction,
    );
    fireEvent.click(await v.findByText("Send"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onAction.mock.calls[0][0])).toContain("submit-form");
  });

  it("Select, RadioGroup, SegmentedControl, TextArea, DateTimeInput, Form render", async () => {
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Form",
          children: ["s", "r", "g", "a", "d"],
          action: { event: { name: "submit" } },
        },
        {
          id: "s",
          component: "Select",
          value: { path: "/plan" },
          options: [{ value: "team", label: "Team" }, "enterprise"],
        },
        {
          id: "r",
          component: "RadioGroup",
          value: { path: "/plan" },
          options: ["team", "enterprise"],
          label: "Plan",
        },
        {
          id: "g",
          component: "SegmentedControl",
          value: { path: "/plan" },
          options: ["team", "enterprise"],
        },
        { id: "a", component: "TextArea", value: { path: "/notes" }, rows: 2 },
        { id: "d", component: "DateTimeInput", value: { path: "/when" } },
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
    const v = renderStandard(
      [
        { id: "root", component: "Column", children: ["s", "r", "g"] },
        {
          id: "s",
          component: "Select",
          value: { path: "/plan" },
          options: ["team", "enterprise"],
        },
        {
          id: "r",
          component: "RadioGroup",
          value: { path: "/plan" },
          options: ["team", "enterprise"],
        },
        {
          id: "g",
          component: "SegmentedControl",
          value: { path: "/plan" },
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

  it("feedback and overlay components render", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Column",
        children: ["l", "i", "b", "p", "c", "f", "o"],
      },
      { id: "l", component: "Loading", label: "Loading plans" },
      { id: "i", component: "LoadingIndicator" },
      { id: "b", component: "LoadingBlock", label: "Fetching" },
      { id: "p", component: "PulseIndicator" },
      { id: "c", component: "Celebration", trigger: "done", children: ["t"] },
      { id: "t", component: "Text", text: "Yay" },
      { id: "f", component: "FlashcardFlip", front: "Q", back: "A" },
      { id: "o", component: "Popover", children: ["pt", "pc"] },
      { id: "pt", component: "PopoverTrigger", children: ["tt"] },
      { id: "tt", component: "Text", text: "Open" },
      { id: "pc", component: "PopoverContent", children: ["cc"] },
      { id: "cc", component: "Text", text: "Hidden content" },
    ]);
    expect(await v.findByText("Loading plans")).toBeTruthy();
    expect(v.getByText("Yay")).toBeTruthy();
    expect(v.getByText("Q")).toBeTruthy();
    expect(v.queryByText("Hidden content")).toBeNull();
    fireEvent.click(v.getByText("Open"));
    expect(await v.findByText("Hidden content")).toBeTruthy();
  });

  it("FlashcardFlip flips to the back on click", async () => {
    const v = renderStandard([
      { id: "root", component: "FlashcardFlip", front: "Q", back: "A" },
    ]);
    fireEvent.click(await v.findByText("Q"));
    expect(await v.findByText("A")).toBeTruthy();
  });

  it("Pressable and Form repeat a template child per data item", async () => {
    const v = renderStandard(
      [
        { id: "root", component: "Column", children: ["p", "f"] },
        {
          id: "p",
          component: "Pressable",
          children: { componentId: "pr", path: "/a" },
        },
        { id: "pr", component: "Text", text: { path: "name" } },
        {
          id: "f",
          component: "Form",
          children: { componentId: "fr", path: "/b" },
        },
        { id: "fr", component: "Text", text: { path: "name" } },
      ],
      { a: [{ name: "P1" }, { name: "P2" }], b: [{ name: "F1" }] },
    );
    expect(await v.findByText("P1")).toBeTruthy();
    expect(await v.findByText("P2")).toBeTruthy();
    expect(await v.findByText("F1")).toBeTruthy();
  });

  it("Button inside a Pressable dispatches only the Button action", async () => {
    const onAction = vi.fn();
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Pressable",
          children: ["inner", "b"],
          action: { event: { name: "outer-a" } },
        },
        {
          id: "inner",
          component: "Pressable",
          children: ["t"],
          action: { event: { name: "inner-a" } },
        },
        { id: "t", component: "Text", text: "Inner" },
        {
          id: "b",
          component: "Button",
          label: "Click",
          action: { event: { name: "button-b" } },
        },
      ],
      undefined,
      onAction,
    );
    fireEvent.click(await v.findByText("Click"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onAction.mock.calls[0][0])).toContain("button-b");

    fireEvent.click(await v.findByText("Inner"));
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(onAction.mock.calls[1][0])).toContain("inner-a");
  });

  it("ListItem action inside a Pressable dispatches only the ListItem action", async () => {
    const onAction = vi.fn();
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Pressable",
          children: ["li"],
          action: { event: { name: "outer-a" } },
        },
        {
          id: "li",
          component: "ListItem",
          label: "Row",
          action: { event: { name: "item-a" } },
        },
      ],
      undefined,
      onAction,
    );
    fireEvent.click(await v.findByText("Row"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onAction.mock.calls[0][0])).toContain("item-a");
  });

  it("submit Button outside a Form dispatches its own action", async () => {
    const onAction = vi.fn();
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Button",
          label: "Lone",
          submit: true,
          action: { event: { name: "lone-submit" } },
        },
      ],
      undefined,
      onAction,
    );
    fireEvent.click(await v.findByText("Lone"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onAction.mock.calls[0][0])).toContain("lone-submit");
  });

  it("submit Button inside a Form dispatches only the Form action", async () => {
    const onAction = vi.fn();
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Form",
          children: ["b"],
          action: { event: { name: "form-a" } },
        },
        {
          id: "b",
          component: "Button",
          label: "Send",
          submit: true,
          action: { event: { name: "button-a" } },
        },
      ],
      undefined,
      onAction,
    );
    fireEvent.click(await v.findByText("Send"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onAction.mock.calls[0][0])).toContain("form-a");
  });

  it("Enter on a Button inside a Pressable does not fire the Pressable action", async () => {
    const onAction = vi.fn();
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Pressable",
          children: ["b"],
          action: { event: { name: "outer-a" } },
        },
        {
          id: "b",
          component: "Button",
          label: "Key",
          action: { event: { name: "button-b" } },
        },
      ],
      undefined,
      onAction,
    );
    fireEvent.keyDown(await v.findByText("Key"), { key: "Enter" });
    expect(onAction).not.toHaveBeenCalled();
  });
});
