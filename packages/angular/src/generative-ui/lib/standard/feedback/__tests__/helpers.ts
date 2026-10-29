import { ApplicationRef, Component, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { z } from "zod";
import { createGenerativeUI } from "../../../catalog";
import type { GenerativeUIChildren } from "../../../children";
import { CopilotGenerativeUIChildren } from "../../../children.directive";
import type { SurfaceRender } from "../../../__tests__/render";
import { feedbackComponents } from "../index";

/** Test-only leaves, so the feedback tests need no other group. */
@Component({
  selector: "test-label",
  template: `
    <span>{{ text() }}</span>
  `,
})
class Label {
  readonly text = input<string>();
}

@Component({
  selector: "test-group",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <div><ng-container *copilotGenerativeUIChildren="children()" /></div>
  `,
})
class Group {
  readonly children = input<GenerativeUIChildren>();
}

/** A native button, like the standard Button: the only control of a trigger. */
@Component({
  selector: "test-button",
  template: `
    <button type="button" [disabled]="disabled()" (click)="click()">
      {{ label() }}
    </button>
  `,
})
class Button {
  readonly label = input<string>();
  readonly disabled = input(false);
  readonly onClick = input<() => Promise<unknown>>();
  click() {
    void this.onClick()?.();
  }
}

export const ui = createGenerativeUI({
  id: "test/feedback@1",
  components: {
    ...feedbackComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
    Group: { component: Group, slots: { children: "multiple" } },
    Button: {
      component: Button,
      props: z.object({
        label: z.string(),
        disabled: z.boolean().optional(),
      }),
      events: { onClick: { parameters: z.object({}) } },
    },
  },
});

type PopoverOpen = { open?: boolean | { "@path": string } };

/** A Popover with an "Open" trigger and a "Hidden content" body. */
export function popoverNodes(popover: PopoverOpen = {}) {
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

export const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, "") ?? "";

/** Runs the render hooks and the overlays, then change detection. */
export function settle(view: SurfaceRender) {
  TestBed.inject(ApplicationRef).tick();
  view.detectChanges();
}

// The lightbox is a dialog too; the Modal's is the one without its marker.
export const dialog = () =>
  document.querySelector<HTMLElement>(
    "[role=dialog]:not([data-a2ui-lightbox])",
  );
export const lightbox = () =>
  document.querySelector<HTMLElement>("[data-a2ui-lightbox]");
export const press = (target: EventTarget, key: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

/** The element of the standard catalog whose own text is `text`. */
export function byText(view: SurfaceRender, text: string): HTMLElement {
  const match = [...view.container.querySelectorAll<HTMLElement>("*")].find(
    (el) =>
      [...el.childNodes].some(
        (node) => node.nodeType === 3 && node.textContent?.trim() === text,
      ),
  );
  if (!match) throw new Error(`No element with the text "${text}".`);
  return match;
}

export function query<T extends Element>(
  view: SurfaceRender,
  selector: string,
) {
  const element = view.container.querySelector<T>(selector);
  if (!element) throw new Error(`No element matches "${selector}".`);
  return element;
}

export function click(view: SurfaceRender, element: HTMLElement) {
  view.act(() => element.click());
}
