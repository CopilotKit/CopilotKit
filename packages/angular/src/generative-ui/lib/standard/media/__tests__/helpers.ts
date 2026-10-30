import { TestBed } from "@angular/core/testing";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { createGenerativeUI } from "../../../catalog";
import { renderSurface, testComponents } from "../../../__tests__/render";
import { GENERATIVE_UI_ICON_LOADER } from "../../loaders";
import { mediaComponents } from "..";

export const ui = createGenerativeUI({
  id: "test/media@1",
  components: { ...mediaComponents, ...testComponents },
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
