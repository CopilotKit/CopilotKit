import { describe, expect, it } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { FEEDBACK_STYLE_ID, feedbackComponents } from "../index";
import { press, text, ui } from "./helpers";

describe("feedbackComponents", () => {
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    expect(Object.keys(feedbackComponents)).toEqual([
      "PulseIndicator",
      "FlashcardFlip",
      "Popover",
      "PopoverTrigger",
      "PopoverContent",
      "Modal",
    ]);
    for (const name of Object.keys(feedbackComponents)) {
      expect(ui.manifestComponents[name]?.description).toMatch(/\S/);
    }
  });
});

describe("PulseIndicator", () => {
  it("names a PulseIndicator only when it has a label", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Group", children: ["a", "b"] },
      { id: "a", component: "PulseIndicator", label: "Live" },
      { id: "b", component: "PulseIndicator" },
    ]);
    const named = view.container.querySelectorAll("[role=img]");
    expect(named).toHaveLength(1);
    expect(named[0]?.getAttribute("aria-label")).toBe("Live");
    const silent = [...view.container.querySelectorAll("[data-a2ui-std]")].find(
      (el) => el.getAttribute("role") !== "img",
    );
    expect(silent?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps a pulse under reduced motion, as a fade without growth", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "PulseIndicator", label: "Live", size: 20 },
    ]);
    const pulse = view.container.querySelector<HTMLElement>("[role=img]")!;
    expect(pulse.style.width).toBe("20px");
    const ring = pulse.querySelector<HTMLElement>("[data-a2ui-pulse]")!;
    expect(ring.style.animation).toContain("a2ui-pulse 1500ms");
    const css = document.getElementById(FEEDBACK_STYLE_ID)?.textContent;
    expect(css).toContain(
      "@media (prefers-reduced-motion: reduce){[data-a2ui-pulse]{animation-name:a2ui-pulse-fade !important}}",
    );
    expect(css).toContain("@keyframes a2ui-pulse-fade{0%{opacity:");
  });
});

describe("FlashcardFlip", () => {
  it("flips to the back on click, and back to the front on a second click", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "FlashcardFlip",
        front: "Q",
        back: "A",
        hint: "Click to flip",
      },
    ]);
    const card = view.container.querySelector<HTMLButtonElement>(
      "button[aria-pressed]",
    )!;
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(text(card)).toBe("QClicktoflip");
    view.act(() => card.click());
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(text(card)).toBe("A");
    view.act(() => card.click());
    expect(text(card)).toBe("QClicktoflip");
  });

  it("flips with the Enter and Space keys", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "FlashcardFlip",
        front: "Q",
        back: "A",
        hint: "Click to flip",
      },
    ]);
    const card = view.container.querySelector<HTMLButtonElement>(
      "button[aria-pressed]",
    )!;
    // A native button: the browser turns Enter and Space into a click. jsdom
    // has no activation behaviour, so the test sends that click itself.
    expect(card.type).toBe("button");
    card.focus();
    view.act(() => {
      press(card, "Enter");
      card.click();
    });
    expect(text(card)).toBe("A");
    view.act(() => {
      card.dispatchEvent(
        new KeyboardEvent("keyup", { key: " ", bubbles: true }),
      );
      card.click();
    });
    expect(text(card)).toBe("QClicktoflip");
  });
});
