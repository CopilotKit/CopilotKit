import { Component, input } from "@angular/core";
import { z } from "zod";
import { createGenerativeUI } from "../../../catalog";
import type { SurfaceRender } from "../../../__tests__/render";
import { dataComponents } from "../index";

/** A test-only leaf for table cells and list children. */
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
  id: "test/data@1",
  components: {
    ...dataComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
  },
});

/** The text of each row of the table, cells joined by "|". */
export function rowTexts(view: SurfaceRender, selector = "table") {
  const rows = [...view.container.querySelectorAll(`${selector} tr`)];
  return rows.map((row) =>
    [...row.querySelectorAll("th, td")]
      .map((cell) => cell.textContent?.replace(/\s+/g, " ").trim())
      .join("|"),
  );
}

export const buttons = (view: SurfaceRender) => [
  ...view.container.querySelectorAll<HTMLButtonElement>("button"),
];

/** The element whose own text is `text`. */
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
