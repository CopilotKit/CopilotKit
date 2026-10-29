import { Component, input } from "@angular/core";
import { createGenerativeUI } from "../../../catalog";
import type { GenerativeUIChildren } from "../../../children";
import { CopilotGenerativeUIChildren } from "../../../children.directive";
import { renderSurface } from "../../../__tests__/render";
import { textComponents } from "..";

/** A test-only container, so the text tests need no other group. */
@Component({
  selector: "test-column",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  host: { style: "display:flex;flex-direction:column" },
})
class Column {
  readonly children = input<GenerativeUIChildren>();
}

export const ui = createGenerativeUI({
  id: "test/text@1",
  components: {
    ...textComponents,
    Column: { component: Column, slots: { children: "multiple" } },
  },
});

/** The element whose own text is `text`. */
export function byText(container: HTMLElement, text: string): HTMLElement {
  const all = [...container.querySelectorAll<HTMLElement>("*")];
  const match = all.find((el) =>
    [...el.childNodes].some(
      (node) => node.nodeType === 3 && node.textContent?.trim() === text,
    ),
  );
  if (!match) throw new Error(`No element with the text "${text}".`);
  return match;
}

/** The inline markdown of `source`, as a Text renders it. */
export function renderInline(source: string) {
  const view = renderSurface(ui, [
    { id: "root", component: "Text", text: source },
  ]);
  return view.container.querySelector<HTMLElement>("[data-a2ui-text]")!;
}
