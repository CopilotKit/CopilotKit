import { createGenerativeUI } from "../../../catalog";
import { renderSurface, testComponents } from "../../../__tests__/render";
import { textComponents } from "..";

export const ui = createGenerativeUI({
  id: "test/text@1",
  components: { ...textComponents, Column: testComponents.Column },
});

/** The inline markdown of `source`, as a Text renders it. */
export function renderInline(source: string) {
  const view = renderSurface(ui, [
    { id: "root", component: "Text", text: source },
  ]);
  return view.container.querySelector<HTMLElement>("[data-a2ui-text]")!;
}
