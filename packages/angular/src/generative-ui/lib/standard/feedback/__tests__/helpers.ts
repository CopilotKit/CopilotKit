import { Component, input } from "@angular/core";
import { z } from "zod";
import { createGenerativeUI } from "../../../catalog";
import { testComponents } from "../../../__tests__/render";
import type { SurfaceRender } from "../../../__tests__/render";
import { tick } from "../../../__tests__/dom";
import { feedbackComponents } from "../index";

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
    ...testComponents,
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
    { id: "root", component: "Column", children: ["o", "outside"] },
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
  tick();
  view.detectChanges();
}

// The lightbox is a dialog too; the Modal's is the one without its marker.
export const dialog = () =>
  document.querySelector<HTMLElement>(
    "[role=dialog]:not([data-a2ui-lightbox])",
  );
