import { ApplicationRef, Component, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { z } from "zod";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { createGenerativeUI } from "../../../catalog";
import type { GenerativeUIChildren } from "../../../children";
import { CopilotGenerativeUIChildren } from "../../../children.directive";
import { renderSurface } from "../../../__tests__/render";
import { GENERATIVE_UI_ICON_LOADER } from "../../loaders";
import { mediaComponents } from "..";

/** A test-only column, so the media tests need no other group. */
@Component({
  selector: "test-column",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <div data-column>
      <ng-container *copilotGenerativeUIChildren="children()" />
    </div>
  `,
})
class Column {
  readonly children = input<GenerativeUIChildren>();
}

@Component({
  selector: "test-label",
  template: `
    <span>{{ text() }}</span>
  `,
})
class Label {
  readonly text = input<string>();
}

export const ui = createGenerativeUI({
  id: "test/media@1",
  components: {
    ...mediaComponents,
    Column: { component: Column, slots: { children: "multiple" } },
    Label: { component: Label, props: z.object({ text: z.string() }) },
  },
});

/** Renders the media nodes in a Column, then a Label "end" after them. */
export function renderInColumn(...nodes: A2UIComponentNode[]) {
  return renderSurface(ui, [
    {
      id: "root",
      component: "Column",
      children: [...nodes.map((node) => node.id), "end"],
    },
    ...nodes,
    { id: "end", component: "Label", text: "end" },
  ]);
}

// The shape of the `lucide` module: one node list per icon, and `icons`.
const ArrowRight = [
  ["path", { d: "M5 12h14" }],
  ["path", { d: "m12 5 7 7-7 7" }],
];
const Check = [["path", { d: "M20 6 9 17l-5-5" }]];
const fakeLucide = { ArrowRight, Check, icons: { ArrowRight, Check } };

export function provideFakeIcons() {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GENERATIVE_UI_ICON_LOADER,
        useValue: () => Promise.resolve(fakeLucide),
      },
    ],
  });
}

export const imageByAlt = (container: HTMLElement, alt: string) =>
  container.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);

export const lightbox = () =>
  document.querySelector<HTMLElement>("[data-a2ui-lightbox]");
export const shownSrc = () =>
  lightbox()?.querySelector("img")?.getAttribute("src");
export const tick = () => TestBed.inject(ApplicationRef).tick();
export const key = (name: string) =>
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true }),
  );
