import { ApplicationRef, Component, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { z } from "zod";
import { createGenerativeUI } from "../../../catalog";
import type { renderSurface } from "../../../__tests__/render";
import { layoutComponents } from "../index";

/** A test-only text leaf, so the layout tests need no other group. */
@Component({
  selector: "span[testLabel]",
  template: `
    {{ text() }}
  `,
  host: { "data-label": "" },
})
class Label {
  readonly text = input<string>();
}

export const ui = createGenerativeUI({
  id: "test/layout@1",
  components: {
    ...layoutComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
  },
});

export const spacing = (steps: number) =>
  `calc(var(--spacing, 0.25rem) * ${steps})`;

export type View = ReturnType<typeof renderSurface>;

/** The label element with this text. */
export function labelOf(view: View, text: string) {
  const label = [...view.container.querySelectorAll("[data-label]")].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!label) throw new Error(`"${text}" was not rendered.`);
  return label as HTMLElement;
}

/** The container around the Label with this text. */
export function parentOf(view: View, text: string) {
  const parent = labelOf(view, text).parentElement;
  if (!parent) throw new Error(`"${text}" has no parent element.`);
  return parent;
}

/** The element of the standard catalog whose own text is `text`. */
export function byText(view: View, text: string): HTMLElement {
  const match = [...view.container.querySelectorAll<HTMLElement>("*")].find(
    (el) =>
      [...el.childNodes].some(
        (node) => node.nodeType === 3 && node.textContent?.trim() === text,
      ),
  );
  if (!match) throw new Error(`No element with the text "${text}".`);
  return match;
}

export const lightbox = () =>
  document.querySelector<HTMLElement>("[data-a2ui-lightbox]");
export const shownSrc = () =>
  lightbox()?.querySelector("img")?.getAttribute("src");
export const tick = () => TestBed.inject(ApplicationRef).tick();
