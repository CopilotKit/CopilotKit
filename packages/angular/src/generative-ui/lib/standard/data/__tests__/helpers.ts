import { createGenerativeUI } from "../../../catalog";
import { testComponents } from "../../../__tests__/render";
import type { SurfaceRender } from "../../../__tests__/render";
import { dataComponents } from "../index";

export const ui = createGenerativeUI({
  id: "test/data@1",
  components: { ...dataComponents, ...testComponents },
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
