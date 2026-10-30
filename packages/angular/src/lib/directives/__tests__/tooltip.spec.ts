import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { CopilotTooltip } from "../tooltip";

@Component({
  imports: [CopilotTooltip],
  template: `
    <button id="first" [copilotTooltip]="label()" title="native">One</button>
    <button id="second" copilotTooltip="Second" tooltipPosition="above">Two</button>
  `,
})
class TooltipHost {
  readonly label = signal("First");
}

function setup() {
  const fixture = TestBed.createComponent(TooltipHost);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    first: root.querySelector<HTMLButtonElement>("#first")!,
    second: root.querySelector<HTMLButtonElement>("#second")!,
  };
}

function pointer(el: Element, type: string, pointerType = "mouse"): void {
  const event = new Event(type, { bubbles: type !== "pointerenter" });
  Object.assign(event, { pointerType });
  el.dispatchEvent(event);
}

const tooltips = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".cpk-tooltip"));

describe("CopilotTooltip", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelector(".cdk-overlay-container")?.remove();
  });

  it("renders React's tooltip markup on hover", () => {
    const { fixture, first } = setup();
    pointer(first, "pointerenter");
    fixture.detectChanges();

    const [tooltip] = tooltips();
    expect(tooltip).toBeDefined();
    expect(tooltip.hasAttribute("data-copilotkit")).toBe(true);
    expect(tooltip.getAttribute("data-slot")).toBe("tooltip-content");
    expect(tooltip.getAttribute("data-side")).toBe("bottom");
    expect(tooltip.querySelector("p")?.textContent).toBe("First");
    expect(tooltip.querySelector("svg.cpk-tooltip-arrow")).not.toBeNull();

    const described = tooltip.querySelector('[role="tooltip"]')!;
    expect(described.textContent).toBe("First");
    expect(first.getAttribute("aria-describedby")).toBe(described.id);
    expect(first.getAttribute("data-state")).toBe("delayed-open");
    // The native title would show a second tooltip.
    expect(first.hasAttribute("title")).toBe(false);
  });

  it("hides on pointer leave and restores the title", () => {
    const { fixture, first } = setup();
    pointer(first, "pointerenter");
    pointer(first, "pointerleave");
    fixture.detectChanges();

    expect(tooltips()).toHaveLength(0);
    expect(first.hasAttribute("aria-describedby")).toBe(false);
    expect(first.getAttribute("data-state")).toBe("closed");
    expect(first.getAttribute("title")).toBe("native");
  });

  it("ignores touch pointers", () => {
    const { first } = setup();
    pointer(first, "pointerenter", "touch");
    expect(tooltips()).toHaveLength(0);
  });

  it("opens on keyboard focus and closes on Escape and blur", () => {
    const { first } = setup();
    first.dispatchEvent(new Event("focus"));
    expect(tooltips()).toHaveLength(1);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(tooltips()).toHaveLength(0);

    first.dispatchEvent(new Event("focus"));
    first.dispatchEvent(new Event("blur"));
    expect(tooltips()).toHaveLength(0);
  });

  it("does not open on the focus that a click causes", () => {
    const { first } = setup();
    pointer(first, "pointerenter");
    pointer(first, "pointerdown");
    expect(tooltips()).toHaveLength(0);
    first.dispatchEvent(new Event("focus"));
    expect(tooltips()).toHaveLength(0);
  });

  it("closes on click", () => {
    const { first } = setup();
    first.dispatchEvent(new Event("focus"));
    first.click();
    expect(tooltips()).toHaveLength(0);
  });

  it("shows one tooltip at a time", () => {
    const { fixture, second } = setup();
    const { first } = { first: fixture.nativeElement.querySelector("#first") };
    pointer(first, "pointerenter");
    pointer(second, "pointerenter");
    fixture.detectChanges();

    expect(tooltips()).toHaveLength(1);
    expect(tooltips()[0].querySelector("p")?.textContent).toBe("Second");
  });

  it("updates the open tooltip when the text changes", () => {
    const { fixture, first } = setup();
    pointer(first, "pointerenter");
    fixture.componentInstance.label.set("Copied");
    fixture.detectChanges();
    expect(tooltips()[0].querySelector("p")?.textContent).toBe("Copied");
  });

  it("does not open without text", () => {
    const { fixture, first } = setup();
    fixture.componentInstance.label.set("");
    fixture.detectChanges();
    pointer(first, "pointerenter");
    expect(tooltips()).toHaveLength(0);
    expect(first.hasAttribute("data-state")).toBe(false);
  });
});
