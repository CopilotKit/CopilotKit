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
});
