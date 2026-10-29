import { ApplicationRef, Component, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { z } from "zod";
import { createGenerativeUI } from "../../../catalog";
import type { GenerativeUIChildren } from "../../../children";
import { CopilotGenerativeUIChildren } from "../../../children.directive";
import { compositeComponents } from "../index";

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
  selector: "test-row",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <div><ng-container *copilotGenerativeUIChildren="children()" /></div>
  `,
})
class Row {
  readonly children = input<GenerativeUIChildren>();
}

export const ui = createGenerativeUI({
  id: "test/composites@1",
  components: {
    ...compositeComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
    Row: { component: Row, slots: { children: "multiple" } },
  },
});

export const lightbox = () =>
  document.querySelector<HTMLElement>("[data-a2ui-lightbox]");
export const shownSrc = () =>
  lightbox()?.querySelector("img")?.getAttribute("src");
export const tick = () => TestBed.inject(ApplicationRef).tick();
export const buttonNamed = (container: ParentNode, name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.textContent?.trim() === name ||
      button.getAttribute("aria-label") === name,
  );

export const key = (name: string) =>
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true }),
  );
