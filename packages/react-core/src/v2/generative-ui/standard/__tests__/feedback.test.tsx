import React from "react";
import { act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGenerativeUI } from "../../catalog";
import {
  CELEBRATION_MS,
  FEEDBACK_STYLE_ID,
  feedbackComponents,
} from "../feedback";
import { SURFACE_ID, renderSurface } from "./render";

/** Test-only leaves, so the feedback tests need no other group. */
function Label({ text }: { text: string }) {
  return <span>{text}</span>;
}
function Group({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
}

const ui = createGenerativeUI({
  id: "test/feedback@1",
  components: {
    ...feedbackComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
    Group: { component: Group, slots: { children: "multiple" } },
  },
});

/** The `open` prop of a Popover: a literal, or a data model binding. */
type PopoverOpen = { open?: boolean | { path: string } };

/** A Popover with an "Open" trigger and a "Hidden content" body. */
function popoverNodes(popover: PopoverOpen = {}) {
  return [
    { id: "root", component: "Group", children: ["o", "outside"] },
    { id: "o", component: "Popover", children: ["pt", "pc"], ...popover },
    { id: "pt", component: "PopoverTrigger", children: ["tt"] },
    { id: "tt", component: "Label", text: "Open" },
    { id: "pc", component: "PopoverContent", children: ["cc"] },
    { id: "cc", component: "Label", text: "Hidden content" },
    { id: "outside", component: "Label", text: "Outside" },
  ];
}

async function renderPopover(popover: PopoverOpen = {}) {
  const view = renderSurface(ui, popoverNodes(popover));
  const trigger = (await view.findByText("Open")).closest("button");
  if (!trigger) throw new Error("The trigger is not a button.");
  return { view, trigger };
}

const celebrationNodes = (trigger: string) => [
  { id: "root", component: "Celebration", trigger, children: ["t"] },
  { id: "t", component: "Label", text: "Yay" },
];

afterEach(() => {
  vi.useRealTimers();
});

describe("feedbackComponents", () => {
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    const names = Object.keys(feedbackComponents);
    expect(names).toEqual([
      "Loading",
      "LoadingIndicator",
      "LoadingBlock",
      "PulseIndicator",
      "Celebration",
      "FlashcardFlip",
      "Popover",
      "PopoverTrigger",
      "PopoverContent",
    ]);
    for (const name of names) {
      expect(ui.manifestComponents[name].description).toMatch(/\S/);
    }
    for (const name of [
      "Celebration",
      "Popover",
      "PopoverTrigger",
      "PopoverContent",
    ]) {
      expect(ui.manifestComponents[name].slots).toEqual({
        children: "multiple",
      });
    }
    expect(ui.manifestComponents.FlashcardFlip.slots).toBeUndefined();
  });
});

describe("standard feedback", () => {
  it("renders the feedback and overlay components", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Group",
        children: ["l", "i", "b", "p", "c", "f", "o"],
      },
      { id: "l", component: "Loading", label: "Loading plans" },
      { id: "i", component: "LoadingIndicator" },
      { id: "b", component: "LoadingBlock", label: "Fetching" },
      { id: "p", component: "PulseIndicator" },
      { id: "c", component: "Celebration", trigger: "done", children: ["t"] },
      { id: "t", component: "Label", text: "Yay" },
      { id: "f", component: "FlashcardFlip", front: "Q", back: "A" },
      { id: "o", component: "Popover", children: ["pt", "pc"] },
      { id: "pt", component: "PopoverTrigger", children: ["tt"] },
      { id: "tt", component: "Label", text: "Open" },
      { id: "pc", component: "PopoverContent", children: ["cc"] },
      { id: "cc", component: "Label", text: "Hidden content" },
    ]);
    expect(await view.findByText("Loading plans")).toBeTruthy();
    expect(view.getByText("Fetching")).toBeTruthy();
    expect(view.getByText("Yay")).toBeTruthy();
    expect(view.getByText("Q")).toBeTruthy();
    expect(view.queryByText("Hidden content")).toBeNull();
    fireEvent.click(view.getByText("Open"));
    expect(await view.findByText("Hidden content")).toBeTruthy();
  });

  it("names every loading status for screen readers", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Group", children: ["l", "i", "b"] },
      { id: "l", component: "Loading" },
      { id: "i", component: "LoadingIndicator", label: "Saving" },
      { id: "b", component: "LoadingBlock" },
    ]);
    await view.findByText("Saving");
    const statuses = view.getAllByRole("status");
    expect(statuses.map((status) => status.textContent)).toEqual([
      "Loading",
      "Saving",
      "Loading",
    ]);
  });

  it("names a PulseIndicator only when it has a label", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Group", children: ["a", "b"] },
      { id: "a", component: "PulseIndicator", label: "Live" },
      { id: "b", component: "PulseIndicator" },
    ]);
    expect(await view.findByRole("img", { name: "Live" })).toBeTruthy();
    expect(view.getAllByRole("img")).toHaveLength(1);
  });

  it("stops the motion when the user asks for reduced motion", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Loading", label: "Wait" },
    ]);
    const status = await view.findByRole("status");
    expect(status.querySelector("[data-a2ui-motion]")).not.toBeNull();
    const css = document.getElementById(FEEDBACK_STYLE_ID)?.textContent;
    expect(css).toContain(
      "@media (prefers-reduced-motion: reduce){[data-a2ui-motion]{animation:none !important}[data-a2ui-celebration]{display:none}}",
    );
  });
});

describe("Celebration", () => {
  const confetti = (view: ReturnType<typeof renderSurface>) =>
    view.container.querySelector("[data-a2ui-celebration]");

  it("plays the confetti on mount, removes it after the burst, and plays it again for a new trigger", () => {
    vi.useFakeTimers();
    const view = renderSurface(ui, celebrationNodes("done"));
    expect(view.getByText("Yay")).toBeTruthy();
    expect(confetti(view)?.getAttribute("aria-hidden")).toBe("true");
    act(() => vi.advanceTimersByTime(CELEBRATION_MS));
    expect(confetti(view)).toBeNull();
    view.update({
      version: "v0.9",
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: celebrationNodes("again"),
      },
    });
    expect(confetti(view)).not.toBeNull();
  });
});

describe("FlashcardFlip", () => {
  const cardNodes = [
    {
      id: "root",
      component: "FlashcardFlip",
      front: "Q",
      back: "A",
      hint: "Click to flip",
    },
  ];

  it("flips to the back on click, and back to the front on a second click", async () => {
    const view = renderSurface(ui, cardNodes);
    const card = await view.findByRole("button", { pressed: false });
    expect(card.textContent).toBe("QClick to flip");
    fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(card.textContent).toBe("A");
    fireEvent.click(card);
    expect(card.textContent).toBe("QClick to flip");
  });

  it("flips with the Enter and Space keys", async () => {
    const user = userEvent.setup();
    const view = renderSurface(ui, cardNodes);
    const card = await view.findByRole("button", { pressed: false });
    card.focus();
    await user.keyboard("{Enter}");
    expect(card.textContent).toBe("A");
    await user.keyboard(" ");
    expect(card.textContent).toBe("QClick to flip");
  });
});

describe("Popover", () => {
  it("opens a dialog named by its trigger, and closes on a second click", async () => {
    const { view, trigger } = await renderPopover();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const dialog = await view.findByRole("dialog", { name: "Open" });
    expect(dialog.textContent).toBe("Hidden content");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);
    fireEvent.click(trigger);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and moves focus back to the trigger", async () => {
    const user = userEvent.setup();
    const { view, trigger } = await renderPopover({ open: true });
    const dialog = await view.findByRole("dialog");
    dialog.tabIndex = -1;
    dialog.focus();
    await user.keyboard("{Escape}");
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a pointer press outside of it", async () => {
    const { view, trigger } = await renderPopover();
    fireEvent.click(trigger);
    await view.findByRole("dialog");
    fireEvent.pointerDown(view.getByText("Hidden content"));
    expect(view.queryByRole("dialog")).not.toBeNull();
    fireEvent.pointerDown(view.getByText("Outside"));
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("writes the open state to a bound data path", async () => {
    const view = renderSurface(
      ui,
      popoverNodes({ open: { path: "/menuOpen" } }),
      { menuOpen: false },
    );
    fireEvent.click(await view.findByText("Open"));
    expect(await view.findByRole("dialog")).toBeTruthy();
    expect(view.dataAt("/menuOpen")).toBe(true);
  });
});
